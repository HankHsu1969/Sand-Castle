import * as THREE from 'three';
import { N, S, HALF, FLOOR } from '../core/config.js';
import { segDist, smoothstep } from '../core/noise.js';

export const TOOLS = [
  { id: 'raise', name: '堆沙', icon: 'assets/icons/raise.png', key: '1', hint: '按住左鍵堆起濕沙' },
  { id: 'dig', name: '挖沙', icon: 'assets/icons/dig.png', key: '2', hint: '按住左鍵往下挖，也許會挖到寶藏' },
  { id: 'smooth', name: '抹順', icon: 'assets/icons/smooth.png', key: '3', hint: '把粗糙的沙面抹得圓滑' },
  { id: 'flatten', name: '壓平', icon: 'assets/icons/flatten.png', key: '4', hint: '以點下處的高度壓出平台' },
  { id: 'carve', name: '雕刻', icon: 'assets/icons/carve.png', key: '5', hint: '拖曳刻出細紋、磚縫與花紋 · 按住 Shift 拖曳則堆出細邊' },
  { id: 'tower', name: '水桶塔', icon: 'assets/icons/tower.png', key: '6', hint: '點一下倒扣水桶，做出一座塔樓 · 按住拖曳可連續蓋一排' },
  { id: 'wall', name: '城牆', icon: 'assets/icons/wall.png', key: '7', hint: '按住拖曳，沿路築起有城垛的城牆' },
  { id: 'channel', name: '挖渠', icon: 'assets/icons/channel.png', key: '8', hint: '按住拖曳挖出水道或護城河' },
  { id: 'decor', name: '裝飾', icon: 'assets/icons/decor.png', key: '9', hint: '點擊擺放貝殼與小物 · Ctrl+點擊移除' },
  { id: 'flag', name: '旗幟', icon: 'assets/icons/flag.png', key: '0', hint: '把旗幟插在城堡上 · Ctrl+點擊移除' },
];

const TOOL_COLORS = {
  raise: 0xffe08a, dig: 0xff9a7a, smooth: 0xbfefff, flatten: 0xd6c4ff, carve: 0xb8f5c8,
  tower: 0xffffff, wall: 0xffffff, channel: 0x7fe7ff, decor: 0xffb7d0, flag: 0xff8080,
};

// sand this far above the untouched beach counts as part of a structure
const BUILT = 0.06;
const PATH_TOOLS = ['wall', 'channel', 'carve'];

const falloff = (t) => (t >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * t));
const easeOutBack = (t) => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

export class Tools {
  constructor(game) {
    this.game = game;
    this.tool = 'raise';
    this.radius = 1.0;
    this.strength = 1.0;
    this.decorType = 'scallop';
    this.down = false;
    this.stroke = null;
    this.stamps = [];
    this.stats = { towers: 0, wall: 0 };
    this.cursor = null;
    this.buildCursor();
  }

  get terrain() { return this.game.terrain; }

  buildCursor() {
    const pts = 72;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts * 3), 3));
    this.ring = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }));
    this.ring.renderOrder = 10;
    this.ring.frustumCulled = false;
    this.ring.visible = false;
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }));
    this.dot.renderOrder = 10;
    this.dot.visible = false;
    this.game.scene.add(this.ring, this.dot);
  }

  setTool(id) {
    this.tool = id;
    const c = TOOL_COLORS[id] || 0xffffff;
    this.ring.material.color.set(c);
    this.dot.material.color.set(c);
  }

  effectiveRadius() {
    if (this.tool === 'decor' || this.tool === 'flag') return 0.35;
    return this.radius;
  }

  updateCursor(hit) {
    this.cursor = hit;
    const vis = !!hit && this.game.state === 'play';
    this.ring.visible = vis;
    this.dot.visible = vis;
    if (!vis) return;
    const r = this.tool === 'wall' ? this.wallDims().width / 2
      : this.tool === 'channel' ? this.channelDims().width / 2
      : this.tool === 'carve' ? this.carveDims().width / 2
      : this.effectiveRadius();
    const p = this.ring.geometry.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const a = (k / p.count) * Math.PI * 2;
      const x = hit.x + Math.cos(a) * r, z = hit.z + Math.sin(a) * r;
      p.setXYZ(k, x, this.terrain.heightAt(x, z) + 0.04, z);
    }
    p.needsUpdate = true;
    this.dot.position.copy(hit).y += 0.03;
  }

  // ---------- region helpers ----------
  forRegion(cx, cz, r, fn) {
    const t = this.terrain;
    const i0 = Math.max(0, Math.floor((cx - r + HALF) / S)), i1 = Math.min(N - 1, Math.ceil((cx + r + HALF) / S));
    const j0 = Math.max(0, Math.floor((cz - r + HALF) / S)), j1 = Math.min(N - 1, Math.ceil((cz + r + HALF) / S));
    for (let j = j0; j <= j1; j++) {
      const z = -HALF + j * S;
      for (let i = i0; i <= i1; i++) {
        const k = j * N + i;
        if (t.mask[k] <= 0) continue;
        fn(k, -HALF + i * S, z, i, j);
      }
    }
    t.markDirty(i0, j0, i1, j1);
  }

  // ---------- pointer handling ----------
  begin(hit, ev) {
    if (!hit) return;
    this.down = true;
    const g = this.game;
    const remove = ev && (ev.ctrlKey || ev.metaKey);
    // other tools work on the finished shape of any tower that is still rising
    if (this.tool !== 'tower') this.settleStamps();
    switch (this.tool) {
      case 'decor':
      case 'flag':
        if (remove) g.removeNearestProp(hit, this.tool);
        else if (this.tool === 'decor') g.placeDecor(this.decorType, hit);
        else g.placeFlag(hit);
        this.down = false;
        return;
      case 'tower':
        // one undo step per press; dragging keeps setting buckets down in a row
        g.pushUndo();
        this.stampTower(hit.x, hit.z, this.radius, 0.45);
        this.stroke = { last: hit.clone(), plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.y) };
        return;
      default:
        break;
    }
    g.pushUndo();
    const path = PATH_TOOLS.includes(this.tool);
    this.stroke = {
      last: hit.clone(),
      target: this.terrain.heightAt(hit.x, hit.z),
      snap: path ? this.terrain.h.slice() : null,
      s: 0,
      bottom: null,
      points: [hit.clone()],
      emboss: !!(ev && ev.shiftKey),
    };
    if (path) this.extendPath(hit, true);
  }

  move(hit) {
    if (!this.down || !hit || !this.stroke) return;
    if (this.tool === 'tower') {
      // follow the pointer across the level the row started on, so a ray that
      // slips past the buckets already standing can't drop one behind them
      const st = this.stroke;
      const p = this.game.raycaster.ray.intersectPlane(st.plane, new THREE.Vector3()) || hit;
      // close enough that neighbouring buckets merge into one solid row
      if (Math.hypot(p.x - st.last.x, p.z - st.last.z) >= this.radius * 1.6) {
        this.stampTower(p.x, p.z, this.radius, 0.45);
        st.last.copy(p);
      }
    } else if (PATH_TOOLS.includes(this.tool)) this.extendPath(hit, false);
  }

  end() {
    this.down = false;
    this.stroke = null;
    this.game.audio.brush(false);
  }

  update(dt) {
    // animated stamps (towers rising out of the sand)
    for (let i = this.stamps.length - 1; i >= 0; i--) {
      const st = this.stamps[i];
      st.t = Math.min(st.dur, st.t + dt);
      const e = st.dur > 0 ? easeOutBack(st.t / st.dur) : 1;
      const h = this.terrain.h;
      for (let q = 0; q < st.cells.length; q++) {
        const k = st.cells[q];
        const up = st.target[q] >= st.snap[q];
        const v = st.snap[q] + (st.target[q] - st.snap[q]) * (up ? e : Math.min(1, e));
        h[k] = up ? Math.min(v, st.target[q] + 0.08) : v;
      }
      this.terrain.markDirty(st.rect[0], st.rect[1], st.rect[2], st.rect[3]);
      if (st.t >= st.dur) {
        for (let q = 0; q < st.cells.length; q++) h[st.cells[q]] = st.target[q];
        this.stamps.splice(i, 1);
        if (st.onDone) st.onDone();
      }
    }

    const hit = this.cursor;
    if (!this.down || !hit || !this.stroke) return;
    const g = this.game;
    const r = this.radius;
    const t = this.terrain;
    const h = t.h;
    const str = this.strength;
    switch (this.tool) {
      case 'raise': {
        const rate = 1.7 * str * dt;
        this.forRegion(hit.x, hit.z, r, (k, x, z) => {
          const w = falloff(Math.hypot(x - hit.x, z - hit.z) / r) * t.mask[k];
          if (w > 0) h[k] = Math.min(14, h[k] + rate * w);
        });
        g.sim.wetAround(hit.x, hit.z, r);
        g.sandBurst(hit, r, 2, false);
        g.audio.brush(true, 'raise', 0.5);
        break;
      }
      case 'dig': {
        const rate = 1.7 * str * dt;
        this.forRegion(hit.x, hit.z, r, (k, x, z) => {
          const w = falloff(Math.hypot(x - hit.x, z - hit.z) / r) * t.mask[k];
          if (w > 0) h[k] = Math.max(FLOOR, h[k] - rate * w);
        });
        g.sim.wetAround(hit.x, hit.z, r * 0.8);
        g.sandBurst(hit, r, 2, true);
        g.audio.brush(true, 'dig');
        g.checkTreasures();
        break;
      }
      case 'smooth': {
        const rate = Math.min(1, 7 * str * dt);
        this.forRegion(hit.x, hit.z, r, (k, x, z) => {
          const w = falloff(Math.hypot(x - hit.x, z - hit.z) / r) * t.mask[k];
          if (w <= 0) return;
          const avg = (h[k - 1] + h[k + 1] + h[k - N] + h[k + N]) * 0.25;
          h[k] += (avg - h[k]) * rate * w;
        });
        g.audio.brush(true, 'smooth');
        break;
      }
      case 'flatten': {
        const rate = Math.min(1, 5 * str * dt);
        const target = this.stroke.target;
        this.forRegion(hit.x, hit.z, r, (k, x, z) => {
          const w = falloff(Math.hypot(x - hit.x, z - hit.z) / (r * 1.05)) * t.mask[k];
          if (w > 0) h[k] += (target - h[k]) * rate * Math.min(1, w * 1.6);
        });
        g.sim.wetAround(hit.x, hit.z, r);
        g.audio.brush(true, 'flatten');
        break;
      }
      default:
        break;
    }
  }

  // ---------- bucket tower ----------
  towerDims(R) {
    return { H: 0.5 + R * 1.25, R1: R * 0.8, merlons: Math.max(4, Math.round(R * 3.2)) };
  }

  towerProfile(dx, dz, R) {
    const { H, R1, merlons } = this.towerDims(R);
    const rho = Math.hypot(dx, dz);
    if (rho > R) return 0;
    // bucket body: straight-ish tapered sides with softly rounded edges
    const side = 1 - smoothstep(R1 - 0.04 * R, R + 0.02 * R, rho);
    let h = H * side;
    // two little ledges left by the bucket's ridges
    const t = (rho - R1) / (R - R1);
    if (t > 0 && t < 1) h += 0.05 * R * (smoothstep(0.2, 0.3, t) - smoothstep(0.5, 0.6, t));
    // crenellated rim on top
    const rim = Math.max(0.3, R * 0.32);
    const inRim = smoothstep(R1 - rim - 0.08, R1 - rim + 0.04, rho) * (1 - smoothstep(R1 - 0.02, R1 + 0.08, rho));
    const th = Math.atan2(dz, dx);
    // square-ish merlons: flat tops with gently sloped sides
    const m = smoothstep(-0.25, 0.25, Math.sin(th * merlons));
    h += inRim * m * R * 0.26;
    // shallow dish in the middle of the top
    const inner = 1 - smoothstep(R1 - rim - 0.1, R1 - rim + 0.02, rho);
    h -= inner * (R * 0.05);
    return h;
  }

  // heights every cell will settle at once the towers still rising have landed
  pendingTargets() {
    const m = new Map();
    for (const st of this.stamps) for (let q = 0; q < st.cells.length; q++) m.set(st.cells[q], st.target[q]);
    return m;
  }

  settledHeights() {
    const h = this.terrain.h.slice();
    for (const st of this.stamps) for (let q = 0; q < st.cells.length; q++) h[st.cells[q]] = st.target[q];
    return h;
  }

  // finish every rising tower at once
  settleStamps() {
    if (!this.stamps.length) return;
    const h = this.terrain.h;
    for (const st of this.stamps) {
      for (let q = 0; q < st.cells.length; q++) h[st.cells[q]] = st.target[q];
      this.terrain.markDirty(st.rect[0], st.rect[1], st.rect[2], st.rect[3]);
      if (st.onDone) st.onDone();
    }
    this.stamps = [];
  }

  stampTower(x, z, R, dur = 0.45, onDone = null, silent = false) {
    const t = this.terrain;
    const pad = R * 1.35; // ground around the bucket is levelled flat
    // Work from the shape the sand is about to settle into, so buckets set down
    // in quick succession build on each other instead of on half-risen towers.
    const pend = this.stamps.length ? this.pendingTargets() : null;
    const cur = (k) => (pend && pend.has(k) ? pend.get(k) : t.h[k]);
    const isBuilt = (k, v) => v - t.h0[k] > BUILT;
    // Base: over open beach the bucket sits on the beach itself (ignoring any
    // castle it overlaps); when most of the footprint is castle already, the
    // bucket is stacked on top of it.
    let sumN = 0, nN = 0, sumA = 0, nA = 0;
    this.forRegion(x, z, R * 0.9, (k, px, pz) => {
      if (Math.hypot(px - x, pz - z) >= R * 0.9) return;
      const v = cur(k);
      sumA += v; nA++;
      if (!isBuilt(k, v)) { sumN += v; nN++; }
    });
    if (!nA) return;
    const stacked = nN < nA * 0.5;
    const base = stacked ? sumA / nA : sumN / nN;
    const cells = [], target = [], snap = [];
    let i0 = N, j0 = N, i1 = 0, j1 = 0;
    this.forRegion(x, z, pad, (k, px, pz, i, j) => {
      const rho = Math.hypot(px - x, pz - z);
      if (rho > pad) return;
      const hk = cur(k);
      const built = isBuilt(k, hk);
      let v;
      if (rho <= R) {
        // the bucket body sits on a perfectly level footprint; where it meets
        // castle that is already standing the two simply merge
        v = base + this.towerProfile(px - x, pz - z, R);
        if (built || stacked) v = Math.max(hk, v);
      } else {
        // a level apron that eases back into the surrounding beach, leaving
        // neighbouring towers and walls untouched
        if (built || stacked) return;
        const w = smoothstep(R, pad, rho);
        v = base * (1 - w) + hk * w;
      }
      v = hk + (v - hk) * t.mask[k];
      if (Math.abs(v - hk) < 1e-4) return;
      cells.push(k); target.push(v); snap.push(t.h[k]);
      i0 = Math.min(i0, i); j0 = Math.min(j0, j); i1 = Math.max(i1, i); j1 = Math.max(j1, j);
    });
    if (!cells.length) return;
    // the new bucket takes over any cells an earlier one is still raising
    if (this.stamps.length) {
      const mine = new Set(cells);
      for (const st of this.stamps) {
        let w = 0;
        for (let q = 0; q < st.cells.length; q++) {
          if (mine.has(st.cells[q])) continue;
          st.cells[w] = st.cells[q]; st.target[w] = st.target[q]; st.snap[w] = st.snap[q]; w++;
        }
        st.cells.length = st.target.length = st.snap.length = w;
      }
    }
    this.stamps.push({ cells, target, snap, t: 0, dur, rect: [i0, j0, i1, j1], onDone });
    this.stats.towers++;
    this.game.sim.wetAround(x, z, R * 1.2);
    if (!silent) {
      this.game.audio.sfx('thump');
      this.game.dustRing(new THREE.Vector3(x, base, z), R);
    }
  }

  // ---------- walls & channels along a dragged path ----------
  wallDims() {
    const R = this.radius;
    return { width: 0.5 + R * 0.6, height: 0.45 + R * 0.85, merlon: 0.18 + R * 0.06, period: Math.max(0.9, 0.75 * R) };
  }

  channelDims() {
    const R = this.radius;
    return { width: 0.55 + R * 0.65, depth: 0.35 + R * 0.4 };
  }

  carveDims() {
    // a fine knife: two to four sand cells wide whatever the brush size
    const R = this.radius;
    return { width: 0.2 + R * 0.09, depth: (0.07 + R * 0.045) * this.strength };
  }

  extendPath(hit, first) {
    const st = this.stroke;
    const minStep = this.tool === 'carve' ? 0.05 : 0.22;
    if (!first && hit.distanceTo(st.last) < minStep) return;
    const a = first ? hit.clone().add(new THREE.Vector3(0.001, 0, 0)) : st.last.clone();
    const b = hit.clone();
    if (this.tool === 'wall') this.stampWallSegment(a, b, st);
    else if (this.tool === 'carve') this.stampCarveSegment(a, b, st);
    else this.stampChannelSegment(a, b, st);
    st.s += a.distanceTo(b);
    st.last.copy(b);
    st.points.push(b.clone());
  }

  snapHeight(st, x, z) {
    // bilinear lookup in the pre-stroke snapshot
    const fi = Math.min(Math.max((x + HALF) / S, 0), N - 1.001), fj = Math.min(Math.max((z + HALF) / S, 0), N - 1.001);
    const i = fi | 0, j = fj | 0, tx = fi - i, tz = fj - j;
    const s = st.snap;
    const v0 = s[j * N + i] * (1 - tx) + s[j * N + i + 1] * tx;
    const v1 = s[(j + 1) * N + i] * (1 - tx) + s[(j + 1) * N + i + 1] * tx;
    return v0 * (1 - tz) + v1 * tz;
  }

  stampWallSegment(a, b, st) {
    const { width, height, merlon, period } = this.wallDims();
    const half = width / 2;
    const side = Math.max(0.16, height * 0.14);
    const reach = half + side + 0.3;
    const segLen = a.distanceTo(b);
    const h = this.terrain.h, mask = this.terrain.mask;
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), minZ = Math.min(a.z, b.z), maxZ = Math.max(a.z, b.z);
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const rr = Math.max(maxX - minX, maxZ - minZ) / 2 + reach;
    this.forRegion(cx, cz, rr, (k, x, z) => {
      const { d, t } = segDist(x, z, a.x, a.z, b.x, b.z);
      if (d > reach) return;
      const px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
      const base = this.snapHeight(st, px, pz);
      const s = st.s + t * segLen;
      // body with softly rounded shoulders
      let p = height * (1 - smoothstep(half - 0.05, half + side, d));
      // parapets along both edges, notched into merlons
      const par = Math.max(0.26, width * 0.3);
      const edge = smoothstep(half - par - 0.07, half - par + 0.05, d) * (1 - smoothstep(half - 0.02, half + 0.08, d));
      const ph = ((s / period) % 1 + 1) % 1;
      const notch = smoothstep(0.02, 0.14, ph) * (1 - smoothstep(0.5, 0.62, ph));
      p += edge * merlon * notch;
      p -= (1 - smoothstep(half - par - 0.1, half - par, d)) * 0.05;
      if (d > half + side * 0.6) p = Math.max(p, 0.1 * Math.pow(1 - Math.min(1, (d - half - side * 0.6) / 0.35), 2));
      const v = base + p * mask[k];
      if (v > h[k]) h[k] = v;
    });
    this.stats.wall += segLen;
    this.game.sim.wetAround(b.x, b.z, half + 0.3);
    this.game.audio.brush(true, 'raise', 1);
    this.game.sandBurst(b, half, 3, false);
  }

  stampChannelSegment(a, b, st) {
    const { width, depth } = this.channelDims();
    const half = width / 2;
    const segLen = a.distanceTo(b);
    const h = this.terrain.h, mask = this.terrain.mask;
    const startCenter = this.snapHeight(st, a.x, a.z);
    if (st.bottom === null) st.bottom = startCenter - depth;
    const endCenter = this.snapHeight(st, b.x, b.z);
    const bottomA = st.bottom;
    const bottomB = Math.min(endCenter - depth, bottomA + 0.025 * segLen);
    st.bottom = bottomB;
    const reach = half + 0.55;
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), minZ = Math.min(a.z, b.z), maxZ = Math.max(a.z, b.z);
    const rr = Math.max(maxX - minX, maxZ - minZ) / 2 + reach;
    this.forRegion((minX + maxX) / 2, (minZ + maxZ) / 2, rr, (k, x, z) => {
      const { d, t } = segDist(x, z, a.x, a.z, b.x, b.z);
      if (d > reach) return;
      const bottom = bottomA + (bottomB - bottomA) * t;
      if (d <= half) {
        const v = bottom + depth * 0.9 * Math.pow(d / half, 2.2);
        const nv = h[k] + (Math.min(h[k], v) - h[k]) * mask[k];
        if (nv < h[k]) h[k] = nv;
      } else {
        // dug sand piles up on the banks
        const q = (d - half) / 0.55;
        const berm = 0.12 * Math.sin(Math.PI * q) * mask[k];
        const base = this.snapHeight(st, x, z);
        if (h[k] >= base - 0.01 && h[k] < base + berm) h[k] = base + berm;
      }
    });
    this.game.audio.brush(true, 'channel');
    this.game.sandBurst(b, half, 3, true);
    this.game.checkTreasures();
  }

  // A fine groove cut into the surface as it was when the stroke began, so going
  // over the same line again in one stroke keeps it crisp instead of deepening it.
  // With Shift held the knife lays down a thin raised bead instead.
  stampCarveSegment(a, b, st) {
    const { width, depth } = this.carveDims();
    const reach = width / 2 + S * 0.5; // half a cell of soft edge keeps lines from stair-stepping
    const h = this.terrain.h, mask = this.terrain.mask, snap = st.snap;
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), minZ = Math.min(a.z, b.z), maxZ = Math.max(a.z, b.z);
    const rr = Math.max(maxX - minX, maxZ - minZ) / 2 + reach;
    this.forRegion((minX + maxX) / 2, (minZ + maxZ) / 2, rr, (k, x, z) => {
      const { d } = segDist(x, z, a.x, a.z, b.x, b.z);
      if (d >= reach) return;
      const p = depth * (0.5 + 0.5 * Math.cos(Math.PI * d / reach)) * mask[k];
      if (st.emboss) {
        const v = snap[k] + p;
        if (v > h[k]) h[k] = v;
      } else {
        const v = Math.max(FLOOR, snap[k] - p);
        if (v < h[k]) h[k] = v;
      }
    });
    const g = this.game;
    g.audio.brush(true, 'carve');
    // a few crumbs flicked off the blade
    if (Math.random() < 0.7) {
      const y = this.terrain.heightAt(b.x, b.z);
      const c = new THREE.Color(0.86, 0.72, 0.52).multiplyScalar(0.8 + Math.random() * 0.3);
      g.sand.emit(b.x, y + 0.03, b.z, (Math.random() - 0.5) * 0.7, 0.5 + Math.random() * 0.7, (Math.random() - 0.5) * 0.7,
        { life: 0.5, size: 0.03 + Math.random() * 0.025, color: c, gravity: -9, floor: y - 0.15 });
    }
  }
}
