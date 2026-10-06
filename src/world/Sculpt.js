import * as THREE from 'three';
import { N, S, HALF } from '../core/config.js';
import { NO_SOLID } from './Terrain.js';

// Free-standing sand sculpture.
//
// The beach itself is a heightfield: one height per spot, so it can never hold
// an overhang, an undercut or a face carved into the side of a tower. Sculptures
// are stored instead as a sparse 3D grid of sand density (0 = air, 1 = packed
// sand) and turned into a smooth surface with surface nets, so they can be
// shaped from every side — down to noses, fingers and scales.

export const VOX = 0.035; // voxel edge, about a centimetre of real sand
const C = 24; // voxels along a chunk edge
const C3 = C * C * C;
const PAD = 5; // neighbouring voxels a chunk's mesh reads on each side (normals + occlusion)
const P = C + 2 * PAD, PP = P * P;
const CV = C + 1; // mesh cells per axis, covering [-1, C)
const RAMP = 1.5 * VOX; // density goes from packed to air across this distance
const MAX_CHUNKS = 3000; // ≈ 40 MB of sand
const OFF = 1024;
const keyOf = (cx, cy, cz) => ((cx + OFF) * 2048 + (cy + OFF)) * 2048 + (cz + OFF);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const falloff = (t) => (t >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * t));

// corner pairs along the 12 cell edges; corner c sits at (c&1, c>>1&1, c>>2&1)
const EDGES = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];
const CORNER = Array.from({ length: 8 }, (_, c) => (c & 1) + P * ((c >> 1) & 1) + PP * ((c >> 2) & 1));
// occlusion probes: the 26 neighbours of a grid point at two distances
const AO_NEAR = [], AO_FAR = [];
for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
  if (!x && !y && !z) continue;
  AO_NEAR.push(2 * (x + P * y + PP * z));
  AO_FAR.push(4 * (x + P * y + PP * z));
}

function segDist3(px, py, pz, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px, qy = ay + dy * t - py, qz = az + dz * t - pz;
  return Math.sqrt(qx * qx + qy * qy + qz * qz);
}

class Grow {
  constructor(n) { this.a = new Float32Array(n); this.n = 0; }
  need(k) {
    if (this.n + k <= this.a.length) return;
    const b = new Float32Array(Math.max(this.a.length * 2, this.n + k));
    b.set(this.a);
    this.a = b;
  }
}

export class Sculpt {
  constructor(scene, material, terrain) {
    this.scene = scene;
    this.material = material;
    this.terrain = terrain;
    this.chunks = new Map(); // chunk key → Uint8Array density
    this.meshes = new Map(); // chunk key → Mesh
    this.dirty = new Set(); // chunk keys whose mesh needs rebuilding
    this.rec = null; // chunk copies taken before the current undo step changed them
    this.strokeSnap = null; // same, for the stroke in progress (keeps carved lines crisp)
    this.bounds = null; // voxel bounds of all sand [x0, y0, z0, x1, y1, z1]
    this.topRect = null; // voxel x/z range whose column tops need refreshing
    this.onTop = null; // called with a terrain-cell rect once column tops change
    this.full = false;
    this.version = 0;
    this.L = new Float32Array(P * P * P);
    this.cellVert = new Int32Array(CV * CV * CV);
    this.pos = new Grow(30000);
    this.nrm = new Grow(30000);
    this.col = new Grow(30000);
    this.idx = new Grow(60000);
  }

  get empty() { return this.chunks.size === 0; }

  clear() {
    for (const m of this.meshes.values()) { this.scene.remove(m); m.geometry.dispose(); }
    this.meshes.clear();
    this.chunks.clear();
    this.dirty.clear();
    this.rec = null;
    this.strokeSnap = null;
    this.bounds = null;
    this.topRect = null;
    this.full = false;
    this.version++;
  }

  // ---------- density access ----------
  get(ix, iy, iz, snap) {
    const cx = Math.floor(ix / C), cy = Math.floor(iy / C), cz = Math.floor(iz / C);
    const key = keyOf(cx, cy, cz);
    let d;
    if (snap && this.strokeSnap && this.strokeSnap.has(key)) d = this.strokeSnap.get(key);
    else d = this.chunks.get(key);
    if (!d) return 0;
    return d[(ix - cx * C) + C * ((iy - cy * C) + C * (iz - cz * C))] / 255;
  }

  sample(x, y, z, snap) {
    const fx = x / VOX, fy = y / VOX, fz = z / VOX;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const tx = fx - ix, ty = fy - iy, tz = fz - iz;
    const g = (a, b, c) => this.get(ix + a, iy + b, iz + c, snap);
    const x00 = g(0, 0, 0) * (1 - tx) + g(1, 0, 0) * tx;
    const x10 = g(0, 1, 0) * (1 - tx) + g(1, 1, 0) * tx;
    const x01 = g(0, 0, 1) * (1 - tx) + g(1, 0, 1) * tx;
    const x11 = g(0, 1, 1) * (1 - tx) + g(1, 1, 1) * tx;
    return (x00 * (1 - ty) + x10 * ty) * (1 - tz) + (x01 * (1 - ty) + x11 * ty) * tz;
  }

  normalAt(x, y, z, snap, out = new THREE.Vector3()) {
    const e = VOX;
    out.set(
      this.sample(x - e, y, z, snap) - this.sample(x + e, y, z, snap),
      this.sample(x, y - e, z, snap) - this.sample(x, y + e, z, snap),
      this.sample(x, y, z - e, snap) - this.sample(x, y, z + e, snap),
    );
    if (out.lengthSq() < 1e-12) out.set(0, 1, 0);
    return out.normalize();
  }

  // Nearest point where the ray enters sand, or null. Hits carry .sculpt and .normal.
  raycast(ray, maxDist = 400, snap = false) {
    if (!this.bounds) return null;
    const b = this.bounds, o = ray.origin, d = ray.direction;
    let t0 = 0, t1 = maxDist;
    const lo = [(b[0] - 1) * VOX, (b[1] - 1) * VOX, (b[2] - 1) * VOX];
    const hi = [(b[3] + 2) * VOX, (b[4] + 2) * VOX, (b[5] + 2) * VOX];
    const oa = [o.x, o.y, o.z], da = [d.x, d.y, d.z];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(da[a]) < 1e-9) {
        if (oa[a] < lo[a] || oa[a] > hi[a]) return null;
        continue;
      }
      let ta = (lo[a] - oa[a]) / da[a], tb = (hi[a] - oa[a]) / da[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return null;
    }
    const step = VOX * 0.5;
    let prev = t0;
    for (let t = t0; t <= t1; t += step) {
      if (this.sample(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t, snap) >= 0.5) {
        let a = prev, c = t;
        for (let k = 0; k < 7; k++) {
          const m = (a + c) / 2;
          if (this.sample(o.x + d.x * m, o.y + d.y * m, o.z + d.z * m, snap) >= 0.5) c = m; else a = m;
        }
        const p = new THREE.Vector3(o.x + d.x * c, o.y + d.y * c, o.z + d.z * c);
        p.sculpt = true;
        p.normal = this.normalAt(p.x, p.y, p.z, snap);
        return p;
      }
      prev = t;
    }
    return null;
  }

  // ---------- editing ----------
  beginRecord() {
    this.rec = new Map();
    return this.rec;
  }

  // Run fn(ix, iy, iz, old) → new density over every voxel in the world-space box.
  // Stochastic rounding lets slow, continuous brushes keep moving 8-bit sand.
  edit(x0, y0, z0, x1, y1, z1, fn, stochastic = false) {
    const i0 = Math.floor(x0 / VOX), j0 = Math.floor(y0 / VOX), k0 = Math.floor(z0 / VOX);
    const i1 = Math.ceil(x1 / VOX), j1 = Math.ceil(y1 / VOX), k1 = Math.ceil(z1 / VOX);
    let ci0 = Infinity, cj0 = Infinity, ck0 = Infinity, ci1 = -Infinity, cj1 = -Infinity, ck1 = -Infinity;
    for (let cz = Math.floor(k0 / C); cz <= Math.floor(k1 / C); cz++) {
      for (let cy = Math.floor(j0 / C); cy <= Math.floor(j1 / C); cy++) {
        for (let cx = Math.floor(i0 / C); cx <= Math.floor(i1 / C); cx++) {
          const key = keyOf(cx, cy, cz);
          let d = this.chunks.get(key);
          let noted = false;
          const bx = cx * C, by = cy * C, bz = cz * C;
          const xa = Math.max(i0, bx), xb = Math.min(i1, bx + C - 1);
          const ya = Math.max(j0, by), yb = Math.min(j1, by + C - 1);
          const za = Math.max(k0, bz), zb = Math.min(k1, bz + C - 1);
          for (let iz = za; iz <= zb; iz++) {
            for (let iy = ya; iy <= yb; iy++) {
              let idx = (xa - bx) + C * ((iy - by) + C * (iz - bz));
              for (let ix = xa; ix <= xb; ix++, idx++) {
                const oq = d ? d[idx] : 0;
                const nv = fn(ix, iy, iz, oq / 255);
                let q = stochastic ? Math.floor(nv * 255 + Math.random()) : Math.round(nv * 255);
                q = q < 0 ? 0 : q > 255 ? 255 : q;
                if (q === oq) continue;
                if (!d) {
                  if (this.chunks.size >= MAX_CHUNKS) { this.full = true; continue; }
                  d = new Uint8Array(C3);
                  this.chunks.set(key, d);
                  if (this.rec && !this.rec.has(key)) this.rec.set(key, null);
                  if (this.strokeSnap && !this.strokeSnap.has(key)) this.strokeSnap.set(key, null);
                  noted = true;
                } else if (!noted) {
                  if (this.rec && !this.rec.has(key)) this.rec.set(key, d.slice());
                  if (this.strokeSnap && !this.strokeSnap.has(key)) this.strokeSnap.set(key, d.slice());
                  noted = true;
                }
                d[idx] = q;
                if (ix < ci0) ci0 = ix; if (ix > ci1) ci1 = ix;
                if (iy < cj0) cj0 = iy; if (iy > cj1) cj1 = iy;
                if (iz < ck0) ck0 = iz; if (iz > ck1) ck1 = iz;
              }
            }
          }
        }
      }
    }
    if (ci1 < ci0) return false;
    this.touched(ci0, cj0, ck0, ci1, cj1, ck1);
    return true;
  }

  touched(i0, j0, k0, i1, j1, k1) {
    // every chunk whose padded mesh window sees these voxels
    for (let cz = Math.floor((k0 - PAD) / C); cz <= Math.floor((k1 + PAD) / C); cz++)
      for (let cy = Math.floor((j0 - PAD) / C); cy <= Math.floor((j1 + PAD) / C); cy++)
        for (let cx = Math.floor((i0 - PAD) / C); cx <= Math.floor((i1 + PAD) / C); cx++)
          this.dirty.add(keyOf(cx, cy, cz));
    const b = this.bounds;
    if (!b) this.bounds = [i0, j0, k0, i1, j1, k1];
    else {
      b[0] = Math.min(b[0], i0); b[1] = Math.min(b[1], j0); b[2] = Math.min(b[2], k0);
      b[3] = Math.max(b[3], i1); b[4] = Math.max(b[4], j1); b[5] = Math.max(b[5], k1);
    }
    const r = this.topRect;
    if (!r) this.topRect = [i0, k0, i1, k1];
    else { r[0] = Math.min(r[0], i0); r[1] = Math.min(r[1], k0); r[2] = Math.max(r[2], i1); r[3] = Math.max(r[3], k1); }
    this.version++;
  }

  restore(rec) {
    if (!rec) return;
    for (const [key, data] of rec) {
      if (data) this.chunks.set(key, data); else this.chunks.delete(key);
      const cz = (key % 2048) - OFF, t = Math.floor(key / 2048), cy = (t % 2048) - OFF, cx = Math.floor(t / 2048) - OFF;
      this.touched(cx * C, cy * C, cz * C, cx * C + C - 1, cy * C + C - 1, cz * C + C - 1);
    }
    if (this.rec === rec) this.rec = null;
    this.recomputeBounds();
  }

  recomputeBounds() {
    let b = null;
    for (const key of this.chunks.keys()) {
      const cz = (key % 2048) - OFF, t = Math.floor(key / 2048), cy = (t % 2048) - OFF, cx = Math.floor(t / 2048) - OFF;
      const v = [cx * C, cy * C, cz * C, cx * C + C - 1, cy * C + C - 1, cz * C + C - 1];
      if (!b) b = v;
      else for (let a = 0; a < 3; a++) { b[a] = Math.min(b[a], v[a]); b[a + 3] = Math.max(b[a + 3], v[a + 3]); }
    }
    this.bounds = b;
  }

  // ---------- brushes ----------
  // Add (amount > 0) or scoop away sand around a point, like pressing on clay.
  brushAdd(c, r, amount) {
    const r2 = r * r;
    return this.edit(c.x - r, c.y - r, c.z - r, c.x + r, c.y + r, c.z + r, (ix, iy, iz, old) => {
      const dx = ix * VOX - c.x, dy = iy * VOX - c.y, dz = iz * VOX - c.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r2) return old;
      return clamp01(old + amount * falloff(Math.sqrt(d2) / r));
    }, true);
  }

  brushSmooth(c, r, k) {
    // read the neighbourhood once so the blur doesn't feed on itself
    const i0 = Math.floor((c.x - r) / VOX) - 1, j0 = Math.floor((c.y - r) / VOX) - 1, k0 = Math.floor((c.z - r) / VOX) - 1;
    const nx = Math.ceil((2 * r) / VOX) + 4, ny = nx, nz = nx;
    const buf = new Float32Array(nx * ny * nz);
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) buf[x + nx * (y + ny * z)] = this.get(i0 + x, j0 + y, k0 + z);
    const r2 = r * r;
    return this.edit(c.x - r, c.y - r, c.z - r, c.x + r, c.y + r, c.z + r, (ix, iy, iz, old) => {
      const dx = ix * VOX - c.x, dy = iy * VOX - c.y, dz = iz * VOX - c.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r2) return old;
      const b = (ix - i0) + nx * ((iy - j0) + ny * (iz - k0));
      const avg = (buf[b - 1] + buf[b + 1] + buf[b - nx] + buf[b + nx] + buf[b - nx * ny] + buf[b + nx * ny]) / 6;
      return old + (avg - old) * k * falloff(Math.sqrt(d2) / r);
    }, true);
  }

  // Pull the surface toward the plane through p0 facing n0, for crisp flat faces.
  brushFlatten(c, r, p0, n0, k) {
    const r2 = r * r;
    return this.edit(c.x - r, c.y - r, c.z - r, c.x + r, c.y + r, c.z + r, (ix, iy, iz, old) => {
      const x = ix * VOX, y = iy * VOX, z = iz * VOX;
      const dx = x - c.x, dy = y - c.y, dz = z - c.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r2) return old;
      const s = (x - p0.x) * n0.x + (y - p0.y) * n0.y + (z - p0.z) * n0.z;
      const target = clamp01(0.5 - s / (2 * VOX));
      return old + (target - old) * k * falloff(Math.sqrt(d2) / r);
    }, true);
  }

  // A groove (or with emboss, a raised bead) along a-b, sunk `depth` into the surface.
  carve(a, b, na, nb, rad, depth, emboss) {
    const off = emboss ? depth - rad : rad - depth;
    const ax = a.x + na.x * off, ay = a.y + na.y * off, az = a.z + na.z * off;
    const bx = b.x + nb.x * off, by = b.y + nb.y * off, bz = b.z + nb.z * off;
    const m = rad + RAMP * 2;
    return this.edit(Math.min(ax, bx) - m, Math.min(ay, by) - m, Math.min(az, bz) - m, Math.max(ax, bx) + m, Math.max(ay, by) + m, Math.max(az, bz) + m,
      (ix, iy, iz, old) => {
        const d = segDist3(ix * VOX, iy * VOX, iz * VOX, ax, ay, az, bx, by, bz);
        const v = clamp01(0.5 - (d - rad) / RAMP);
        return emboss ? Math.max(old, v) : Math.min(old, 1 - v);
      });
  }

  // Height of the highest sand surface in the column at (x, z), at or below
  // `below`, or -Infinity when the column holds no sculpture there.
  columnTop(x, z, below = Infinity) {
    const b = this.bounds;
    if (!b) return -Infinity;
    const vx = Math.round(x / VOX), vz = Math.round(z / VOX);
    if (vx < b[0] || vx > b[3] || vz < b[2] || vz > b[5]) return -Infinity;
    for (let iy = Math.min(b[4] + 1, Math.floor(below / VOX)); iy >= b[1]; iy--) {
      const v = this.get(vx, iy, vz);
      if (v >= 0.5) return (iy + (v - 0.5) / Math.max(1e-3, v - this.get(vx, iy + 1, vz))) * VOX;
    }
    return -Infinity;
  }

  // A packed block of sand, like one tipped out of a sculpting form. Wherever
  // its bottom would hang in the air (over an edge, a slope or a hole) the sand
  // runs on down to whatever holds it up — support(x, z) gives that height.
  addBlock(cx, cz, baseY, hx, hy, hz, angle = 0, support = null) {
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const rr = Math.min(0.1, hx * 0.2, hy * 0.3);
    const ex = Math.abs(ca) * hx + Math.abs(sa) * hz + RAMP * 2, ez = Math.abs(sa) * hx + Math.abs(ca) * hz + RAMP * 2;
    const top = baseY + 2 * hy;
    const bottoms = new Map();
    const bottomAt = (ix, iz) => {
      const k = ix * 65536 + iz;
      let v = bottoms.get(k);
      if (v === undefined) {
        v = support ? Math.min(baseY, support(ix * VOX, iz * VOX) - 0.12) : baseY;
        bottoms.set(k, v);
      }
      return v;
    };
    let low = baseY;
    for (let iz = Math.floor((cz - ez) / VOX); iz <= Math.ceil((cz + ez) / VOX); iz += 2) {
      for (let ix = Math.floor((cx - ex) / VOX); ix <= Math.ceil((cx + ex) / VOX); ix += 2) low = Math.min(low, bottomAt(ix, iz));
    }
    return this.edit(cx - ex, low - 0.1, cz - ez, cx + ex, top + RAMP * 2, cz + ez, (ix, iy, iz, old) => {
      const dx = ix * VOX - cx, dz = iz * VOX - cz;
      const b = bottomAt(ix, iz);
      const lx = Math.abs(dx * ca + dz * sa) - hx + rr;
      const ly = Math.abs(iy * VOX - (b + top) / 2) - (top - b) / 2 + rr;
      const lz = Math.abs(-dx * sa + dz * ca) - hz + rr;
      const ox = Math.max(lx, 0), oy = Math.max(ly, 0), oz = Math.max(lz, 0);
      const sdf = Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(lx, ly, lz), 0) - rr;
      return Math.max(old, clamp01(0.5 - sdf / RAMP));
    });
  }

  // Turn the built sand around (x, z) — towers, walls, mounds — into sculpture
  // with exactly the same shape, so it can be carved from the side. Sand that
  // stays a heightfield keeps one cell of overlap so the seam never shows.
  convertStructure(x, z, radius, isBuilt) {
    const t = this.terrain;
    const ci = Math.round((x + HALF) / S), cj = Math.round((z + HALF) / S);
    // start from the tallest built cell under the pointer
    let start = -1, best = -Infinity;
    for (let j = cj - 2; j <= cj + 2; j++) for (let i = ci - 2; i <= ci + 2; i++) {
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const k = j * N + i;
      if (isBuilt(k) && t.h[k] > best) { best = t.h[k]; start = k; }
    }
    if (start < 0) return null;
    const inRegion = new Uint8Array(N * N);
    const cells = [start];
    inRegion[start] = 1;
    const r2 = radius * radius;
    let gi0 = N, gj0 = N, gi1 = 0, gj1 = 0;
    for (let q = 0; q < cells.length; q++) {
      const k = cells[q], i = k % N, j = (k / N) | 0;
      gi0 = Math.min(gi0, i); gj0 = Math.min(gj0, j); gi1 = Math.max(gi1, i); gj1 = Math.max(gj1, j);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 1 || nj < 1 || ni >= N - 1 || nj >= N - 1) continue;
        const nk = nj * N + ni;
        if (inRegion[nk] || !isBuilt(nk) || t.mask[nk] < 1) continue;
        const px = -HALF + ni * S - x, pz = -HALF + nj * S - z;
        if (px * px + pz * pz > r2) continue;
        inRegion[nk] = 1;
        cells.push(nk);
      }
    }
    const wx0 = -HALF + (gi0 - 0.5) * S, wx1 = -HALF + (gi1 + 0.5) * S;
    const wz0 = -HALF + (gj0 - 0.5) * S, wz1 = -HALF + (gj1 + 0.5) * S;
    let top = -Infinity, bottom = Infinity;
    for (const k of cells) { top = Math.max(top, t.h[k]); bottom = Math.min(bottom, t.h0[k]); }
    // a smooth (Catmull-Rom) reading of the heightfield, so the sculpture doesn't
    // inherit the grid's facets
    const h = t.h;
    const ix0 = (i) => (i < 0 ? 0 : i > N - 1 ? N - 1 : i);
    const cr = (p0, p1, p2, p3, s) => p1 + 0.5 * s * (p2 - p0 + s * (2 * p0 - 5 * p1 + 4 * p2 - p3 + s * (3 * (p1 - p2) + p3 - p0)));
    const smoothH = (px, pz) => {
      const fi = (px + HALF) / S, fj = (pz + HALF) / S;
      const i = Math.floor(fi), j = Math.floor(fj), sx = fi - i, sz = fj - j;
      const row = (jj) => {
        const r = ix0(jj) * N;
        return cr(h[r + ix0(i - 1)], h[r + ix0(i)], h[r + ix0(i + 1)], h[r + ix0(i + 2)], sx);
      };
      return cr(row(j - 1), row(j), row(j + 1), row(j + 2), sz);
    };
    const cols = new Map(); // voxel column → [height, base, slope] (or null outside the region)
    const column = (ix, iz) => {
      const ck = ix * 65536 + iz;
      if (cols.has(ck)) return cols.get(ck);
      const px = ix * VOX, pz = iz * VOX;
      const i = Math.round((px + HALF) / S), j = Math.round((pz + HALF) / S);
      let v = null;
      if (i >= 0 && j >= 0 && i < N && j < N && inRegion[j * N + i]) {
        const e = S * 0.5;
        const gx = (smoothH(px + e, pz) - smoothH(px - e, pz)) / (2 * e);
        const gz = (smoothH(px, pz + e) - smoothH(px, pz - e)) / (2 * e);
        v = [smoothH(px, pz), t.originalAt(px, pz) - 0.15, Math.sqrt(1 + gx * gx + gz * gz)];
      }
      cols.set(ck, v);
      return v;
    };
    this.edit(wx0, bottom - 0.2, wz0, wx1, top + RAMP * 2, wz1, (ix, iy, iz, old) => {
      const c = column(ix, iz);
      if (!c) return old;
      const y = iy * VOX;
      // height above the surface divided by the slope ≈ distance to it, so steep
      // walls get as soft an edge as flat tops instead of a jagged step
      const v = Math.min(clamp01(0.5 + (c[0] - y) / (RAMP * c[2])), clamp01(0.5 + (y - c[1]) / RAMP));
      return Math.max(old, v);
    });
    // lower the heightfield back to the beach, except where it meets built sand
    // that stays behind (that rim sits inside the sculpture)
    for (const k of cells) {
      let rim = false;
      for (const nk of [k + 1, k - 1, k + N, k - N]) if (!inRegion[nk] && isBuilt(nk)) rim = true;
      if (!rim) t.h[k] = Math.min(t.h[k], t.h0[k]);
    }
    t.markDirty(gi0 - 1, gj0 - 1, gi1 + 1, gj1 + 1);
    return { cells, center: new THREE.Vector3(x, top, z) };
  }

  // ---------- column tops (so water and goals see sculptures) ----------
  flushTop() {
    const r = this.topRect;
    if (!r) return;
    this.topRect = null;
    const t = this.terrain;
    const i0 = Math.max(0, Math.floor((r[0] * VOX + HALF) / S) - 1), i1 = Math.min(N - 1, Math.ceil((r[2] * VOX + HALF) / S) + 1);
    const j0 = Math.max(0, Math.floor((r[1] * VOX + HALF) / S) - 1), j1 = Math.min(N - 1, Math.ceil((r[3] * VOX + HALF) / S) + 1);
    const b = this.bounds;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * N + i;
        t.solid[k] = NO_SOLID;
        if (!b) continue;
        const vx = Math.round((-HALF + i * S) / VOX), vz = Math.round((-HALF + j * S) / VOX);
        const cx = Math.floor(vx / C), cz = Math.floor(vz / C);
        if (vx < b[0] || vx > b[3] || vz < b[2] || vz > b[5]) continue;
        for (let cy = Math.floor(b[4] / C); cy >= Math.floor(b[1] / C); cy--) {
          const d = this.chunks.get(keyOf(cx, cy, cz));
          if (!d) continue;
          const base = (vx - cx * C) + C * C * (vz - cz * C);
          let found = false;
          for (let ly = C - 1; ly >= 0; ly--) {
            const v = d[base + C * ly] / 255;
            if (v >= 0.5) {
              const iy = cy * C + ly;
              const up = this.get(vx, iy + 1, vz);
              t.solid[k] = (iy + (v - 0.5) / Math.max(1e-3, v - up)) * VOX;
              found = true;
              break;
            }
          }
          if (found) break;
        }
      }
    }
    if (this.onTop) this.onTop([i0, j0, i1, j1]);
  }

  // ---------- meshing ----------
  update(budgetMs = 7) {
    if (this.dirty.size) {
      const t0 = performance.now();
      for (const key of this.dirty) {
        this.dirty.delete(key);
        this.meshChunk(key);
        if (performance.now() - t0 > budgetMs) break;
      }
    }
    this.flushTop();
  }

  flushAll() {
    for (const key of this.dirty) this.meshChunk(key);
    this.dirty.clear();
    this.flushTop();
  }

  meshChunk(key) {
    const cz = (key % 2048) - OFF, kt = Math.floor(key / 2048), cy = (kt % 2048) - OFF, cx = Math.floor(kt / 2048) - OFF;
    const L = this.L;
    L.fill(0);
    const bx = cx * C - PAD, by = cy * C - PAD, bz = cz * C - PAD; // global voxel at L[0]
    let hi = 0, lo = 1, present = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const d = this.chunks.get(keyOf(cx + dx, cy + dy, cz + dz));
      if (!d) continue;
      present++;
      const ox = (cx + dx) * C, oy = (cy + dy) * C, oz = (cz + dz) * C;
      const gx0 = Math.max(bx, ox), gx1 = Math.min(bx + P, ox + C);
      const gy0 = Math.max(by, oy), gy1 = Math.min(by + P, oy + C);
      const gz0 = Math.max(bz, oz), gz1 = Math.min(bz + P, oz + C);
      for (let gz = gz0; gz < gz1; gz++) for (let gy = gy0; gy < gy1; gy++) {
        let s = (gx0 - ox) + C * ((gy - oy) + C * (gz - oz));
        let t = (gx0 - bx) + P * ((gy - by) + P * (gz - bz));
        for (let n = gx1 - gx0; n > 0; n--) {
          const v = d[s++] / 255;
          L[t++] = v;
          if (v > hi) hi = v;
          if (v < lo) lo = v;
        }
      }
    }
    const old = this.meshes.get(key);
    if (hi < 0.5 || (present === 27 && lo >= 0.5)) {
      if (old) { this.scene.remove(old); old.geometry.dispose(); this.meshes.delete(key); }
      return;
    }

    const cellVert = this.cellVert;
    cellVert.fill(-1);
    const pos = this.pos, nrm = this.nrm, col = this.col, idx = this.idx;
    pos.n = nrm.n = col.n = idx.n = 0;
    const cv = new Float32Array(8);
    let nv = 0;
    for (let z = -1; z < C; z++) {
      for (let y = -1; y < C; y++) {
        let i = (PAD - 1) + P * ((y + PAD) + P * (z + PAD));
        for (let x = -1; x < C; x++, i++) {
          let m = 0;
          for (let c = 0; c < 8; c++) { const v = L[i + CORNER[c]]; cv[c] = v; if (v >= 0.5) m |= 1 << c; }
          if (m === 0 || m === 255) continue;
          // surface point: average of the edge crossings in this cell
          let sx = 0, sy = 0, sz = 0, cnt = 0;
          for (let e = 0; e < 24; e += 2) {
            const a = EDGES[e], b = EDGES[e + 1];
            if (((m >> a) & 1) === ((m >> b) & 1)) continue;
            const f = (0.5 - cv[a]) / (cv[b] - cv[a]);
            sx += (a & 1) + ((b & 1) - (a & 1)) * f;
            sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * f;
            sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * f;
            cnt++;
          }
          const fx = sx / cnt, fy = sy / cnt, fz = sz / cnt;
          // smooth normal: trilinear blend of the density gradient at the corners
          let gx = 0, gy = 0, gz = 0;
          for (let c = 0; c < 8; c++) {
            const w = ((c & 1) ? fx : 1 - fx) * (((c >> 1) & 1) ? fy : 1 - fy) * (((c >> 2) & 1) ? fz : 1 - fz);
            const ic = i + CORNER[c];
            gx += (L[ic + 1] - L[ic - 1]) * w;
            gy += (L[ic + P] - L[ic - P]) * w;
            gz += (L[ic + PP] - L[ic - PP]) * w;
          }
          let inv = Math.sqrt(gx * gx + gy * gy + gz * gz);
          inv = inv > 1e-9 ? -1 / inv : 0;
          // occlusion: how much sand surrounds the point, near and a little further out
          const g = i + Math.round(fx) + P * Math.round(fy) + PP * Math.round(fz);
          let near = 0, far = 0;
          for (let q = 0; q < 26; q++) { near += L[g + AO_NEAR[q]]; far += L[g + AO_FAR[q]]; }
          const fill = (near * 0.6 + far * 0.4) / 26;
          const ao = 1 - Math.min(0.6, Math.max(0, (fill - 0.48) * 2.2));

          pos.need(3); nrm.need(3); col.need(3);
          const p = pos.a, n = nrm.a, cl = col.a, o = nv * 3;
          p[o] = (cx * C + x + fx) * VOX; p[o + 1] = (cy * C + y + fy) * VOX; p[o + 2] = (cz * C + z + fz) * VOX;
          if (inv) { n[o] = gx * inv; n[o + 1] = gy * inv; n[o + 2] = gz * inv; } else { n[o] = 0; n[o + 1] = 1; n[o + 2] = 0; }
          cl[o] = cl[o + 1] = cl[o + 2] = ao;
          pos.n = nrm.n = col.n = o + 3;
          cellVert[(x + 1) + CV * ((y + 1) + CV * (z + 1))] = nv++;
        }
      }
    }
    // one quad for every edge that crosses the surface, owned by its lower grid point
    const cvx = (x, y, z) => cellVert[(x + 1) + CV * ((y + 1) + CV * (z + 1))];
    const quad = (inside, a, b, c, d) => {
      idx.need(6);
      const o = idx.a;
      let n = idx.n;
      if (inside) { o[n++] = a; o[n++] = b; o[n++] = c; o[n++] = a; o[n++] = c; o[n++] = d; }
      else { o[n++] = a; o[n++] = c; o[n++] = b; o[n++] = a; o[n++] = d; o[n++] = c; }
      idx.n = n;
    };
    for (let z = 0; z < C; z++) {
      for (let y = 0; y < C; y++) {
        let i = PAD + P * ((y + PAD) + P * (z + PAD));
        for (let x = 0; x < C; x++, i++) {
          const inside = L[i] >= 0.5;
          if (inside !== (L[i + 1] >= 0.5)) quad(inside, cvx(x, y - 1, z - 1), cvx(x, y, z - 1), cvx(x, y, z), cvx(x, y - 1, z));
          if (inside !== (L[i + P] >= 0.5)) quad(inside, cvx(x - 1, y, z - 1), cvx(x - 1, y, z), cvx(x, y, z), cvx(x, y, z - 1));
          if (inside !== (L[i + PP] >= 0.5)) quad(inside, cvx(x - 1, y - 1, z), cvx(x, y - 1, z), cvx(x, y, z), cvx(x - 1, y, z));
        }
      }
    }
    if (!idx.n) {
      if (old) { this.scene.remove(old); old.geometry.dispose(); this.meshes.delete(key); }
      return;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.a.slice(0, pos.n), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm.a.slice(0, nrm.n), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col.a.slice(0, col.n), 3));
    // packed sculpting sand: smooth, never the wind-rippled beach texture
    geo.setAttribute('aBuilt', new THREE.BufferAttribute(new Float32Array(nv).fill(1), 1));
    geo.setIndex(new THREE.BufferAttribute(nv > 65535 ? Uint32Array.from(idx.a.subarray(0, idx.n)) : Uint16Array.from(idx.a.subarray(0, idx.n)), 1));
    geo.computeBoundingSphere();
    if (old) {
      old.geometry.dispose();
      old.geometry = geo;
    } else {
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.meshes.set(key, mesh);
    }
  }
}
