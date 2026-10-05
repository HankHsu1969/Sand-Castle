import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HALF, N, S, M } from '../core/config.js';
import { mulberry32, polyDist } from '../core/noise.js';
import { LEVELS, SHOWCASE, LEVEL_TREASURES, TREASURES } from '../world/levels.js';
import { Terrain, createSandMaterial, sandUniforms } from '../world/Terrain.js';
import { WaterSim, waveParams } from '../world/WaterSim.js';
import { Erosion } from '../world/Erosion.js';
import { Environment } from '../world/Environment.js';
import { Scenery } from '../world/Scenery.js';
import { Particles } from '../world/Particles.js';
import { Critters } from '../world/Critters.js';
import { Marine } from '../world/Marine.js';
import { Landmarks } from '../world/Landmarks.js';
import { makeDecor, makeFlag, makeChest, makeCrabHome, makeMarker, propTime } from '../world/Props.js';
import { Tools } from './Tools.js';
import { Goals } from './Goals.js';
import { Intro } from './Intro.js';
import { Post } from '../fx/Post.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { UI } from '../ui/UI.js';

const SAVE_KEY = 'sandcastle.save.v1';
const UNLOCK_ALL_LEVELS = true;
const QUALITY = {
  high: { pr: 2, shadow: 4096 },
  medium: { pr: 1.25, shadow: 2048 },
  low: { pr: 1, shadow: 1024 },
};

export class Game {
  constructor(container) {
    this.container = container;
    this.state = 'boot';
    this.time = 0;
    this.loadSave();

    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' }));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.6;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 14000);
    this.camera.position.set(0, 12, 26);

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 3.5;
    this.controls.maxDistance = 52;
    this.controls.maxPolarAngle = 1.38;
    this.controls.minPolarAngle = 0.12;
    this.controls.zoomSpeed = 0.9;
    this.controls.rotateSpeed = 0.55;
    this.controls.target.set(0, 0.8, 2);
    this.controls.enabled = false;

    this.audio = new AudioEngine();
    this.env = new Environment(renderer, this.scene);

    const tl = new THREE.TextureLoader();
    const sandMap = tl.load('assets/img/sand_albedo.jpg');
    sandMap.colorSpace = THREE.SRGBColorSpace;
    const sandNrm = tl.load('assets/img/sand_normal.jpg');
    const ripple = tl.load('assets/img/sand_ripple.jpg');
    ripple.colorSpace = THREE.SRGBColorSpace;
    const rippleN = tl.load('assets/img/sand_ripple_n.jpg');
    for (const t of [sandMap, sandNrm, ripple, rippleN]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
    sandUniforms.uSandMap.value = sandMap;
    sandUniforms.uSandNormal.value = sandNrm;
    sandUniforms.uRipple.value = ripple;
    sandUniforms.uRippleN.value = rippleN;

    this.sandMat = createSandMaterial();
    this.terrain = new Terrain(this.sandMat);
    const skirtMat = createSandMaterial();
    skirtMat.side = THREE.DoubleSide;
    this.terrain.skirt.material = skirtMat;
    this.scene.add(this.terrain.mesh, this.terrain.skirt);

    this.sim = new WaterSim(this.terrain);
    this.env.attachWater(this.sim.material);
    sandUniforms.uSim.value = this.sim.simTex;
    this.scene.add(this.sim.mesh);
    this.erosion = new Erosion(this.terrain, this.sim);

    this.scenery = new Scenery(this.scene);
    this.sand = new Particles(this.scene, { max: 2500 });
    this.sparkles = new Particles(this.scene, { max: 900, additive: true, shape: 1 });
    this.critters = new Critters(this.scene);
    this.marine = new Marine(this.scene);
    this.landmarks = new Landmarks(this.scene);

    this.tools = new Tools(this);
    this.goals = new Goals(this);
    this.post = new Post(renderer, this.scene, this.camera);
    this.ui = new UI(this);
    this.intro = new Intro(this);

    this.props = [];
    this.treasures = [];
    this.chests = [];
    this.undoStack = [];
    this.flagColor = 0;
    this.keys = new Set();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pointerInside = false;
    this.clock = new THREE.Clock();

    this.applyQuality(this.save.settings.quality);
    this.post.setTilt(this.save.settings.tilt !== false);
    this.bindInput();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  // ---------------- persistence ----------------
  loadSave() {
    this.save = { unlocked: 1, completed: [], treasures: [], settings: { quality: 'high', tilt: true } };
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (s) this.save = { ...this.save, ...s, settings: { ...this.save.settings, ...(s.settings || {}) } };
    } catch { /* fresh save */ }
    // testing build: every beach is open
    if (UNLOCK_ALL_LEVELS) this.save.unlocked = LEVELS.length;
  }

  persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch { /* ignore */ }
  }

  applyQuality(q) {
    const cfg = QUALITY[q] || QUALITY.high;
    this.save.settings.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.pr));
    const sh = this.env.sun.shadow;
    if (sh.mapSize.x !== cfg.shadow) {
      sh.mapSize.set(cfg.shadow, cfg.shadow);
      if (sh.map) { sh.map.dispose(); sh.map = null; }
    }
    this.post.setQuality(q);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const cfg = QUALITY[this.save.settings.quality] || QUALITY.high;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.pr));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.sand.setScale(h * pr, this.camera.fov);
    this.sparkles.setScale(h * pr, this.camera.fov);
  }

  // ---------------- boot & flow ----------------
  boot() {
    this.loadLevel(SHOWCASE, { showcase: true });
    this.intro.prepare();
    // Music starts right away when the browser allows autoplay; otherwise the
    // click on the cover (a user gesture) starts it together with the intro.
    this.audio.start();
    this.audio.playMusic('title');
    const unlock = () => this.unlockAudio();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    this.state = 'gate';
    this.ui.showGate();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  enterFromGate() {
    if (this.state !== 'gate') return;
    this.unlockAudio();
    this.audio.sfx('whoosh');
    this.audio.sfx('sparkle');
    this.state = 'intro';
    this.intro.play();
  }

  // browsers only allow sound after a user gesture: the first click or key
  // anywhere quietly starts the music and the surf
  unlockAudio() {
    this.audio.resume();
  }

  showMenu() {
    this.state = 'menu';
    this.controls.enabled = false;
    this.ui.showMenu();
    this.audio.playMusic('title');
  }

  async startLevel(index) {
    const level = LEVELS[index];
    if (!level) return;
    this.audio.sfx('whoosh');
    this.ui.hideTitle();
    this.ui.closePanels(true);
    await this.ui.fadeOut(level);
    this.loadLevel(level, { showcase: false });
    this.levelIndex = index;
    this.state = 'play';
    this.controls.enabled = true;
    this.ui.showHUD(level);
    this.audio.playMusic(level.music);
    await this.ui.fadeIn();
    this.ui.levelBanner(level);
  }

  backToMenu() {
    this.ui.fadeOut(null).then(() => {
      this.loadLevel(SHOWCASE, { showcase: true });
      this.intro.buildCastleInstant();
      this.intro.setMenuCamera();
      this.showMenu();
      this.ui.fadeIn();
    });
  }

  levelComplete() {
    if (this.state !== 'play') return;
    const id = this.level.id;
    if (!this.save.completed.includes(id)) this.save.completed.push(id);
    this.save.unlocked = Math.max(this.save.unlocked, Math.min(LEVELS.length, id + 1));
    this.persist();
    this.state = 'complete';
    this.tools.end();
    this.audio.sfx('complete');
    this.celebrate();
    this.ui.showComplete(this.level, {
      towers: this.tools.stats.towers,
      wall: this.tools.stats.wall,
      treasures: this.treasures.filter((t) => t.found).length,
      decor: this.props.filter((p) => p.kind === 'decor').length,
      last: id === LEVELS.length,
    });
  }

  // ---------------- level loading ----------------
  loadLevel(level, { showcase }) {
    this.level = level;
    const heightFn = level.build();
    this.heightFn = heightFn;
    this.terrain.load(heightFn);
    this.env.applyLevel(level);
    this.post.setExposure(level.sky.exposure);
    this.env.buildOuter(heightFn, this.sandMat);
    this.scenery.build(level, heightFn);
    this.landmarks.build(level, heightFn);
    sandUniforms.uWetLine.value = level.tide.high * 0.7 + 0.2;

    this.audio.setTideIntensity(0);
    waveParams.surge = 1;
    waveParams.amp = level.tide.waveAmp;
    waveParams.omega = (2 * Math.PI) / level.tide.wavePeriod;
    waveParams.k = 0.42;
    if (this.audio.ctx) this.audio.setWavePeriod(level.tide.wavePeriod);

    // rivers flowing in from the land-side border
    let sources = null;
    if (level.rivers) {
      sources = [];
      const j = M - 1;
      for (let i = 0; i < M; i++) {
        const c = j * M + i;
        const x = this.sim.cx[c], z = this.sim.cz[c];
        let rd = Infinity;
        for (const r of level.rivers) rd = Math.min(rd, polyDist(x, z, r));
        if (rd < 1.3) sources.push([c, this.terrain.originalAt(x, z) + 0.42]);
      }
    }
    this.sim.reset(level.tide.low, sources);
    this.marine.build(level, heightFn, this.terrain, level.tide.low);

    // clear props
    for (const p of this.props) this.scene.remove(p.obj);
    for (const c of this.chests) this.scene.remove(c.obj);
    this.props = [];
    this.chests = [];
    if (this.marker) { this.scene.remove(this.marker); this.marker = null; }
    if (this.crabHome) { this.scene.remove(this.crabHome); this.crabHome = null; }
    this.undoStack = [];
    this.tools.stats = { towers: 0, wall: 0 };
    this.tools.stamps = [];

    if (level.marker) {
      this.marker = makeMarker(level.marker.r);
      this.marker.position.set(level.marker.x, 0, level.marker.z);
      this.scene.add(this.marker);
    }
    if (level.crabHome && !showcase) {
      this.crabHome = makeCrabHome();
      this.crabHome.position.set(level.crabHome.x, this.terrain.heightAt(level.crabHome.x, level.crabHome.z), level.crabHome.z);
      this.scene.add(this.crabHome);
    }

    this.setupTreasures(level, showcase);
    const rand = mulberry32(level.seed + 99);
    this.critters.setupCrabs(this.terrain, showcase ? 2 : 3, rand);
    this.goals.setup(showcase ? { ...level, goals: [] } : level);
    this.sim.tide = level.tide.low;

    // camera
    this.controls.target.set(0, 0.8, 0);
    this.camera.position.set(0, 8.2, 21);
    this.controls.update();
    this.updateProps(true);
  }

  setupTreasures(level, showcase) {
    this.treasures = [];
    if (showcase) return;
    const ids = LEVEL_TREASURES[level.id] || [];
    const rand = mulberry32(level.seed * 13 + 5);
    const avoid = [];
    if (level.marker) avoid.push(level.marker);
    if (level.crabHome) avoid.push(level.crabHome);
    for (const id of ids) {
      for (let tries = 0; tries < 400; tries++) {
        const x = (rand() - 0.5) * (2 * HALF - 10);
        const z = -HALF + 6 + rand() * (2 * HALF - 12);
        const h0 = this.terrain.originalAt(x, z);
        if (h0 < level.tide.low + 0.3 || h0 > 3.5) continue;
        if (avoid.some((a) => Math.hypot(a.x - x, a.z - z) < 4)) continue;
        if (this.treasures.some((t) => Math.hypot(t.x - x, t.z - z) < 7)) continue;
        if (level.rivers && level.rivers.some((r) => polyDist(x, z, r) < 3)) continue;
        this.treasures.push({ id, x, z, depth: 0.35 + rand() * 0.25, found: false, hint: 1 + rand() * 3 });
        break;
      }
    }
  }

  // ---------------- props ----------------
  placeDecor(type, hit) {
    this.pushUndo();
    const obj = makeDecor(type);
    const p = { kind: 'decor', type, x: hit.x, z: hit.z, rot: Math.random() * Math.PI * 2, scale: 0.85 + Math.random() * 0.4, obj };
    const view = new THREE.Vector3().subVectors(this.controls.target, this.camera.position);
    if (obj.userData.wall) {
      // doors and windows stick to the face of a wall, looking outward
      const n = this.terrain.normalAt(hit.x, hit.z);
      const hor = Math.hypot(n.x, n.z);
      p.rot = hor > 0.35 ? Math.atan2(n.x, n.z) : Math.atan2(-view.x, -view.z);
      p.y0 = hit.y !== undefined && hit.y !== 0 ? hit.y : this.terrain.heightAt(hit.x, hit.z);
      p.scale = 1;
      p.x += Math.sin(p.rot) * 0.02;
      p.z += Math.cos(p.rot) * 0.02;
    } else if (obj.userData.facing) {
      // bridges span along the view direction
      p.rot = Math.atan2(-view.z, view.x);
      p.scale = 1;
    }
    this.scene.add(obj);
    this.props.push(p);
    this.updateProp(p);
    obj.scale.setScalar(0.01);
    p.pop = 0;
    const s = type === 'driftwood' ? 'wood' : type === 'pebble' || type === 'seaweed' || type === 'coral' ? 'soft' : 'shell';
    this.audio.sfx(s);
    this.sparkleBurst(hit, 6, 0.4);
    this.goals.evaluate(false);
  }

  placeFlag(hit) {
    const flags = this.props.filter((p) => p.kind === 'flag');
    if (flags.length >= 8) {
      this.ui.toast('最多只能插 8 面旗幟喔', 'info');
      return;
    }
    this.pushUndo();
    const obj = makeFlag(this.flagColor++);
    const p = { kind: 'flag', type: 'flag', x: hit.x, z: hit.z, rot: Math.random() * Math.PI * 2, scale: 1, obj, fallen: false };
    this.scene.add(obj);
    this.props.push(p);
    this.updateProp(p);
    obj.scale.setScalar(0.01);
    p.pop = 0;
    this.audio.sfx('flag');
    this.sparkleBurst(hit, 10, 0.6);
    this.goals.evaluate(false);
  }

  // Find the face of a wall by walking toward it from (x,z) along (dx,dz).
  placeOnWall(type, x, z, dx, dz, lift = 0.25) {
    const base = this.terrain.heightAt(x, z);
    for (let k = 0; k < 60; k++) {
      const px = x + dx * k * 0.05, pz = z + dz * k * 0.05;
      const h = this.terrain.heightAt(px, pz);
      if (h > base + lift) {
        this.placeDecor(type, new THREE.Vector3(px, h, pz));
        return;
      }
    }
  }

  removeNearestProp(hit, tool) {
    const kind = tool === 'flag' ? 'flag' : 'decor';
    let best = null, bd = 0.9;
    for (const p of this.props) {
      if (p.kind !== kind) continue;
      const d = Math.hypot(p.x - hit.x, p.z - hit.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) return;
    this.pushUndo();
    this.scene.remove(best.obj);
    this.props.splice(this.props.indexOf(best), 1);
    this.audio.sfx('remove');
    this.goals.evaluate(false);
  }

  knockFlag(f) {
    f.fallen = true;
    f.fallT = 0;
    this.audio.sfx('splash');
    this.splashBurst(new THREE.Vector3(f.x, this.terrain.heightAt(f.x, f.z), f.z));
  }

  floodCrabs(on) {
    if (!this.crabHome) return;
    this.crabHome.userData.flooded = on;
    if (on) {
      this.audio.sfx('splash');
      this.audio.sfx('crab');
    }
  }

  cleanupAfterTide() {
    const washed = this.props.filter((p) => p.kind === 'flag' && p.fallen);
    for (const p of washed) {
      this.scene.remove(p.obj);
      this.props.splice(this.props.indexOf(p), 1);
    }
    this.goals.evaluate(false);
  }

  updateProp(p) {
    const t = this.terrain;
    const y = t.heightAt(p.x, p.z);
    const o = p.obj;
    o.position.set(p.x, y - 0.01, p.z);
    if (o.userData.wall) {
      o.position.y = p.y0;
      o.rotation.set(0, p.rot, 0);
      return;
    }
    if (o.userData.facing) {
      const ca = Math.cos(p.rot), sa = Math.sin(p.rot);
      const h1 = t.heightAt(p.x + ca * 0.6, p.z - sa * 0.6), h2 = t.heightAt(p.x - ca * 0.6, p.z + sa * 0.6);
      o.position.y = Math.max(y, Math.min(h1, h2) - 0.02);
      o.rotation.set(0, p.rot, 0);
      return;
    }
    if (p.kind === 'decor' && o.userData.flat) {
      const n = t.normalAt(p.x, p.z);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      o.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot));
    } else {
      o.rotation.set(0, p.rot, 0);
    }
  }

  updateProps(force, dt = 0) {
    const ver = this.terrain.version;
    const moved = force || ver !== this.lastPropVersion;
    this.lastPropVersion = ver;
    for (const p of this.props) {
      if (moved) this.updateProp(p);
      if (p.pop !== undefined && p.pop < 1) {
        p.pop = Math.min(1, p.pop + dt * 4);
        const e = 1 + 2.2 * Math.pow(p.pop - 1, 3) + 1.2 * Math.pow(p.pop - 1, 2);
        p.obj.scale.setScalar(p.scale * e);
      }
      if (p.obj.userData.spinner) p.obj.userData.spinner.rotation.z -= dt * (4 + Math.sin(this.time * 0.7) * 2);
      if (p.kind === 'flag' && p.fallen) {
        p.fallT = Math.min(1, (p.fallT || 0) + dt * 1.5);
        p.obj.rotation.set(0, p.rot, 0);
        p.obj.rotateX(-1.45 * p.fallT * p.fallT);
      }
    }
    if (this.marker) {
      for (const c of this.marker.children) {
        if (c.userData.ox === undefined) continue;
        const x = this.marker.position.x + c.userData.ox, z = this.marker.position.z + c.userData.oz;
        c.position.y = this.terrain.heightAt(x, z) - 0.02;
      }
      const ring = this.marker.userData.ring;
      const mk = this.level.marker;
      ring.position.y = this.terrain.heightAt(mk.x, mk.z) + 0.06;
      const done = this.goals.list.find((g) => g.type === 'waterMarker')?.done;
      ring.material.opacity = done ? 0 : 0.25 + 0.25 * Math.sin(this.time * 3);
    }
    if (this.crabHome) {
      const ch = this.level.crabHome;
      const base = this.terrain.heightAt(ch.x, ch.z);
      const flooded = this.crabHome.userData.flooded;
      this.crabHome.position.y = base;
      this.crabHome.userData.crabs.forEach((c, i) => {
        const bob = flooded ? Math.max(0, this.sim.depthAt(ch.x, ch.z)) + Math.sin(this.time * 3 + i) * 0.05 : 0;
        c.position.y = bob;
        c.userData.legs.forEach((leg, k) => { leg.rotation.z = Math.sin(this.time * (flooded ? 20 : 2) + k + i) * (flooded ? 0.5 : 0.08); });
      });
    }
  }

  // ---------------- treasures ----------------
  checkTreasures() {
    for (const t of this.treasures) {
      if (t.found) continue;
      const h = this.terrain.heightAt(t.x, t.z);
      if (h < this.terrain.originalAt(t.x, t.z) - t.depth + 0.04) this.revealTreasure(t);
    }
  }

  revealTreasure(t) {
    t.found = true;
    const info = TREASURES[t.id];
    const chest = makeChest();
    const y = this.terrain.heightAt(t.x, t.z);
    chest.position.set(t.x, y, t.z);
    chest.rotation.y = Math.random() * Math.PI * 2;
    chest.scale.setScalar(0.01);
    this.scene.add(chest);
    this.chests.push({ obj: chest, t: 0, x: t.x, z: t.z });
    this.audio.sfx('treasure');
    this.sparkleBurst(new THREE.Vector3(t.x, y + 0.3, t.z), 40, 1.4);
    if (!this.save.treasures.includes(info.id)) {
      this.save.treasures.push(info.id);
      this.persist();
    }
    setTimeout(() => this.ui.showTreasure(info), 700);
    this.goals.evaluate(false);
  }

  updateTreasures(dt) {
    for (const c of this.chests) {
      c.t += dt;
      const o = c.obj;
      const pop = Math.min(1, c.t * 2.5);
      o.scale.setScalar(1.3 * (1 + 2.2 * Math.pow(pop - 1, 3) + 1.2 * Math.pow(pop - 1, 2)));
      o.position.y = this.terrain.heightAt(c.x, c.z) + Math.max(0, 0.15 - c.t * 0.1);
      const open = Math.min(1, Math.max(0, (c.t - 0.4) * 1.5));
      o.userData.lid.rotation.x = -open * 1.9;
      o.userData.glow.material.opacity = open * (0.6 + 0.3 * Math.sin(this.time * 4));
      if (Math.random() < dt * 6 && c.t < 6) this.sparkleBurst(new THREE.Vector3(c.x, o.position.y + 0.35, c.z), 1, 0.6);
    }
    // glints hinting at buried treasure
    for (const t of this.treasures) {
      if (t.found) continue;
      t.hint -= dt;
      const near = this.tools.tool === 'dig' && this.tools.cursor && Math.hypot(this.tools.cursor.x - t.x, this.tools.cursor.z - t.z) < 2;
      if (t.hint <= 0 || (near && Math.random() < dt * 3)) {
        t.hint = 2.5 + Math.random() * 4;
        const y = this.terrain.heightAt(t.x, t.z);
        const jx = (Math.random() - 0.5) * 0.8, jz = (Math.random() - 0.5) * 0.8;
        this.sparkles.emit(t.x + jx, y + 0.06, t.z + jz, 0, 0.25, 0, { life: 1.2, size: 0.16, color: new THREE.Color(1.6, 1.4, 0.8), gravity: 0 });
      }
    }
  }

  // ---------------- particles ----------------
  sandBurst(p, r, n, digging) {
    const col = new THREE.Color(0.85, 0.7, 0.5);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, rr = Math.random() * r * 0.8;
      const x = p.x + Math.cos(a) * rr, z = p.z + Math.sin(a) * rr;
      const y = this.terrain.heightAt(x, z);
      const c = col.clone().multiplyScalar(0.75 + Math.random() * 0.4);
      if (digging) {
        this.sand.emit(x, y + 0.05, z, Math.cos(a) * 1.2, 1.5 + Math.random() * 1.5, Math.sin(a) * 1.2, { life: 0.8, size: 0.05 + Math.random() * 0.04, color: c, gravity: -9, floor: y - 0.2 });
      } else {
        this.sand.emit(x, y + 0.6 + Math.random() * 0.4, z, (Math.random() - 0.5) * 0.4, -1, (Math.random() - 0.5) * 0.4, { life: 0.45, size: 0.05 + Math.random() * 0.04, color: c, gravity: -10, floor: y });
      }
    }
  }

  dustRing(p, r) {
    const col = new THREE.Color(0.88, 0.76, 0.58);
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      const y = this.terrain.heightAt(x, z);
      this.sand.emit(x, y + 0.05, z, Math.cos(a) * 1.8, 0.8 + Math.random(), Math.sin(a) * 1.8, { life: 0.7, size: 0.07, color: col.clone().multiplyScalar(0.8 + Math.random() * 0.3), gravity: -6, floor: y - 0.1 });
    }
  }

  splashBurst(p) {
    for (let k = 0; k < 30; k++) {
      const a = Math.random() * Math.PI * 2;
      this.sand.emit(p.x, p.y + 0.1, p.z, Math.cos(a) * 1.4, 2 + Math.random() * 2, Math.sin(a) * 1.4, { life: 0.9, size: 0.07, color: new THREE.Color(0.9, 0.97, 1.0), gravity: -9 });
    }
  }

  sparkleBurst(p, n, spread) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * spread;
      this.sparkles.emit(p.x, p.y + 0.15, p.z, Math.cos(a) * s, 0.6 + Math.random() * 1.6, Math.sin(a) * s, { life: 0.8 + Math.random() * 0.8, size: 0.12 + Math.random() * 0.12, color: new THREE.Color(1.8, 1.5, 0.9), gravity: -1.2 });
    }
  }

  celebrate() {
    const colors = [[2, 0.6, 0.6], [2, 1.6, 0.5], [0.6, 1.8, 2], [1.6, 0.8, 2], [0.8, 2, 1]];
    let n = 0;
    const burst = () => {
      if (n++ > 7) return;
      const c = new THREE.Color(...colors[n % colors.length]);
      const x = (Math.random() - 0.5) * 16, z = -6 - Math.random() * 10, y = 9 + Math.random() * 5;
      for (let k = 0; k < 70; k++) {
        const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), sp = 4 + Math.random() * 1.5;
        this.sparkles.emit(x, y, z, Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp, Math.sin(ph) * Math.sin(th) * sp, { life: 1.4 + Math.random() * 0.6, size: 0.35, color: c, gravity: -3 });
      }
      this.audio.sfx('sparkle');
      setTimeout(burst, 350 + Math.random() * 300);
    };
    burst();
  }

  // ---------------- undo ----------------
  pushUndo() {
    this.undoStack.push({
      h: this.terrain.h.slice(),
      props: this.props.map((p) => ({ ...p })),
      stats: { ...this.tools.stats },
    });
    if (this.undoStack.length > 15) this.undoStack.shift();
  }

  undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    this.terrain.h.set(s.h);
    this.terrain.markDirty(0, 0, N - 1, N - 1);
    for (const p of this.props) if (!s.props.some((q) => q.obj === p.obj)) this.scene.remove(p.obj);
    for (const q of s.props) if (!this.props.includes(q) && !q.obj.parent) this.scene.add(q.obj);
    this.props = s.props.map((q) => {
      const live = q;
      live.pop = undefined;
      live.obj.scale.setScalar(live.scale);
      return live;
    });
    this.tools.stats = s.stats;
    this.audio.sfx('undo');
    this.updateProps(true);
    this.goals.evaluate(true);
  }

  // ---------------- input ----------------
  bindInput() {
    const el = this.renderer.domElement;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointermove', (e) => {
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.pointerInside = true;
    });
    el.addEventListener('pointerleave', () => { this.pointerInside = false; });
    el.addEventListener('pointerdown', (e) => {
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.pointerInside = true;
      if (this.state !== 'play' || e.button !== 0) return;
      if (e.pointerType === 'touch' && !e.isPrimary) return;
      el.setPointerCapture(e.pointerId);
      const hit = this.pick();
      this.tools.updateCursor(hit);
      this.tools.begin(hit, e);
    });
    el.addEventListener('pointerup', (e) => {
      if (e.button === 0 || e.pointerType === 'touch') this.tools.end();
    });
    el.addEventListener('wheel', (e) => {
      if (this.state === 'play' && e.altKey) {
        e.preventDefault();
        this.ui.nudgeBrush(e.deltaY < 0 ? 0.1 : -0.1);
      }
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (this.state === 'gate' && (k === ' ' || k === 'enter')) { this.ui.leaveGate(); return; }
      if (this.state === 'intro' && (k === 'escape' || k === ' ' || k === 'enter')) { this.intro.skip(); return; }
      if (this.state !== 'play') {
        if (k === 'escape') this.ui.handleEscape();
        return;
      }
      if (k === 'escape') { this.ui.togglePause(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); this.undo(); return; }
      if (k === '[') this.ui.nudgeBrush(-0.15);
      if (k === ']') this.ui.nudgeBrush(0.15);
      if (k === 't') this.ui.requestTide();
      if (k === 'h') this.ui.toggleHelp();
      const tool = this.tools && ['1', '2', '3', '4', '5', '6', '7', '8', '9'].indexOf(k);
      if (tool >= 0) this.ui.selectTool(tool);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => { this.keys.clear(); this.tools.end(); });
  }

  pick() {
    if (!this.pointerInside) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.terrain.raycast(this.raycaster.ray);
  }

  moveCamera(dt) {
    const k = this.keys;
    const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const r = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const rot = (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0);
    const c = this.controls;
    if (f || r) {
      const dir = new THREE.Vector3().subVectors(c.target, this.camera.position);
      dir.y = 0;
      dir.normalize();
      const right = new THREE.Vector3(-dir.z, 0, dir.x);
      const speed = 6 + c.getDistance() * 0.35;
      const move = dir.multiplyScalar(f * speed * dt).add(right.multiplyScalar(r * speed * dt));
      c.target.add(move);
      this.camera.position.add(move);
    }
    if (rot) {
      const off = new THREE.Vector3().subVectors(this.camera.position, c.target);
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot * dt * 1.2);
      this.camera.position.copy(c.target).add(off);
    }
    // keep the focus on the beach
    const lim = HALF + 4;
    const tx = THREE.MathUtils.clamp(c.target.x, -lim, lim), tz = THREE.MathUtils.clamp(c.target.z, -lim, lim);
    const dx = tx - c.target.x, dz = tz - c.target.z;
    if (dx || dz) { c.target.x = tx; c.target.z = tz; this.camera.position.x += dx; this.camera.position.z += dz; }
    const ground = Math.max(this.terrain.inside(c.target.x, c.target.z) ? this.terrain.heightAt(c.target.x, c.target.z) : 0, this.sim.tide);
    c.target.y += (ground + 0.3 - c.target.y) * Math.min(1, dt * 2);
  }

  constrainCamera() {
    const p = this.camera.position;
    let floor = this.sim.tide + 0.6;
    if (this.terrain.inside(p.x, p.z)) floor = Math.max(floor, this.terrain.heightAt(p.x, p.z) + 0.7);
    if (p.y < floor) p.y = floor;
  }

  // ---------------- main loop ----------------
  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    propTime.value = this.time;

    if (this.state === 'play' || this.state === 'complete') {
      this.moveCamera(dt);
      this.controls.update();
      this.constrainCamera();
    } else if (this.state === 'intro') {
      this.intro.update(dt);
    } else if (this.state === 'menu' || this.state === 'ending') {
      this.intro.updateMenuCamera(dt);
    }

    const playing = this.state === 'play' || this.state === 'complete';
    let hit = null;
    if (playing) {
      hit = this.pick();
      this.tools.updateCursor(hit);
    } else {
      this.tools.updateCursor(null);
    }
    this.tools.update(dt);
    if (this.state === 'intro' || this.state === 'menu' || this.state === 'gate') this.intro.updateBuild(dt);

    if (playing) this.goals.update(dt);
    this.sim.update(dt);
    if (playing) this.erosion.update(dt);
    const rect = this.terrain.flush();
    if (rect) this.sim.syncGround(rect);

    this.updateProps(false, dt);
    this.updateTreasures(dt);
    this.critters.update(dt, this.time, this.sim, playing ? hit : null);
    this.marine.update(dt, this.time, this.sim.tide, this.sparkles);
    this.landmarks.update(dt, this.time, this.sim.tide);
    this.sand.update(dt);
    this.sparkles.update(dt);
    this.env.update(dt, this.time, this.sim, this.camera);
    this.scenery.update(dt, this.time, this.sim.tide);
    if (playing) this.ui.update(dt);

    this.post.render(dt);
  }
}
