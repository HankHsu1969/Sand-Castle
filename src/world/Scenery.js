import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { HALF } from '../core/config.js';
import { mulberry32, makeSimplex, fbm } from '../core/noise.js';
import { withFog } from './fog.js';
import PLANTS from './plants.json';

export const sceneryTime = { value: 0 };

// ---------- palm ----------
function buildPalmVariant(rand) {
  const height = 5.5 + rand() * 3.5;
  const lean = 1.2 + rand() * 2.2;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.4, 0),
    new THREE.Vector3(lean * 0.15, height * 0.3, 0),
    new THREE.Vector3(lean * 0.55, height * 0.68, 0),
    new THREE.Vector3(lean, height, 0),
  ]);
  const segs = 28, radial = 10;
  const pos = [], nrm = [], uv = [], idx = [];
  const frames = curve.computeFrenetFrames(segs, false);
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    const p = curve.getPointAt(t);
    const r = (0.24 - 0.09 * t) * (1 + 0.06 * Math.pow(Math.abs(Math.sin(t * segs * Math.PI * 0.5)), 3)) + (t < 0.06 ? 0.12 * (1 - t / 0.06) : 0);
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const nx = Math.cos(a), ny = Math.sin(a);
      const N = frames.normals[s], B = frames.binormals[s];
      const dir = new THREE.Vector3().addScaledVector(N, nx).addScaledVector(B, ny);
      pos.push(p.x + dir.x * r, p.y + dir.y * r, p.z + dir.z * r);
      nrm.push(dir.x, dir.y, dir.z);
      uv.push((k / radial) * 2, (t * height) / 3);
    }
  }
  for (let s = 0; s < segs; s++) {
    for (let k = 0; k < radial; k++) {
      const a = s * (radial + 1) + k, b = a + radial + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  let trunk = new THREE.BufferGeometry();
  trunk.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  trunk.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  trunk.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  trunk.setIndex(idx);
  const top = curve.getPointAt(1);
  const nuts = [];
  for (let k = 0; k < 5; k++) {
    const nut = new THREE.SphereGeometry(0.15, 12, 10);
    nut.scale(1, 1.12, 1);
    const a = k * 1.3 + rand();
    nut.translate(top.x + Math.cos(a) * 0.22, top.y - 0.25 - rand() * 0.12, top.z + Math.sin(a) * 0.22);
    nuts.push(nut);
  }

  // fronds
  const fronds = [];
  const count = 15 + Math.floor(rand() * 4);
  for (let f = 0; f < count; f++) {
    const young = f >= count - 3;
    const az = (f / count) * Math.PI * 2 + rand() * 0.4;
    const len = young ? 1.8 + rand() * 0.6 : 3.0 + rand() * 1.1;
    const rise = young ? 1.4 : 0.55 + rand() * 0.5;
    const droop = young ? 0.3 : 1.5 + rand() * 0.8;
    const width = young ? 0.45 : 0.85;
    const d = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const side = new THREE.Vector3(-d.z, 0, d.x);
    const steps = 12;
    const fp = [], fu = [], fi = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const c = new THREE.Vector3(
        top.x + d.x * len * t,
        top.y + rise * t * len * 0.5 - droop * t * t * len * 0.5,
        top.z + d.z * len * t
      );
      const w = width * (t < 0.12 ? 0.3 + (t / 0.12) * 0.7 : 1);
      const fold = 0.28 * w;
      fp.push(c.x - side.x * w, c.y - fold, c.z - side.z * w);
      fp.push(c.x, c.y, c.z);
      fp.push(c.x + side.x * w, c.y - fold, c.z + side.z * w);
      fu.push(0, t, 0.5, t, 1, t);
    }
    for (let s = 0; s < steps; s++) {
      const a = s * 3;
      fi.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2));
    g.setIndex(fi);
    g.computeVertexNormals();
    fronds.push(g);
  }
  return { trunk, nuts: mergeGeometries(nuts), fronds: mergeGeometries(fronds), height };
}

function smoothIco(detail) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  return mergeVertices(g);
}

function noisyRock(seed, detail = 4) {
  const geo = smoothIco(detail);
  const n = makeSimplex(seed);
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = 1 + 0.32 * fbm(n, v.x * 1.3, v.y * 1.3 + v.z * 0.7, 4) + 0.12 * n(v.x * 4, v.z * 4);
    v.multiplyScalar(d);
    v.y *= 0.62;
    if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.3;
    p.setXYZ(i, v.x, v.y, v.z);
    const shade = 0.55 + 0.45 * (d - 0.7);
    const wetBand = THREE.MathUtils.smoothstep(v.y, -0.25, 0.15);
    col[i * 3] = (0.5 * shade) * (0.7 + 0.3 * wetBand);
    col[i * 3 + 1] = (0.47 * shade) * (0.72 + 0.28 * wetBand);
    col[i * 3 + 2] = (0.43 * shade) * (0.75 + 0.25 * wetBand);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function coralGeometry(rand) {
  const parts = [];
  const branch = (x, y, z, dir, len, r, depth) => {
    const g = new THREE.CylinderGeometry(r * 0.7, r, len, 6);
    g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.applyQuaternion(q);
    g.translate(x, y, z);
    parts.push(g.toNonIndexed());
    const tip = new THREE.Vector3(x, y, z).addScaledVector(dir, len);
    const cap = new THREE.SphereGeometry(r * 0.75, 6, 4);
    cap.translate(tip.x, tip.y, tip.z);
    parts.push(cap.toNonIndexed());
    if (depth > 0) {
      for (let k = 0; k < 2; k++) {
        const nd = dir.clone().add(new THREE.Vector3(rand() - 0.5, 0.3, rand() - 0.5).multiplyScalar(0.9)).normalize();
        branch(tip.x, tip.y, tip.z, nd, len * 0.75, r * 0.72, depth - 1);
      }
    }
  };
  for (let k = 0; k < 3; k++) {
    branch((rand() - 0.5) * 0.4, 0, (rand() - 0.5) * 0.4,
      new THREE.Vector3(rand() - 0.5, 1.4, rand() - 0.5).normalize(), 0.45, 0.09, 2);
  }
  parts.forEach((g) => g.deleteAttribute('uv'));
  return mergeGeometries(parts);
}

export class Scenery {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    const rand = mulberry32(42);
    this.palms = [0, 1, 2, 3].map(() => buildPalmVariant(rand));
    this.rockGeos = [noisyRock(5), noisyRock(9), noisyRock(13, 3)];
    this.coralGeos = [coralGeometry(mulberry32(1)), coralGeometry(mulberry32(2))];

    const sway = (strength) => (shader) => {
      shader.uniforms.uTime = sceneryTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec2 ip = instanceMatrix[3].xz;
          #else
            vec2 ip = vec2(0.0);
          #endif
          float ph = ip.x * 0.37 + ip.y * 0.23;
          float flex = ${strength === 'frond' ? 'uv.y * uv.y' : strength === 'grass' ? '(1.0 - uv.y) * 0.0 + uv.y' : 'clamp(position.y / 8.0, 0.0, 1.0) * clamp(position.y / 8.0, 0.0, 1.0)'};
          float topSway = sin(uTime * 0.8 + ph) * 0.05;
          ${strength === 'frond'
            ? `transformed.y += sin(uTime * 1.7 + ph + position.x * 0.6 + position.z * 0.4) * 0.13 * flex;
               transformed.x += sin(uTime * 1.2 + ph) * 0.09 * flex + topSway;
               transformed.z += cos(uTime * 1.4 + ph * 1.3) * 0.07 * flex;`
            : strength === 'grass'
              ? `transformed.x += sin(uTime * 2.1 + ph + position.x) * 0.12 * flex;
                 transformed.z += cos(uTime * 1.7 + ph) * 0.06 * flex;`
              : `transformed.x += topSway * flex;`}
          `
        );
    };

    const tl = new THREE.TextureLoader();
    const tex = (url, srgb = true, repeat = false) => {
      const t = tl.load(url);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      return t;
    };
    this.trunkMat = withFog(new THREE.MeshStandardMaterial({
      map: tex('assets/img/palm_bark.jpg', true, true),
      normalMap: tex('assets/img/palm_bark_n.jpg', false, true),
      normalScale: new THREE.Vector2(1.2, 1.2),
      roughness: 0.95,
    }), 'palm-trunk', sway('trunk'));
    this.nutMat = withFog(new THREE.MeshStandardMaterial({ color: 0x6b5a2a, roughness: 0.55 }), 'palm-trunk', sway('trunk'));
    this.frondMat = withFog(new THREE.MeshStandardMaterial({
      map: tex('assets/img/palm_frond.png'), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6,
    }), 'palm-frond', sway('frond'));
    this.rockMat = withFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }), 'rock');
    this.coralMat = withFog(new THREE.MeshStandardMaterial({ roughness: 0.7 }), 'coral');

    // beach plants: photographic sprites on three crossed cards, lit from above
    this.plants = PLANTS.map((pl) => {
      const cards = [];
      for (let k = 0; k < 3; k++) {
        const q = new THREE.PlaneGeometry(pl.aspect, 1, 1, 3);
        q.translate(0, 0.5, 0);
        q.rotateY((k * Math.PI) / 3);
        cards.push(q);
      }
      const geo = mergeGeometries(cards);
      const n = geo.attributes.normal;
      for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
      const mat = withFog(new THREE.MeshStandardMaterial({
        map: tex(`assets/plants/${pl.name}.png`), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75,
      }), 'grass', sway('grass'));
      return { ...pl, geo, mat };
    });

    this.boat = this.buildBoat();
    this.boat.visible = false;
    this.group.add(this.boat);
  }

  buildBoat() {
    const g = new THREE.Group();
    const hullShape = new THREE.Shape();
    hullShape.moveTo(-2.2, 0); hullShape.quadraticCurveTo(0, -0.9, 2.6, 0.2); hullShape.lineTo(-2.2, 0.2);
    const hull = new THREE.Mesh(
      new THREE.ExtrudeGeometry(hullShape, { depth: 1.1, bevelEnabled: false }),
      withFog(new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.6 }), 'boat-hull')
    );
    hull.position.z = -0.55;
    g.add(hull);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 5), withFog(new THREE.MeshStandardMaterial({ color: 0x8a6a4a }), 'boat-mast'));
    mast.position.set(0, 2.6, 0);
    g.add(mast);
    const sailShape = new THREE.Shape();
    sailShape.moveTo(0.1, 0.4); sailShape.lineTo(0.1, 4.8); sailShape.lineTo(2.2, 0.4);
    const sailMat = withFog(new THREE.MeshStandardMaterial({ color: 0xfff6ea, side: THREE.DoubleSide, roughness: 0.9 }), 'boat-sail');
    const sail = new THREE.Mesh(new THREE.ShapeGeometry(sailShape), sailMat);
    g.add(sail);
    const jib = new THREE.Mesh(new THREE.ShapeGeometry(sailShape), sailMat);
    jib.scale.set(-0.7, 0.8, 1);
    g.add(jib);
    g.scale.setScalar(1.6);
    return g;
  }

  clear() {
    for (const m of this.instanced || []) {
      this.group.remove(m);
      m.dispose();
    }
    this.instanced = [];
  }

  addInstanced(geo, mat, transforms, { shadow = true, colors = null } = {}) {
    if (!transforms.length) return;
    const m = new THREE.InstancedMesh(geo, mat, transforms.length);
    transforms.forEach((t, i) => m.setMatrixAt(i, t));
    if (colors) colors.forEach((c, i) => m.setColorAt(i, c));
    m.castShadow = shadow;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    this.group.add(m);
    this.instanced.push(m);
  }

  build(level, heightFn) {
    this.clear();
    const rand = mulberry32(level.seed * 7 + 3);
    const cfg = level.scenery || {};
    const outsidePlay = (x, z, m = 2.5) => Math.max(Math.abs(x), Math.abs(z)) > HALF + m;
    const slope = (x, z) => {
      const e = 0.8;
      return Math.hypot(heightFn(x + e, z) - heightFn(x - e, z), heightFn(x, z + e) - heightFn(x, z - e)) / (2 * e);
    };
    const mat4 = (x, y, z, ry, s, tilt = 0) => {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt * (rand() - 0.5), ry, tilt * (rand() - 0.5)));
      return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
    };
    const scatter = (count, tries, region, accept) => {
      const out = [];
      for (let k = 0; k < tries && out.length < count; k++) {
        const [x, z] = region();
        const h = heightFn(x, z);
        if (accept(x, z, h)) out.push([x, z, h]);
      }
      return out;
    };
    const nearRegion = () => [(rand() - 0.5) * 150, -40 + rand() * 120];
    const islandRegion = () => {
      const isl = cfg.islands[Math.floor(rand() * cfg.islands.length)];
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * isl.r * 0.75;
      return [isl.x + Math.cos(a) * r, isl.z + Math.sin(a) * r];
    };

    // palms: near the beach, plus on islands
    const palmSpots = scatter(cfg.palms || 20, 4000, nearRegion,
      (x, z, h) => outsidePlay(x, z, 3) && h > 0.9 && h < 6 && slope(x, z) < 0.35 && Math.hypot(x, z) < 75);
    if (cfg.islands) {
      palmSpots.push(...scatter(Math.round((cfg.palms || 20) * 0.7), 3000, islandRegion, (x, z, h) => h > 1.2 && slope(x, z) < 0.6));
    }
    const byVariant = [[], [], [], []];
    for (const [x, z, h] of palmSpots) {
      byVariant[Math.floor(rand() * 4)].push(mat4(x, h - 0.1, z, rand() * Math.PI * 2, 0.75 + rand() * 0.55));
    }
    byVariant.forEach((list, v) => {
      this.addInstanced(this.palms[v].trunk, this.trunkMat, list);
      this.addInstanced(this.palms[v].nuts, this.nutMat, list);
      // gentle per-tree variation: some fresher green, some sun-bleached
      const tint = list.map(() => new THREE.Color(1, 1, 1).lerp(new THREE.Color(rand() < 0.5 ? 0xd8f0a0 : 0xfff0b0), rand() * 0.45).multiplyScalar(0.92 + rand() * 0.18));
      this.addInstanced(this.palms[v].fronds, this.frondMat, list, { colors: tint });
    });

    // rocks along headlands and shores, half sunk into sand
    const rockSpots = scatter(cfg.rocks || 20, 5000, () => [(rand() - 0.5) * 200, -70 + rand() * 110],
      (x, z, h) => outsidePlay(x, z, 4) && h > -1.6 && h < 4.5 && (slope(x, z) > 0.12 || h < 0.4) && Math.hypot(x, z) < 110);
    const rocksBy = [[], [], []];
    for (const [x, z, h] of rockSpots) {
      const s = 0.7 + rand() * 2.4;
      rocksBy[Math.floor(rand() * 3)].push(mat4(x, h - 0.15 * s, z, rand() * 6.28, s, 0.4));
      if (rand() < 0.5) rocksBy[Math.floor(rand() * 3)].push(mat4(x + (rand() - 0.5) * s * 2.5, h - 0.1, z + (rand() - 0.5) * s * 2.5, rand() * 6.28, s * 0.45, 0.6));
    }
    rocksBy.forEach((list, v) => this.addInstanced(this.rockGeos[v], this.rockMat, list));

    // beach plants: tall grasses near the sand line, shrubs and ferns further up
    const dry = level.tide.high + 0.35;
    const kinds = {
      grass: { w: 26, s: [0.7, 1.2] }, seaoats: { w: 16, s: [0.9, 1.5] }, reed: { w: 9, s: [1.2, 1.9] },
      purslane: { w: 12, s: [0.35, 0.6] }, morningglory: { w: 12, s: [0.4, 0.7] }, fern: { w: 10, s: [0.7, 1.2] },
      shrub: { w: 12, s: [0.8, 1.6] }, sprout: { w: 6, s: [1.0, 1.8] },
    };
    const total = Object.values(kinds).reduce((a, k) => a + k.w, 0);
    const pickKind = () => {
      let r = rand() * total;
      for (const [k, v] of Object.entries(kinds)) { r -= v.w; if (r <= 0) return k; }
      return 'grass';
    };
    const byPlant = Object.fromEntries(this.plants.map((p) => [p.name, []]));
    const plantSpots = scatter(520, 9000, () => [(rand() - 0.5) * 130, -14 + rand() * 90],
      (x, z, h) => outsidePlay(x, z, 1.5) && h > dry && h < 7 && slope(x, z) < 0.55 && Math.hypot(x, z) < 80);
    if (cfg.islands) plantSpots.push(...scatter(160, 3000, islandRegion, (x, z, h) => h > 1.0));
    for (const [x, z, h] of plantSpots) {
      // clumps: a few plants of one kind together
      const kind = pickKind();
      const n = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const ox = x + (rand() - 0.5) * 1.6, oz = z + (rand() - 0.5) * 1.6;
        const [a, b] = kinds[kind].s;
        byPlant[kind].push(mat4(ox, heightFn(ox, oz) - 0.04, oz, rand() * 6.28, a + rand() * (b - a)));
      }
    }
    for (const p of this.plants) this.addInstanced(p.geo, p.mat, byPlant[p.name], { shadow: p.name === 'shrub' || p.name === 'sprout' || p.name === 'reed' });

    // coral heads in the lagoon
    if (cfg.coral) {
      const coralSpots = scatter(cfg.coral, 6000, () => [(rand() - 0.5) * 160, -90 + rand() * 80],
        (x, z, h) => outsidePlay(x, z, 3) && h < -0.5 && h > -3.2);
      const palette = [0xff7a8a, 0xffa25a, 0xc77dff, 0xffd166, 0xff5d8f, 0x7bdff2].map((c) => new THREE.Color(c));
      const coralBy = [[], []], colBy = [[], []];
      for (const [x, z, h] of coralSpots) {
        const v = Math.floor(rand() * 2);
        coralBy[v].push(mat4(x, h - 0.05, z, rand() * 6.28, 0.8 + rand() * 1.6));
        colBy[v].push(palette[Math.floor(rand() * palette.length)]);
      }
      coralBy.forEach((list, v) => this.addInstanced(this.coralGeos[v], this.coralMat, list, { shadow: false, colors: colBy[v] }));
    }

    this.boat.visible = true;
    this.boatPath = { x0: -160 + rand() * 60, z: -150 - rand() * 80, speed: 1.2 + rand() * 0.8 };
  }

  update(dt, time, tide) {
    sceneryTime.value = time;
    if (this.boat.visible && this.boatPath) {
      const p = this.boatPath;
      const x = ((p.x0 + time * p.speed + 260) % 520) - 260;
      this.boat.position.set(x, tide + 0.1 + Math.sin(time * 0.9) * 0.08, p.z);
      this.boat.rotation.set(Math.sin(time * 0.7) * 0.04, 0, Math.sin(time * 0.9) * 0.05);
    }
  }
}
