import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HALF } from '../core/config.js';
import { mulberry32 } from '../core/noise.js';
import { withFog } from './fog.js';
import { makeDecor } from './Props.js';

export const landmarkTime = { value: 0 };

// Torch flame: a real flame photo on an upright, camera-facing card. The tip
// sways and licks while the base stays put, and the whole flame flickers.
const FLAME_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec3 up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    vec3 right = normalize(cross(up, vec3(0.0, 0.0, 1.0)));
    float sx = length(modelMatrix[0].xyz), sy = length(modelMatrix[1].xyz);
    mv.xyz += right * position.x * sx + up * position.y * sy;
    gl_Position = projectionMatrix * mv;
  }`;
const FLAME_FRAG = `
  uniform sampler2D map;
  uniform float time;
  uniform float seed;
  varying vec2 vUv;
  void main() {
    float h = vUv.y;
    vec2 uv = vUv;
    uv.x += (sin(h * 8.0 - time * 7.0 + seed) * 0.5 + sin(h * 15.0 - time * 11.0 + seed * 1.7) * 0.3) * 0.07 * h * h;
    uv.y = h * (1.0 + 0.07 * sin(time * 9.0 + seed * 2.3));
    float flick = 0.88 + 0.12 * sin(time * 17.0 + seed * 3.1) * sin(time * 5.3 + seed);
    gl_FragColor = vec4(texture2D(map, uv).rgb * 2.4 * flick, 1.0);
  }`;

// ---------- procedural textures ----------
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

const woodTex = () => canvasTex(256, 256, (g, w, h) => {
  const rand = mulberry32(8);
  for (let y = 0; y < h; y += 32) {
    const tone = 95 + rand() * 40;
    g.fillStyle = `rgb(${tone + 35},${tone + 15},${tone - 10})`;
    g.fillRect(0, y, w, 32);
    for (let k = 0; k < 40; k++) {
      g.strokeStyle = `rgba(60,40,25,${0.08 + rand() * 0.15})`;
      g.lineWidth = 1;
      const yy = y + rand() * 32;
      g.beginPath(); g.moveTo(0, yy); g.bezierCurveTo(w * 0.3, yy + rand() * 4 - 2, w * 0.6, yy + rand() * 4 - 2, w, yy); g.stroke();
    }
    g.fillStyle = 'rgba(40,25,15,0.65)';
    g.fillRect(0, y + 30, w, 2);
    for (let k = 0; k < 3; k++) { g.fillStyle = 'rgba(50,50,50,0.7)'; g.beginPath(); g.arc(rand() * w, y + 16, 1.6, 0, 7); g.fill(); }
  }
});

const thatchTex = () => canvasTex(256, 256, (g, w, h) => {
  const rand = mulberry32(9);
  g.fillStyle = '#8a6a3a'; g.fillRect(0, 0, w, h);
  for (let k = 0; k < 1600; k++) {
    const x = rand() * w, y = rand() * h, len = 18 + rand() * 30;
    const l = 45 + rand() * 30;
    g.strokeStyle = `hsl(${38 + rand() * 10},${40 + rand() * 20}%,${l}%)`;
    g.lineWidth = 1 + rand() * 1.5;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 4, y + len); g.stroke();
  }
  for (let y = 0; y < h; y += 42) { g.fillStyle = 'rgba(40,25,10,0.35)'; g.fillRect(0, y, w, 3); }
});

const stripeTex = () => canvasTex(64, 256, (g, w, h) => {
  for (let y = 0; y < h; y += 64) {
    g.fillStyle = '#f4f1ea'; g.fillRect(0, y, w, 32);
    g.fillStyle = '#d64545'; g.fillRect(0, y + 32, w, 32);
  }
  for (let k = 0; k < 300; k++) { g.fillStyle = `rgba(80,60,40,${Math.random() * 0.12})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
}, true);

export class Landmarks {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    const wt = woodTex();
    this.wood = withFog(new THREE.MeshStandardMaterial({ map: wt, roughness: 0.85, color: 0xd8c8b0 }), 'lm-wood');
    this.darkWood = withFog(new THREE.MeshStandardMaterial({ map: wt, roughness: 0.9, color: 0x8a6a50 }), 'lm-wood');
    this.thatch = withFog(new THREE.MeshStandardMaterial({ map: thatchTex(), roughness: 1, side: THREE.DoubleSide }), 'lm-thatch');
    this.bamboo = withFog(new THREE.MeshStandardMaterial({ color: 0xc9b06a, roughness: 0.6 }), 'lm-plain');
    this.white = withFog(new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.6 }), 'lm-plain');
    this.red = withFog(new THREE.MeshStandardMaterial({ color: 0xc23b3b, roughness: 0.5 }), 'lm-plain');
    this.stripes = withFog(new THREE.MeshStandardMaterial({ map: stripeTex(), roughness: 0.6 }), 'lm-wood');
    this.rope = withFog(new THREE.MeshStandardMaterial({ color: 0xd9c49a, roughness: 0.9 }), 'lm-plain');
    this.hullBlue = withFog(new THREE.MeshStandardMaterial({ color: 0x2f6f9f, roughness: 0.5, side: THREE.DoubleSide }), 'lm-plain');
    this.hullInner = withFog(new THREE.MeshStandardMaterial({ color: 0xe9e2d0, roughness: 0.7, side: THREE.DoubleSide }), 'lm-plain');
    this.lamp = new THREE.MeshStandardMaterial({ color: 0xfff1c2, emissive: 0xffd36b, emissiveIntensity: 2.2, roughness: 0.2 });
    // tiki torches: bamboo pole, woven rattan head, a real flame
    const tl = new THREE.TextureLoader();
    const photo = (url, rx, ry) => {
      const t = tl.load(url);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(rx, ry);
      t.anisotropy = 4;
      return t;
    };
    this.torchPole = withFog(new THREE.MeshStandardMaterial({ map: photo('assets/img/torch_bamboo.jpg', 1, 2.5), roughness: 0.6 }), 'lm-wood');
    this.torchHead = withFog(new THREE.MeshStandardMaterial({ map: photo('assets/img/torch_rattan.jpg', 3, 1), roughness: 0.9 }), 'lm-wood');
    this.torchFuel = withFog(new THREE.MeshStandardMaterial({ color: 0x24170f, roughness: 1 }), 'lm-plain');
    this.flameTex = tl.load('assets/img/torch_flame.jpg');
    this.flameTex.colorSpace = THREE.SRGBColorSpace;
    this.flameTime = { value: 0 };
    this.glowTex = canvasTex(64, 64, (g, w, h) => {
      const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      r.addColorStop(0, 'rgba(255,190,110,1)');
      r.addColorStop(0.35, 'rgba(255,140,50,0.45)');
      r.addColorStop(1, 'rgba(255,110,30,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, w, h);
    }, false);
    this.flames = [];
    this.items = [];
  }

  clear() {
    for (const o of this.items) { this.group.remove(o); if (o.isInstancedMesh) o.dispose(); }
    this.items = [];
    this.flames = [];
    this.floaters = [];
  }

  add(o) {
    o.traverse((m) => { if (m.isMesh && !m.userData.noShadow) { m.castShadow = true; m.receiveShadow = true; } });
    this.group.add(o);
    this.items.push(o);
    return o;
  }

  // z of the low-tide shoreline at a given x (searching seaward from the land)
  shoreZ(x, from = 40, to = -120) {
    for (let z = from; z > to; z -= 0.5) if (this.h(x, z) < 0) return z + 0.5;
    return null;
  }

  // ---------- builders ----------
  pier(length, width = 2.2, deck = 1.9) {
    const g = new THREE.Group();
    const rand = mulberry32(length | 0);
    const light = [], dark = [];
    const m = new THREE.Matrix4();
    const plank = new THREE.BoxGeometry(width, 0.08, 0.26);
    for (let z = 0; z > -length; z -= 0.3) {
      m.makeRotationY((rand() - 0.5) * 0.03).setPosition((rand() - 0.5) * 0.06, deck, z);
      (rand() < 0.3 ? dark : light).push(plank.clone().applyMatrix4(m));
    }
    const post = new THREE.CylinderGeometry(0.12, 0.14, deck + 8, 8);
    for (let z = -0.5; z > -length; z -= 2.6) {
      for (const x of [-width / 2 - 0.05, width / 2 + 0.05]) {
        dark.push(post.clone().translate(x, deck - (deck + 8) / 2 + 0.6, z));
      }
    }
    g.add(new THREE.Mesh(mergeGeometries(light), this.wood), new THREE.Mesh(mergeGeometries(dark), this.darkWood));
    for (const x of [-width / 2 - 0.05, width / 2 + 0.05]) {
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, length, 6), this.rope);
      rope.rotation.x = Math.PI / 2;
      rope.position.set(x, deck + 0.55, -length / 2);
      g.add(rope);
    }
    return g;
  }

  lighthouse() {
    const g = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.65, 12, 24, 1, true), this.stripes);
    tower.position.y = 6;
    g.add(tower);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.5, 1.2, 24), this.white);
    base.position.y = 0.3;
    g.add(base);
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.2, 24), this.darkWood);
    gallery.position.y = 12.1;
    g.add(gallery);
    const rail = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.04, 6, 32), this.white);
    rail.rotation.x = Math.PI / 2;
    rail.position.y = 12.7;
    g.add(rail);
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.3, 16), this.lamp);
    lantern.position.y = 12.85;
    g.add(lantern);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.05, 1.1, 16), this.red);
    roof.position.y = 14.05;
    g.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.4, 0.1), this.red);
    door.position.set(0, 1.4, 1.6);
    g.add(door);
    for (let k = 0; k < 3; k++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 0.1), new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.3 }));
      const y = 4 + k * 3;
      const r = 1.65 - (y / 12) * 0.65;
      win.position.set(0, y, r);
      g.add(win);
    }
    return g;
  }

  hut(stilt = 0.6) {
    const g = new THREE.Group();
    const w = 3.2, d = 3.0, h = 2.0;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.15, d + 0.8), this.wood);
    floor.position.y = stilt;
    g.add(floor);
    const legGeo = new THREE.CylinderGeometry(0.09, 0.1, stilt + 4, 6);
    for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) {
      const leg = new THREE.Mesh(legGeo, this.darkWood);
      leg.position.set(x, stilt - (stilt + 4) / 2, z);
      g.add(leg);
    }
    // bamboo walls with a doorway on the front (+z), merged into one mesh
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.06, h, 6);
    const poles = [];
    const wall = (x0, z0, x1, z1, gapCenter = null) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.floor(len / 0.13);
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        if (gapCenter !== null && Math.abs(t - gapCenter) < 0.16) continue;
        poles.push(poleGeo.clone().translate(x0 + (x1 - x0) * t, stilt + h / 2, z0 + (z1 - z0) * t));
      }
    };
    wall(-w / 2, -d / 2, w / 2, -d / 2);
    wall(-w / 2, d / 2, w / 2, d / 2, 0.5);
    wall(-w / 2, -d / 2, -w / 2, d / 2);
    wall(w / 2, -d / 2, w / 2, d / 2);
    g.add(new THREE.Mesh(mergeGeometries(poles), this.bamboo));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, d) * 0.72, 1.9, 4, 1, true), this.thatch);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = stilt + h + 0.85;
    g.add(roof);
    const ridge = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), this.thatch);
    ridge.position.y = stilt + h + 1.8;
    g.add(ridge);
    return g;
  }

  rowboat() {
    const g = new THREE.Group();
    const hullGeo = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    hullGeo.scale(1.9, 0.55, 0.7);
    const hull = new THREE.Mesh(hullGeo, this.hullBlue);
    const inner = new THREE.Mesh(hullGeo.clone().scale(0.93, 0.9, 0.88), this.hullInner);
    inner.position.y = 0.04;
    hull.position.y = 0.5;
    inner.position.y = 0.53;
    g.add(hull, inner);
    for (const x of [-0.6, 0.5]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 1.25), this.wood);
      seat.position.set(x, 0.38, 0);
      g.add(seat);
    }
    for (const s of [-1, 1]) {
      const oar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6), this.wood);
      oar.rotation.z = Math.PI / 2 - 0.1;
      oar.rotation.y = s * 0.25;
      oar.position.set(0, 0.5, s * 0.35);
      g.add(oar);
    }
    g.rotation.z = 0.12;
    return g;
  }

  torch() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 2.2, 12), this.torchPole);
    pole.position.y = 1.1;
    g.add(pole);
    // two rope lashings under the head
    for (const y of [1.93, 2.02]) {
      const lash = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.017, 6, 16), this.rope);
      lash.rotation.x = Math.PI / 2;
      lash.position.y = y;
      g.add(lash);
    }
    // a flared woven head, with charred fuel showing at the top
    const profile = [[0.06, 0], [0.085, 0.05], [0.125, 0.17], [0.165, 0.32], [0.182, 0.4], [0.17, 0.425], [0.15, 0.415]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const head = new THREE.Mesh(new THREE.LatheGeometry(profile, 20), this.torchHead);
    head.position.y = 2.08;
    g.add(head);
    const fuel = new THREE.Mesh(new THREE.CircleGeometry(0.155, 20).rotateX(-Math.PI / 2), this.torchFuel);
    fuel.position.y = 2.08 + 0.39;
    g.add(fuel);
    const seed = Math.random() * 6;
    const flame = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.84).translate(0, 0.4, 0),
      new THREE.ShaderMaterial({
        uniforms: { map: { value: this.flameTex }, time: this.flameTime, seed: { value: seed } },
        vertexShader: FLAME_VERT,
        fragmentShader: FLAME_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    flame.position.y = 2.44;
    flame.userData.noShadow = true;
    flame.frustumCulled = false;
    g.add(flame);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.set(1.5, 1.5, 1);
    glow.position.y = 2.75;
    g.add(glow);
    this.flames.push({ glow, phase: seed });
    return g;
  }

  // ---------- level layouts ----------
  build(level, heightFn) {
    this.clear();
    this.h = heightFn;
    const rand = mulberry32(level.seed * 17 + 1);
    const ground = (x, z) => heightFn(x, z);
    const place = (obj, x, z, ry = 0, sink = 0) => {
      obj.position.set(x, ground(x, z) - sink, z);
      obj.rotation.y = ry;
      return this.add(obj);
    };
    const pierAt = (x, len) => {
      const sz = this.shoreZ(x);
      if (sz === null) return;
      const deck = level.tide.high + 0.9;
      const p = this.pier(len, 2.2, deck);
      p.position.set(x, 0, sz + 4);
      this.add(p);
      return { x, z: sz + 4 - len };
    };
    const hutAt = (x, z, ry) => place(this.hut(0.5), x, z, ry, 0.1);
    const torchRow = (x0, z0, x1, z1, n) => {
      for (let k = 0; k < n; k++) {
        const t = n === 1 ? 0 : k / (n - 1);
        const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
        if (ground(x, z) > level.tide.high + 0.1) place(this.torch(), x, z, 0, 0.3);
      }
    };

    switch (level.id) {
      case 0:
      case 1: {
        pierAt(30, 20);
        const lx = -54, lz = -26;
        place(this.lighthouse(), lx, lz, 0.3, 0.2);
        place(this.rowboat(), -27, (this.shoreZ(-27) ?? -10) + 4, 0.8, 0.1);
        break;
      }
      case 2: {
        // over-water bungalows on stilts with a boardwalk out from the beach
        const bx = 40;
        const sz = this.shoreZ(bx) ?? -5;
        const deck = level.tide.high + 0.9;
        const walk = this.pier(16, 1.6, deck);
        walk.position.set(bx, 0, sz + 3);
        this.add(walk);
        for (let k = 0; k < 3; k++) {
          const hut = this.hut(deck);
          hut.position.set(bx - 5 + k * 5, 0, sz - 15 - (k % 2) * 3);
          hut.rotation.y = Math.PI;
          this.add(hut);
          const link = this.pier(4, 1.2, deck);
          link.position.set(bx - 5 + k * 5, 0, sz - 11);
          link.rotation.y = 0;
          this.add(link);
        }
        hutAt(-32, 6, 0.6);
        break;
      }
      case 3: {
        hutAt(-24, 22, 0.9);
        place(this.rowboat(), 24, (this.shoreZ(24) ?? 0) + 3, -0.6, 0.1);
        torchRow(-22, 12, -16, 16, 3);
        break;
      }
      case 4: {
        const end = pierAt(-32, 22);
        place(this.lighthouse(), 46, 4, -0.4, 0.2);
        if (end) {
          const boat = this.rowboat();
          boat.position.set(end.x + 3, level.tide.low + 0.05, end.z + 3);
          boat.rotation.y = 1.2;
          boat.rotation.z = 0;
          this.add(boat);
          boat.userData.float = true;
          this.floaters = [boat];
        }
        break;
      }
      case 5: {
        pierAt(28, 18);
        hutAt(-30, 14, 0.4);
        torchRow(-23, -1, -23, 12, 4);
        torchRow(23, -1, 23, 12, 4);
        break;
      }
      default:
        break;
    }

    // beach dressing: shells, coconuts, driftwood and flowers beyond the play
    // area — instanced per (geometry, material) to keep draw calls low
    const buckets = new Map();
    const collect = (type, x, y, z, ry, sc) => {
      const d = makeDecor(type, rand);
      const mesh = d.children[0];
      const key = mesh.geometry.uuid + mesh.material.uuid;
      if (!buckets.has(key)) buckets.set(key, { geo: mesh.geometry, mat: mesh.material, list: [] });
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
      buckets.get(key).list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sc, sc, sc)));
    };
    const kinds = ['scallop', 'conch', 'starfish', 'pebble', 'coconut', 'driftwood', 'cowrie', 'scallop', 'pebble', 'seaweed', 'mussel'];
    let placed = 0;
    for (let t = 0; t < 2500 && placed < 150; t++) {
      const x = (rand() - 0.5) * 120, z = -20 + rand() * 50;
      if (Math.max(Math.abs(x), Math.abs(z)) < HALF + 1.5) continue;
      const hh = ground(x, z);
      if (hh < level.tide.low + 0.05 || hh > 2.4) continue;
      collect(kinds[Math.floor(rand() * kinds.length)], x, hh - 0.01, z, rand() * 6.28, 0.8 + rand() * 0.6);
      placed++;
    }
    let fl = 0;
    for (let t = 0; t < 2500 && fl < 110; t++) {
      const x = (rand() - 0.5) * 120, z = -5 + rand() * 60;
      if (Math.max(Math.abs(x), Math.abs(z)) < HALF + 3) continue;
      const hh = ground(x, z);
      if (hh < 2.2 || hh > 6) continue;
      collect('flower', x, hh + 0.02, z, rand() * 6.28, 1.6 + rand() * 1.2);
      fl++;
    }
    for (const b of buckets.values()) {
      const im = new THREE.InstancedMesh(b.geo, b.mat, b.list.length);
      b.list.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.computeBoundingSphere();
      this.add(im);
    }
  }

  update(dt, time, tide) {
    landmarkTime.value = time;
    this.flameTime.value = time;
    for (const f of this.flames) f.glow.material.opacity = 0.4 + 0.12 * Math.sin(time * 9 + f.phase) * Math.sin(time * 4.1 + f.phase);
    for (const b of this.floaters || []) {
      b.position.y = tide + 0.05 + Math.sin(time * 1.2) * 0.06;
      b.rotation.x = Math.sin(time * 0.9) * 0.05;
    }
  }
}
