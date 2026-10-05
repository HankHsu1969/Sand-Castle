import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { HALF } from '../core/config.js';
import { mulberry32, makeSimplex } from '../core/noise.js';
import { injectFog } from './fog.js';
import { sandUniforms } from './Terrain.js';

export const marineTime = { value: 0 };

// Stock material + fog + the same light absorption the seabed gets, so sea
// creatures read as being *in* the water rather than floating on top of it.
function underwater(params, key, vertexHook = '') {
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = (shader) => {
    injectFog(shader);
    shader.uniforms.uTime = marineTime;
    shader.uniforms.uSeaLevel = sandUniforms.uSeaLevel;
    shader.uniforms.uAbsorb = sandUniforms.uAbsorb;
    shader.uniforms.uScatter = sandUniforms.uScatter;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vUwPos;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertexHook}`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        #ifdef USE_INSTANCING
          vUwPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vUwPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSeaLevel;\nuniform vec3 uAbsorb;\nuniform vec3 uScatter;\nvarying vec3 vUwPos;')
      .replace(
        '#include <opaque_fragment>',
        `{
          float d = max(0.0, uSeaLevel - vUwPos.y);
          vec3 tr = exp(-uAbsorb * d * 1.3);
          outgoingLight = outgoingLight * tr + uScatter * (1.0 - tr);
        }
        #include <opaque_fragment>`
      );
  };
  m.customProgramCacheKey = () => 'uw-' + key;
  return m;
}

// ---------------- geometries ----------------
function fishGeometry(pattern) {
  const body = new THREE.SphereGeometry(0.5, 16, 10);
  body.scale(1, pattern === 'sardine' ? 0.32 : 0.62, 0.22);
  const tailShape = new THREE.Shape();
  tailShape.moveTo(0, 0); tailShape.lineTo(-0.32, 0.24); tailShape.lineTo(-0.26, 0); tailShape.lineTo(-0.32, -0.24); tailShape.lineTo(0, 0);
  const tail = new THREE.ShapeGeometry(tailShape);
  tail.translate(-0.42, 0, 0);
  const finShape = new THREE.Shape();
  finShape.moveTo(-0.2, 0); finShape.quadraticCurveTo(0.0, 0.32, 0.18, 0.0);
  const fin = new THREE.ShapeGeometry(finShape);
  fin.translate(0, pattern === 'sardine' ? 0.12 : 0.26, 0);
  const parts = [body, tail, fin].map((g) => {
    g.deleteAttribute('uv');
    return g.index ? g.toNonIndexed() : g;
  });
  const geo = mergeGeometries(parts);
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  const set = (i, c) => { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; };
  const C = (h) => new THREE.Color(h);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    let c;
    switch (pattern) {
      case 'clown': {
        const band = Math.abs(x - 0.18) < 0.06 || Math.abs(x + 0.15) < 0.05 || x < -0.4;
        c = band ? C(0xffffff) : C(0xff7b1c);
        if (x < -0.42 || Math.abs(x - 0.18) < 0.012) c = C(0x222222);
        break;
      }
      case 'tang':
        c = x < -0.38 ? C(0xffd02e) : y > 0.1 && x > -0.2 && x < 0.25 ? C(0x10184a) : C(0x2f6ff0);
        break;
      case 'yellow':
        c = C(0xffd93b).multiplyScalar(0.85 + 0.15 * Math.sin(x * 20));
        break;
      case 'parrot':
        c = new THREE.Color().setHSL(0.45 + x * 0.25, 0.75, 0.55);
        break;
      default: // silver sardine
        c = C(y > 0.02 ? 0x5d7d97 : 0xdfe8ef);
    }
    if (x > 0.36 && Math.abs(y - 0.06) < 0.05) c = C(0x111111); // eye
    set(i, c);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function turtle() {
  const g = new THREE.Group();
  const shellGeo = mergeVertices(new THREE.SphereGeometry(0.5, 24, 14).deleteAttribute('uv').deleteAttribute('normal'));
  const p = shellGeo.attributes.position;
  const col = new Float32Array(p.count * 3);
  const n = makeSimplex(4);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    y = y > 0 ? y * 0.42 : y * 0.16;
    p.setXYZ(i, x * 1.1, y, z * 0.9);
    // scute pattern: cells with darker seams
    const cell = Math.abs(Math.sin(x * 9) * Math.sin(z * 9));
    const seam = cell < 0.12 ? 0.55 : 1;
    const base = y > 0 ? new THREE.Color(0x6b5a2e).lerp(new THREE.Color(0xa8873e), 0.5 + 0.5 * n(x * 4, z * 4)) : new THREE.Color(0xd9c58a);
    base.multiplyScalar(seam);
    col[i * 3] = base.r; col[i * 3 + 1] = base.g; col[i * 3 + 2] = base.b;
  }
  shellGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  shellGeo.computeVertexNormals();
  const skin = underwater({ color: 0x7f8f5a, roughness: 0.7 }, 'turtle-skin');
  const shell = new THREE.Mesh(shellGeo, underwater({ vertexColors: true, roughness: 0.45 }, 'turtle-shell'));
  g.add(shell);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), skin);
  head.scale.set(1.3, 0.85, 0.95);
  head.position.set(0.66, 0.02, 0);
  g.add(head);
  const flip = (x, z, s, front) => {
    const pivot = new THREE.Group();
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), skin);
    f.scale.set(front ? 0.28 : 0.18, 0.04, front ? 0.62 : 0.3);
    f.position.set(front ? -0.06 : -0.02, 0, s * (front ? 0.3 : 0.14));
    f.rotation.y = s * (front ? -0.5 : -0.3);
    pivot.add(f);
    pivot.position.set(x, -0.02, z * s);
    pivot.userData = { s, front };
    g.add(pivot);
    return pivot;
  };
  g.userData.flippers = [flip(0.32, 0.36, 1, true), flip(0.32, 0.36, -1, true), flip(-0.4, 0.3, 1, false), flip(-0.4, 0.3, -1, false)];
  return g;
}

function rayGeometry() {
  const g = new THREE.PlaneGeometry(1.8, 1.2, 24, 12);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const keep = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    // diamond outline, body bulge in the middle
    const w = 0.9 * (1 - Math.abs(z) / 0.6);
    const inside = Math.abs(x) <= w + 0.02 && z > -0.6 && z < 0.6;
    keep.push(inside);
    p.setY(i, 0.08 * Math.exp(-(x * x) / 0.05) * (1 - Math.abs(z) / 0.6));
    const spot = Math.sin(x * 25) * Math.sin(z * 23) > 0.85;
    const c = new THREE.Color(spot ? 0xf2f2f2 : 0x2b3a4a);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // drop triangles outside the diamond
  const idx = g.index.array;
  const out = [];
  for (let t = 0; t < idx.length; t += 3) if (keep[idx[t]] && keep[idx[t + 1]] && keep[idx[t + 2]]) out.push(idx[t], idx[t + 1], idx[t + 2]);
  g.setIndex(out);
  g.computeVertexNormals();
  return g;
}

function dolphin() {
  const pts = [[0.0, -1.1], [0.06, -1.0], [0.16, -0.7], [0.24, -0.3], [0.26, 0.05], [0.22, 0.4], [0.14, 0.75], [0.07, 0.95], [0.05, 1.1], [0.02, 1.25], [0, 1.28]];
  const geo = new THREE.LatheGeometry(pts.map((q) => new THREE.Vector2(q[0], q[1])), 18);
  geo.rotateZ(-Math.PI / 2); // nose toward +x
  const parts = [geo];
  const finShape = new THREE.Shape();
  finShape.moveTo(-0.25, 0); finShape.quadraticCurveTo(-0.05, 0.1, 0.05, 0.42); finShape.quadraticCurveTo(0.1, 0.15, 0.25, 0);
  const dorsal = new THREE.ShapeGeometry(finShape);
  dorsal.translate(-0.1, 0.18, 0);
  parts.push(dorsal);
  const flukeShape = new THREE.Shape();
  flukeShape.moveTo(0.05, 0); flukeShape.quadraticCurveTo(-0.12, 0.2, -0.32, 0.4); flukeShape.quadraticCurveTo(-0.2, 0.12, -0.24, 0);
  flukeShape.quadraticCurveTo(-0.2, -0.12, -0.32, -0.4); flukeShape.quadraticCurveTo(-0.12, -0.2, 0.05, 0);
  const fluke = new THREE.ShapeGeometry(flukeShape);
  fluke.rotateX(Math.PI / 2); // lay the flukes flat
  fluke.translate(-1.0, 0, 0);
  parts.push(fluke);
  const merged = mergeGeometries(parts.map((q) => { q.deleteAttribute('uv'); return q.index ? q.toNonIndexed() : q; }));
  merged.computeVertexNormals();
  const n = merged.attributes.normal, c = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const belly = THREE.MathUtils.smoothstep(-n.getY(i), 0.0, 0.6);
    const col = new THREE.Color(0x5f7180).lerp(new THREE.Color(0xd9dee2), belly);
    c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
  }
  merged.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return new THREE.Mesh(merged, underwater({ vertexColors: true, roughness: 0.35, side: THREE.DoubleSide }, 'dolphin'));
}

function kelpGeometry(rand) {
  const parts = [];
  for (let k = 0; k < 4; k++) {
    const h = 0.9 + rand() * 1.4, w = 0.09 + rand() * 0.05;
    const ox = (rand() - 0.5) * 0.4, oz = (rand() - 0.5) * 0.4, rot = rand() * Math.PI;
    const g = new THREE.PlaneGeometry(w, h, 1, 10);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) / h + 0.5;
      p.setX(i, p.getX(i) * (1 - t * 0.5) + Math.sin(t * 5 + k) * 0.06);
    }
    g.translate(0, h / 2, 0);
    g.rotateY(rot);
    g.translate(ox, 0, oz);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

function urchinGeometry() {
  const parts = [new THREE.SphereGeometry(0.12, 12, 8).deleteAttribute('uv')];
  const dirs = new THREE.IcosahedronGeometry(1, 1).attributes.position;
  for (let i = 0; i < dirs.count; i += 2) {
    const d = new THREE.Vector3().fromBufferAttribute(dirs, i).normalize();
    if (d.y < -0.3) continue;
    const spike = new THREE.ConeGeometry(0.012, 0.22, 4).deleteAttribute('uv');
    spike.translate(0, 0.11 + 0.1, 0);
    spike.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
    parts.push(spike.toNonIndexed());
  }
  parts[0] = parts[0].toNonIndexed();
  const g = mergeGeometries(parts);
  g.translate(0, 0.06, 0);
  return g;
}

function starfishGeometry() {
  const shape = new THREE.Shape();
  for (let k = 0; k <= 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const r = k % 2 === 0 ? 0.24 : 0.09;
    if (k === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r); else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3 });
  g.rotateX(-Math.PI / 2);
  g.deleteAttribute('uv');
  return g;
}

function jellyfish() {
  const g = new THREE.Group();
  const bell = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color: 0xffb6e1, emissive: 0x6a2a55, transparent: true, opacity: 0.55, roughness: 0.2, side: THREE.DoubleSide, depthWrite: false })
  );
  g.add(bell);
  const tm = new THREE.MeshBasicMaterial({ color: 0xffd6ef, transparent: true, opacity: 0.4, depthWrite: false });
  for (let k = 0; k < 7; k++) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.003, 0.7, 3), tm);
    const a = (k / 7) * Math.PI * 2;
    t.position.set(Math.cos(a) * 0.16, -0.3, Math.sin(a) * 0.16);
    g.add(t);
  }
  g.userData.bell = bell;
  return g;
}

const SPECIES = [
  { pattern: 'sardine', count: 34, scale: 0.22, spread: 1.3, speed: 1.1 },
  { pattern: 'yellow', count: 14, scale: 0.3, spread: 1.0, speed: 0.7 },
  { pattern: 'tang', count: 12, scale: 0.32, spread: 1.0, speed: 0.75 },
  { pattern: 'clown', count: 8, scale: 0.26, spread: 0.7, speed: 0.5 },
  { pattern: 'parrot', count: 7, scale: 0.42, spread: 1.1, speed: 0.6 },
];

export class Marine {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    const tailWag = `
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3].x * 3.1 + instanceMatrix[3].z * 1.7;
      #else
        float ph = 0.0;
      #endif
      float tailT = clamp(-position.x / 0.75, 0.0, 1.0);
      transformed.z += sin(uTime * 11.0 + ph) * 0.13 * tailT * tailT;`;
    this.fishMats = {};
    this.fishGeos = {};
    for (const sp of SPECIES) {
      this.fishGeos[sp.pattern] = fishGeometry(sp.pattern);
      this.fishMats[sp.pattern] = underwater({ vertexColors: true, roughness: sp.pattern === 'sardine' ? 0.25 : 0.45, metalness: sp.pattern === 'sardine' ? 0.4 : 0, side: THREE.DoubleSide }, 'fish', tailWag);
    }
    this.rayMat = underwater({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide }, 'ray', `
      float wing = abs(position.x);
      transformed.y += sin(uTime * 2.4 - wing * 2.0) * 0.32 * wing * wing;`);
    this.rayGeo = rayGeometry();
    this.kelpMat = underwater({ color: 0x5b7a2b, roughness: 0.6, side: THREE.DoubleSide }, 'kelp', `
      #ifdef USE_INSTANCING
        float kp = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.9;
      #else
        float kp = 0.0;
      #endif
      float bend = position.y * position.y;
      transformed.x += sin(uTime * 1.3 + kp + position.y * 1.5) * 0.12 * bend;
      transformed.z += cos(uTime * 1.1 + kp) * 0.08 * bend;`);
    const r = mulberry32(3);
    this.kelpGeo = kelpGeometry(r);
    this.urchinGeo = urchinGeometry();
    this.urchinMat = underwater({ color: 0x3a2350, roughness: 0.5 }, 'urchin');
    this.starGeo = starfishGeometry();
    this.starMat = underwater({ roughness: 0.7 }, 'star');
    this.items = [];
    this.schools = [];
    this.swimmers = [];
    this.dolphins = [];
    this.jellies = [];
  }

  clear() {
    for (const o of this.items) { this.group.remove(o); if (o.isInstancedMesh) o.dispose(); }
    this.items = [];
    this.schools = [];
    this.swimmers = [];
    this.dolphins = [];
    this.jellies = [];
  }

  add(o) { this.group.add(o); this.items.push(o); return o; }

  // ground height anywhere: live terrain inside the play area, generator outside
  ground(x, z) {
    if (this.terrain && Math.abs(x) < HALF - 0.2 && Math.abs(z) < HALF - 0.2) return this.terrain.heightAt(x, z);
    return this.heightFn(x, z);
  }

  build(level, heightFn, terrain, tide) {
    this.clear();
    this.heightFn = heightFn;
    this.terrain = terrain;
    const rand = mulberry32(level.seed * 31 + 7);
    const deep = (x, z, d) => heightFn(x, z) < tide - d;
    const pathOk = (cx, cz, rx, rz, d) => {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        if (!deep(cx + Math.cos(a) * rx, cz + Math.sin(a) * rz, d)) return false;
      }
      return deep(cx, cz, d);
    };

    // fish schools swimming loops in water deep enough for them
    const pick = (minDepth, rx, rz, zMin, zMax, xSpan) => {
      for (let t = 0; t < 300; t++) {
        const cx = (rand() - 0.5) * xSpan, cz = zMin + rand() * (zMax - zMin);
        if (pathOk(cx, cz, rx, rz, minDepth)) return [cx, cz];
      }
      return null;
    };
    const schools = level.id === 2 ? 7 : 5;
    for (let s = 0; s < schools; s++) {
      const sp = SPECIES[s % SPECIES.length];
      const rx = 3 + rand() * 5, rz = 2 + rand() * 3;
      const c = pick(0.7, rx, rz, -45, -8, 50);
      if (!c) continue;
      const mesh = new THREE.InstancedMesh(this.fishGeos[sp.pattern], this.fishMats[sp.pattern], sp.count);
      mesh.frustumCulled = false;
      this.add(mesh);
      const offsets = [];
      for (let i = 0; i < sp.count; i++) {
        offsets.push(new THREE.Vector3((rand() - 0.5) * 2, (rand() - 0.5) * 0.7, (rand() - 0.5) * 2).multiplyScalar(sp.spread));
      }
      this.schools.push({ mesh, sp, cx: c[0], cz: c[1], rx, rz, phase: rand() * 6.28, dir: rand() < 0.5 ? 1 : -1, offsets, depthFrac: 0.35 + rand() * 0.3 });
    }

    // turtles and an eagle ray gliding in deeper water
    for (let k = 0; k < 2; k++) {
      const c = pick(1.4, 7, 5, -55, -12, 50);
      if (!c) continue;
      const tt = turtle();
      tt.scale.setScalar(0.9 + rand() * 0.4);
      this.add(tt);
      this.swimmers.push({ obj: tt, kind: 'turtle', cx: c[0], cz: c[1], rx: 7 + rand() * 3, rz: 5, phase: rand() * 6.28, speed: 0.045 + rand() * 0.02, depthFrac: 0.45 });
    }
    if (level.id !== 1) {
      const c = pick(1.6, 8, 6, -60, -14, 50);
      if (c) {
        const ray = new THREE.Mesh(this.rayGeo, this.rayMat);
        ray.scale.setScalar(1.3);
        this.add(ray);
        this.swimmers.push({ obj: ray, kind: 'ray', cx: c[0], cz: c[1], rx: 8, rz: 6, phase: rand() * 6.28, speed: 0.05, depthFrac: 0.7 });
      }
    }

    // jellyfish drifting near the surface in the clearer lagoons
    if (level.id === 2 || level.id === 3) {
      for (let k = 0; k < 5; k++) {
        const c = pick(1.2, 1, 1, -40, -10, 40);
        if (!c) continue;
        const j = jellyfish();
        this.add(j);
        this.jellies.push({ obj: j, x: c[0], z: c[1], phase: rand() * 6.28 });
      }
    }

    // dolphins playing out beyond the shallows
    for (let k = 0; k < 3; k++) {
      const d = dolphin();
      d.visible = false;
      this.add(d);
      this.dolphins.push({ obj: d, x: -60 + rand() * 120, z: -95 - rand() * 60, dir: rand() < 0.5 ? 1 : -1, timer: 3 + rand() * 8, jump: -1 });
    }

    // seabed life: kelp, urchins and starfish where it's submerged
    const kelp = [], urch = [], stars = [], starCols = [];
    const palette = [0xff7a3d, 0xe8425b, 0xb05cff, 0xffb347].map((c) => new THREE.Color(c));
    for (let t = 0; t < 3000 && (kelp.length < 90 || urch.length < 40 || stars.length < 40); t++) {
      const x = (rand() - 0.5) * 80, z = -60 + rand() * 50;
      const h = heightFn(x, z);
      const depth = tide - h;
      if (depth < 0.45 || depth > 7) continue;
      if (Math.abs(x) < HALF && Math.abs(z) < HALF) continue; // keep the sculptable area clear
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, h - 0.02, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand() * 6.28, 0)), new THREE.Vector3().setScalar(0.7 + rand() * 0.8));
      const roll = rand();
      if (roll < 0.55 && kelp.length < 90 && depth > 1.0) kelp.push(m);
      else if (roll < 0.78 && urch.length < 40) urch.push(m);
      else if (stars.length < 40) { stars.push(m); starCols.push(palette[Math.floor(rand() * palette.length)]); }
    }
    const inst = (geo, mat, list, cols) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      if (cols) cols.forEach((c, i) => im.setColorAt(i, c));
      im.computeBoundingSphere();
      this.add(im);
    };
    inst(this.kelpGeo, this.kelpMat, kelp);
    inst(this.urchinGeo, this.urchinMat, urch);
    inst(this.starGeo, this.starMat, stars, starCols);
  }

  update(dt, time, tide, sparkles) {
    marineTime.value = time;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    for (const s of this.schools) {
      s.phase += dt * s.sp.speed * 0.12 * s.dir;
      const a = s.phase;
      const cx = s.cx + Math.cos(a) * s.rx, cz = s.cz + Math.sin(a) * s.rz;
      const heading = Math.atan2(Math.cos(a) * s.rz * s.dir, -Math.sin(a) * s.rx * s.dir);
      for (let i = 0; i < s.offsets.length; i++) {
        const o = s.offsets[i];
        const wob = Math.sin(time * 1.3 + i * 1.7) * 0.25;
        const x = cx + o.x + Math.cos(time * 0.7 + i) * 0.2;
        const z = cz + o.z + wob;
        const g = this.ground(x, z);
        const depth = tide - g;
        let y = g + depth * s.depthFrac + o.y * 0.4 + Math.sin(time * 0.9 + i) * 0.06;
        y = Math.min(y, tide - 0.12);
        const visible = depth > 0.3 && y > g + 0.08;
        e.set(0, -heading + Math.sin(time * 2 + i) * 0.15, Math.sin(time * 1.5 + i) * 0.08);
        q.setFromEuler(e);
        sc.setScalar(visible ? s.sp.scale * (0.85 + (i % 5) * 0.06) : 0.0001);
        m4.compose(v.set(x, y, z), q, sc);
        s.mesh.setMatrixAt(i, m4);
      }
      s.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const w of this.swimmers) {
      w.phase += dt * w.speed;
      const a = w.phase;
      const x = w.cx + Math.cos(a) * w.rx, z = w.cz + Math.sin(a) * w.rz;
      const g = this.ground(x, z);
      const depth = tide - g;
      const y = Math.min(g + depth * w.depthFrac, tide - 0.3) + Math.sin(time * 0.5) * 0.1;
      w.obj.position.set(x, y, z);
      // turtles face +x, the ray's nose points along +z
      w.obj.rotation.set(0, -Math.atan2(Math.cos(a) * w.rz, -Math.sin(a) * w.rx) + (w.kind === 'ray' ? Math.PI / 2 : 0), 0);
      if (w.kind === 'turtle') {
        const stroke = Math.sin(time * 1.6 + w.cx);
        for (const f of w.obj.userData.flippers) {
          f.rotation.x = f.userData.s * (f.userData.front ? stroke * 0.6 : stroke * 0.25);
          f.rotation.y = f.userData.front ? f.userData.s * stroke * 0.25 : 0;
        }
      }
    }
    for (const j of this.jellies) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 1.8 + j.phase);
      j.obj.position.set(j.x + Math.sin(time * 0.1 + j.phase) * 2, tide - 0.45 + pulse * 0.08, j.z + Math.cos(time * 0.08 + j.phase) * 2);
      j.obj.userData.bell.scale.set(1 - pulse * 0.12, 0.85 + pulse * 0.25, 1 - pulse * 0.12);
    }
    for (const d of this.dolphins) {
      d.x += d.dir * dt * 2.2;
      if (d.x > 90) d.dir = -1; else if (d.x < -90) d.dir = 1;
      if (d.jump < 0) {
        d.timer -= dt;
        d.obj.visible = false;
        if (d.timer <= 0) { d.jump = 0; d.timer = 6 + Math.random() * 12; }
      } else {
        d.jump += dt / 1.5;
        const t = d.jump;
        const y = tide - 0.6 + Math.sin(t * Math.PI) * 2.4;
        d.obj.visible = true;
        d.obj.position.set(d.x, y, d.z);
        d.obj.rotation.set(0, d.dir > 0 ? 0 : Math.PI, Math.cos(t * Math.PI) * 0.9 * 1);
        if (sparkles && (Math.abs(t - 0.08) < dt / 1.5 || Math.abs(t - 0.92) < dt / 1.5)) {
          for (let k = 0; k < 20; k++) {
            const a2 = Math.random() * 6.28;
            sparkles.emit(d.x, tide + 0.05, d.z, Math.cos(a2) * 1.5, 2 + Math.random() * 2.5, Math.sin(a2) * 1.5, { life: 1, size: 0.35, color: new THREE.Color(1.6, 1.7, 1.8), gravity: -8 });
          }
        }
        if (t >= 1) { d.jump = -1; d.obj.visible = false; }
      }
    }
  }
}
