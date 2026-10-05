import * as THREE from 'three';
import { N, S, HALF, FLOOR } from '../core/config.js';
import { segDist, smoothstep } from '../core/noise.js';

export const TOOLS = [
  { id: 'raise', name: '堆沙', icon: 'assets/icons/raise.png', key: '1', hint: '按住左鍵堆起濕沙' },
  { id: 'dig', name: '挖沙', icon: 'assets/icons/dig.png', key: '2', hint: '按住左鍵往下挖，也許會挖到寶藏' },
  { id: 'smooth', name: '抹順', icon: 'assets/icons/smooth.png', key: '3', hint: '把粗糙的沙面抹得圓滑' },
  { id: 'flatten', name: '壓平', icon: 'assets/icons/flatten.png', key: '4', hint: '以點下處的高度壓出平台' },
  { id: 'tower', name: '水桶塔', icon: 'assets/icons/tower.png', key: '5', hint: '點一下倒扣水桶，做出一座塔樓' },
  { id: 'wall', name: '城牆', icon: 'assets/icons/wall.png', key: '6', hint: '按住拖曳，沿路築起有城垛的城牆' },
  { id: 'channel', name: '挖渠', icon: 'assets/icons/channel.png', key: '7', hint: '按住拖曳挖出水道或護城河' },
  { id: 'decor', name: '裝飾', icon: 'assets/icons/decor.png', key: '8', hint: '點擊擺放貝殼與小物 · Ctrl+點擊移除' },
  { id: 'flag', name: '旗幟', icon: 'assets/icons/flag.png', key: '9', hint: '把旗幟插在城堡上 · Ctrl+點擊移除' },
];

const TOOL_COLORS = {
  raise: 0xffe08a, dig: 0xff9a7a, smooth: 0xbfefff, flatten: 0xd6c4ff,
  tower: 0xffffff, wall: 0xffffff, channel: 0x7fe7ff, decor: 0xffb7d0, flag: 0xff8080,
};

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
    const r = this.tool === 'wall' ? this.wallDims().width / 2 : this.tool === 'channel' ? this.channelDims().width / 2 : this.effectiveRadius();
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
    switch (this.tool) {
      case 'decor':
      case 'flag':
        if (remove) g.removeNearestProp(hit, this.tool);
        else if (this.tool === 'decor') g.placeDecor(this.decorType, hit);
        else g.placeFlag(hit);
        this.down = false;
        return;
      case 'tower':
        g.pushUndo();
        this.stampTower(hit.x, hit.z, this.radius, 0.45);
        this.down = false;
        return;
      default:
        break;
    }
    g.pushUndo();
    this.stroke = {
      last: hit.clone(),
      target: this.terrain.heightAt(hit.x, hit.z),
      snap: this.tool === 'wall' || this.tool === 'channel' ? this.terrain.h.slice() : null,
      s: 0,
      bottom: null,
      points: [hit.clone()],
    };
    if (this.tool === 'wall' || this.tool === 'channel') this.extendPath(hit, true);
  }

  move(hit) {
    if (!this.down || !hit || !this.stroke) return;
    if (this.tool === 'wall' || this.tool === 'channel') this.extendPath(hit, false);
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
        const v = st.snap[q] + (st.target[q] - st.snap[q]) * e;
        h[k] = Math.max(h[k], Math.min(v, st.target[q] + 0.08));
      }
      this.terrain.markDirty(st.rect[0], st.rect[1], st.rect[2], st.rect[3]);
      if (st.t >= st.dur) {
        for (let q = 0; q < st.cells.length; q++) h[st.cells[q]] = Math.max(h[st.cells[q]], st.target[q]);
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
    if (rho > R * 1.32) return null;
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
    // loose sand at the foot
    if (rho > R * 0.95) h = Math.max(h, 0.15 * R * Math.pow(1 - smoothstep(R * 0.95, R * 1.32, rho), 2));
    return h;
  }

  stampTower(x, z, R, dur = 0.45, onDone = null, silent = false) {
    const t = this.terrain;
    const reach = R * 1.3;
    // base: average ground under the bucket
    let sum = 0, n = 0;
    this.forRegion(x, z, R * 0.85, (k, px, pz) => {
      if (Math.hypot(px - x, pz - z) < R * 0.85) { sum += t.h[k]; n++; }
    });
    if (!n) return;
    const base = sum / n;
    const cells = [], target = [], snap = [];
    let i0 = N, j0 = N, i1 = 0, j1 = 0;
    this.forRegion(x, z, reach, (k, px, pz, i, j) => {
      const p = this.towerProfile(px - x, pz - z, R);
      if (p === null) return;
      const v = base + p * t.mask[k] + (1 - t.mask[k]) * (t.h[k] - base);
      if (v <= t.h[k]) return;
      cells.push(k); target.push(v); snap.push(t.h[k]);
      i0 = Math.min(i0, i); j0 = Math.min(j0, j); i1 = Math.max(i1, i); j1 = Math.max(j1, j);
    });
    if (!cells.length) return;
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

  extendPath(hit, first) {
    const st = this.stroke;
    const minStep = 0.22;
    if (!first && hit.distanceTo(st.last) < minStep) return;
    const a = first ? hit.clone().add(new THREE.Vector3(0.001, 0, 0)) : st.last.clone();
    const b = hit.clone();
    if (this.tool === 'wall') this.stampWallSegment(a, b, st);
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
}
