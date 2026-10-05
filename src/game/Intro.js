import * as THREE from 'three';

// The opening cinematic: a flight from the dawn horizon down to the beach,
// where a sandcastle rises out of the sand before the title appears.
const KEYS = [
  { t: 0, pos: [-34, 30, -78], look: [30, 10, -420] },
  { t: 4.2, pos: [-18, 13, -44], look: [-2, 2, -12] },
  { t: 7.6, pos: [7, 3.2, -15], look: [0, 0.6, 2] },
  { t: 10.6, pos: [16, 6.0, 14], look: [0, 0.8, 0] },
  { t: 13.0, pos: [0, 7.2, 21.5], look: [0, 4.0, 0] },
];
const DURATION = 13.0;
const CENTER = new THREE.Vector3(0, 0.6, 0);

export class Intro {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.queue = [];
    this.posCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => new THREE.Vector3(...k.pos)), false, 'centripetal');
    this.lookCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => new THREE.Vector3(...k.look)), false, 'centripetal');
    this.orbit = 0;
    this.buildTime = 0;
  }

  // map wall-clock time onto the curves so each keyframe lands on time
  curveParam(t) {
    const n = KEYS.length - 1;
    for (let i = 0; i < n; i++) {
      const a = KEYS[i], b = KEYS[i + 1];
      if (t <= b.t) {
        let u = (t - a.t) / (b.t - a.t);
        if (i === 0) u = u * u * (3 - 2 * u) * 0.5 + u * 0.5;
        if (i === n - 1) u = 1 - Math.pow(1 - u, 2.2);
        return (i + u) / n;
      }
    }
    return 1;
  }

  prepare() {
    this.queue = [];
    this.setCamera(0);
    this.orbit = 0;
  }

  setCamera(t) {
    const u = this.curveParam(t);
    const cam = this.game.camera;
    cam.position.copy(this.posCurve.getPoint(u));
    cam.lookAt(this.lookCurve.getPoint(u));
  }

  setMenuCamera() {
    this.orbit = 0;
    this.updateMenuCamera(0);
  }

  play() {
    this.t = 0;
    this.done = false;
    this.buildTime = 0;
    this.queue = [];
    this.game.ui.introStart();
    this.titleShown = false;
  }

  skip() {
    if (this.done) return;
    // finish any remaining construction instantly (and quietly)
    this.runQuietly(this.queue);
    this.queue = [];
    this.finish();
  }

  runQuietly(ops) {
    const audio = this.game.audio;
    const sfx = audio.sfx;
    audio.sfx = () => {};
    try {
      for (const op of ops) op.fn(true);
    } finally {
      audio.sfx = sfx;
    }
  }

  finish() {
    this.done = true;
    this.game.ui.introEnd();
    if (!this.titleShown) this.game.ui.showTitleLogo();
    this.titleShown = true;
    this.setMenuCamera();
    this.game.showMenu();
  }

  update(dt) {
    if (this.done) return;
    this.t += dt;
    this.setCamera(Math.min(this.t, DURATION));
    if (this.t > 10.4 && !this.titleShown) {
      this.titleShown = true;
      this.game.ui.showTitleLogo();
    }
    if (this.t >= DURATION + 0.4) this.finish();
  }

  updateBuild(dt) {
    if (!this.queue.length) return;
    this.buildTime += dt;
    while (this.queue.length && this.queue[0].at <= this.buildTime) {
      const op = this.queue.shift();
      op.fn(false);
    }
  }

  updateMenuCamera(dt) {
    this.orbit += dt * 0.045;
    const cam = this.game.camera;
    const a = this.orbit;
    const r = 21.5 + Math.sin(a * 1.7) * 2;
    cam.position.set(CENTER.x + Math.sin(a) * r, 7.2 + Math.sin(a * 2.3) * 1.0, CENTER.z + Math.cos(a) * r);
    cam.lookAt(CENTER.x, CENTER.y + 3.4, CENTER.z);
  }

  buildCastleInstant() {
    // the title beach stays a clean, flat stretch of sand
    this.queue = [];
  }

  // A list of timed construction steps for the showcase castle.
  castlePlan() {
    const g = this.game;
    const tools = g.tools;
    const ops = [];
    const at = (time, fn) => ops.push({ at: time, fn });
    const tower = (time, x, z, R, silent) => at(time, (instant) => {
      tools.stampTower(x, z, R, instant ? 0 : 0.5, null, instant || silent);
      if (instant) tools.update(0);
    });
    const path = (time, pts, radius, kind, rate = 28) => {
      // subdivide the polyline and stamp it a piece at a time
      const seq = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = new THREE.Vector3(pts[i][0], 0, pts[i][1]);
        const b = new THREE.Vector3(pts[i + 1][0], 0, pts[i + 1][1]);
        const n = Math.max(1, Math.ceil(a.distanceTo(b) / 0.28));
        for (let k = 0; k <= n; k++) seq.push(a.clone().lerp(b, k / n));
      }
      const state = { st: null };
      seq.forEach((p, i) => at(time + i / rate, () => {
        const prevTool = tools.tool, prevR = tools.radius;
        tools.tool = kind;
        tools.radius = radius;
        if (!state.st) {
          state.st = { last: p.clone(), snap: g.terrain.h.slice(), s: 0, bottom: null, points: [] };
          tools.stroke = state.st;
          if (kind === 'wall') tools.stampWallSegment(p.clone().add(new THREE.Vector3(0.001, 0, 0)), p, state.st);
          else tools.stampChannelSegment(p.clone().add(new THREE.Vector3(0.001, 0, 0)), p, state.st);
        } else {
          const st = state.st;
          if (kind === 'wall') tools.stampWallSegment(st.last, p, st);
          else tools.stampChannelSegment(st.last, p, st);
          st.s += st.last.distanceTo(p);
          st.last.copy(p);
        }
        tools.stroke = null;
        tools.tool = prevTool;
        tools.radius = prevR;
        g.audio.brush(false);
      }));
    };
    const flag = (time, x, z) => at(time, () => g.placeFlag(new THREE.Vector3(x, 0, z)));
    const decor = (time, type, x, z) => at(time, () => g.placeDecor(type, new THREE.Vector3(x, 0, z)));

    const fx = 3.4, fz = 0.4, bz = 5.6, cz = 3.0;
    // moat first so the sea can flow in while the castle rises
    const ring = [];
    for (let k = 0; k <= 40; k++) {
      const a = -Math.PI / 2 + (k / 40) * Math.PI * 2;
      ring.push([Math.cos(a) * 5.6, cz + Math.sin(a) * 5.1]);
    }
    path(5.2, ring, 0.55, 'channel', 60);
    path(5.4, [[0, cz - 5.1], [0.3, -4.2], [0, -6.5], [0.2, -9]], 0.6, 'channel', 40);
    tower(6.0, -fx, fz, 0.95);
    tower(6.3, fx, fz, 0.95);
    tower(6.6, -fx, bz, 0.95);
    tower(6.9, fx, bz, 0.95);
    path(7.2, [[-fx, fz], [fx, fz]], 0.72, 'wall');
    path(7.3, [[fx, fz], [fx, bz]], 0.72, 'wall');
    path(7.4, [[fx, bz], [-fx, bz]], 0.72, 'wall');
    path(7.5, [[-fx, bz], [-fx, fz]], 0.72, 'wall');
    tower(7.9, 0, cz, 1.65);
    tower(8.7, 0, cz, 1.05);
    tower(9.4, 0, cz, 0.58);
    tower(8.2, -1.1, fz, 0.5, true);
    tower(8.35, 1.1, fz, 0.5, true);
    flag(10.0, 0, cz);
    flag(10.2, -fx, fz);
    flag(10.35, fx, fz);
    flag(10.5, -fx, bz);
    flag(10.65, fx, bz);
    // gate, windows, a bridge over the moat and some cheerful props
    const wallDecor = (time, type, x, z, dx, dz, lift) => at(time, () => g.placeOnWall(type, x, z, dx, dz, lift));
    wallDecor(9.6, 'door', 0, -1.2, 0, 1, 0.14);
    wallDecor(9.7, 'window', -2.0, -1.2, 0, 1, 0.6);
    wallDecor(9.75, 'window', 2.0, -1.2, 0, 1, 0.6);
    wallDecor(9.8, 'window', -fx, -1.6, 0, 1, 1.2);
    wallDecor(9.85, 'window', fx, -1.6, 0, 1, 1.2);
    at(9.9, () => {
      const cam = g.camera.position.clone();
      g.camera.position.set(0, 6, 12);
      g.controls.target.set(0, 0, -6);
      g.placeDecor('bridge', new THREE.Vector3(0, 0, cz - 5.15));
      g.camera.position.copy(cam);
    });
    decor(10.0, 'lantern', -1.3, -0.9);
    decor(10.05, 'lantern', 1.3, -0.9);
    decor(10.1, 'pinwheel', 4.6, 0.2);
    decor(10.15, 'flower', -4.4, 6.6);
    decor(10.2, 'flower', 4.2, 7.2);
    const shells = [['scallop', -1.6, -1.2], ['starfish', 1.9, -1.4], ['conch', 2.9, -0.9], ['scallop', -2.8, -1.0],
      ['pebble', 0.9, -1.8], ['sanddollar', -0.6, -1.9], ['starfish', -4.6, 2.0], ['scallop', 4.7, 3.0], ['coral', 5.0, 6.8], ['driftwood', -5.4, 7.4]];
    shells.forEach(([t, x, z], i) => decor(10.1 + i * 0.12, t, x, z));
    return ops.sort((a, b) => a.at - b.at);
  }
}
