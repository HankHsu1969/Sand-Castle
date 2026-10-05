import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeSimplex, mulberry32 } from '../core/noise.js';
import { withFog } from './fog.js';

export const propTime = { value: 0 };

const geoCache = {};
const matCache = {};

function mat(key, params, extra) {
  if (!matCache[key]) matCache[key] = withFog(new THREE.MeshStandardMaterial(params), 'prop-' + (extra ? key : 'std'), extra);
  return matCache[key];
}

// ---------- geometries ----------
const ni = (g) => (g.index ? g.toNonIndexed() : g);
const hash = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

function paint(g, fn) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    fn(c, p.getX(i), p.getY(i), p.getZ(i), n ? n.getY(i) : 1);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function scallopGeo() {
  const R = 14, T = 44;
  const pos = [], col = [], idx = [];
  for (let ri = 0; ri <= R; ri++) {
    const r = ri / R;
    for (let ti = 0; ti <= T; ti++) {
      const th = -1.2 + (ti / T) * 2.4;
      const rib = Math.pow(Math.abs(Math.sin(th * 9)), 0.55);
      const scallopEdge = 1 - 0.035 * (1 - rib) * r;
      const x = r * Math.sin(th) * 0.26 * scallopEdge;
      const z = r * Math.cos(th) * 0.26 * scallopEdge - 0.1;
      const y = 0.065 * Math.sin(Math.PI * r * 0.85) + 0.014 * rib * r + 0.004;
      pos.push(x, y, z);
      // ribs, concentric growth lines and a darker hinge
      const growth = 0.92 + 0.08 * Math.sin(r * 60);
      const l = (0.72 + 0.22 * rib * r + 0.12 * r) * growth;
      const band = 0.5 + 0.5 * Math.sin(r * 14);
      col.push(l, l * (0.9 + 0.07 * band), l * (0.86 + 0.1 * band));
    }
  }
  for (let ri = 0; ri < R; ri++) {
    for (let ti = 0; ti < T; ti++) {
      const a = ri * (T + 1) + ti, b = a + T + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  // the two little "ears" beside the hinge
  for (const side of [-1, 1]) {
    const base = pos.length / 3;
    pos.push(0, 0.012, -0.1, side * 0.075, 0.01, -0.105, side * 0.07, 0.012, -0.06, 0, 0.018, -0.055);
    for (let k = 0; k < 4; k++) col.push(0.8, 0.72, 0.68);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function conchGeo() {
  // spindle-shaped shell from a lathe profile, with spiral sutures and stripes
  const pts = [[0.0, -0.075], [0.016, -0.055], [0.03, -0.02], [0.07, 0.035], [0.104, 0.09], [0.112, 0.13],
    [0.09, 0.17], [0.064, 0.21], [0.043, 0.25], [0.024, 0.29], [0.009, 0.33], [0.0, 0.35]];
  const curve = new THREE.SplineCurve(pts.map((q) => new THREE.Vector2(q[0], q[1])));
  const g = new THREE.LatheGeometry(curve.getPoints(56), 56);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const th = Math.atan2(z, x);
    const s = (((y * 10 + th / (Math.PI * 2)) % 1) + 1) % 1;
    const groove = Math.pow(s, 10) * 0.2;
    const knob = y > 0.095 && y < 0.17 ? 0.07 * Math.max(0, Math.sin(th * 9)) * Math.sin(((y - 0.095) / 0.075) * Math.PI) : 0;
    const k = 1 - groove + knob;
    p.setX(i, x * k);
    p.setZ(i, z * k);
    const stripe = 0.5 + 0.5 * Math.sin(th * 2 + y * 55);
    const l = (0.95 - groove * 2) * (0.92 + 0.08 * Math.sin(y * 120));
    // pink glossy lip on the aperture side
    const lip = THREE.MathUtils.smoothstep(Math.cos(th), 0.55, 0.95) * THREE.MathUtils.smoothstep(y, 0.02, 0.1) * (1 - THREE.MathUtils.smoothstep(y, 0.15, 0.2));
    col[i * 3] = l * (1 - lip * 0.05);
    col[i * 3 + 1] = l * (0.9 - 0.18 * stripe) * (1 - lip * 0.3);
    col[i * 3 + 2] = l * (0.8 - 0.32 * stripe) * (1 - lip * 0.1) + lip * 0.12;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.rotateZ(Math.PI / 2 - 0.18);
  g.translate(0.12, 0.085, 0);
  return g;
}

function starfishGeo() {
  // five rounded, tapering arms with a domed back and little bumps
  const shape = new THREE.Shape();
  const tips = 5;
  for (let k = 0; k < tips; k++) {
    const a = (k / tips) * Math.PI * 2 + Math.PI / 2;
    const b = a + Math.PI / tips;
    const tip = [Math.cos(a) * 0.27, Math.sin(a) * 0.27];
    const val = [Math.cos(b) * 0.085, Math.sin(b) * 0.085];
    const side = (ang, r) => [Math.cos(ang) * r, Math.sin(ang) * r];
    if (k === 0) shape.moveTo(...side(a - 0.09, 0.25));
    shape.quadraticCurveTo(tip[0] * 1.06, tip[1] * 1.06, ...side(a + 0.09, 0.25));
    shape.quadraticCurveTo(...side(b - 0.25, 0.12), val[0], val[1]);
    shape.quadraticCurveTo(...side(b + 0.25, 0.12), ...side(a + (2 * Math.PI) / tips - 0.09, 0.25));
  }
  let g = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 5, curveSegments: 10 });
  g.rotateX(-Math.PI / 2);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = Math.hypot(x, z);
    const dome = 1 + 1.4 * Math.max(0, 1 - r / 0.25);
    const bump = y > 0.02 ? 0.006 * Math.max(0, Math.sin(x * 95) * Math.sin(z * 95)) : 0;
    p.setY(i, y * dome + bump + 0.035);
  }
  g.computeVertexNormals();
  return paint(g, (c, x, y, z) => {
    const r = Math.hypot(x, z);
    const dot = Math.sin(x * 95) * Math.sin(z * 95) > 0.6 && y > 0.06 ? 1 : 0;
    c.setRGB(1, 1, 1).multiplyScalar(0.8 + 0.2 * (1 - r / 0.27));
    if (dot) c.setRGB(1.25, 1.15, 1.0);
  });
}

function pebbleGeo(seed) {
  let g = new THREE.IcosahedronGeometry(1, 3);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const n = makeSimplex(seed);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(1 + 0.1 * n(v.x * 1.5 + seed, v.z * 1.5));
    p.setXYZ(i, v.x * 0.16, v.y * 0.075 + 0.04, v.z * 0.12);
  }
  g.computeVertexNormals();
  // granite speckles and a pale mineral vein
  return paint(g, (c, x, y, z) => {
    const sp = hash(x * 90 + seed, z * 90 + y * 40);
    const vein = Math.abs(Math.sin(x * 40 + z * 25 + seed)) < 0.06 ? 0.25 : 0;
    const l = 0.82 + 0.3 * (sp > 0.88 ? 1 : sp < 0.1 ? -0.6 : 0) + vein;
    c.setRGB(l, l, l);
  });
}

function driftwoodGeo() {
  const parts = [];
  const tube = (pts, r0, r1) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q)));
    const segs = 32, radial = 10;
    const pos = [], col = [], idx = [];
    const frames = curve.computeFrenetFrames(segs, false);
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const c = curve.getPointAt(t);
      const knot = Math.exp(-Math.pow((t - 0.42) / 0.04, 2)) * 0.25;
      const r = (r0 + (r1 - r0) * t) * (1 + 0.12 * Math.sin(t * 19) + knot);
      for (let k = 0; k <= radial; k++) {
        const a = (k / radial) * Math.PI * 2;
        const groove = 1 - 0.08 * Math.pow(Math.abs(Math.sin(a * 4 + t * 3)), 6);
        const d = new THREE.Vector3().addScaledVector(frames.normals[s], Math.cos(a)).addScaledVector(frames.binormals[s], Math.sin(a));
        pos.push(c.x + d.x * r * groove, c.y + d.y * r * groove, c.z + d.z * r * groove);
        // weathered grain: silver-grey with darker cracks
        const l = (0.82 + 0.18 * Math.sin(a * 7 + t * 40)) * (groove < 0.95 ? 0.6 : 1) * (1 - knot * 1.2);
        col.push(l, l * 0.94, l * 0.86);
      }
    }
    for (let s = 0; s < segs; s++) for (let k = 0; k < radial; k++) {
      const a = s * (radial + 1) + k, b = a + radial + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(g);
  };
  tube([[-0.7, 0.06, 0], [-0.25, 0.09, 0.1], [0.2, 0.07, -0.05], [0.7, 0.04, 0.06]], 0.08, 0.035);
  tube([[0.05, 0.08, 0.0], [0.25, 0.13, 0.2], [0.4, 0.11, 0.38]], 0.035, 0.012);
  tube([[-0.35, 0.08, 0.02], [-0.45, 0.12, -0.15], [-0.52, 0.1, -0.3]], 0.03, 0.01);
  return mergeGeometries(parts);
}

function seaweedGeo() {
  const parts = [];
  const rand = mulberry32(17);
  for (let k = 0; k < 6; k++) {
    const len = 0.5 + rand() * 0.5, w = 0.06 + rand() * 0.04;
    const a0 = rand() * Math.PI * 2;
    const steps = 18;
    const pos = [], idx = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const a = a0 + Math.sin(t * 6 + k) * 0.5;
      const x = Math.cos(a0) * len * t + Math.sin(t * 9 + k) * 0.05;
      const z = Math.sin(a0) * len * t + Math.cos(t * 7 + k) * 0.05;
      const ww = w * (1 - t * 0.6) * (1 + 0.25 * Math.sin(t * 30));
      const sx = -Math.sin(a) * ww, sz = Math.cos(a) * ww;
      const y = 0.015 + 0.02 * Math.sin(t * 11 + k);
      pos.push(x - sx, y, z - sz, x + sx, y + 0.01, z + sz);
    }
    for (let s = 0; s < steps; s++) { const a = s * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(g);
  }
  // a few air bladders
  for (let k = 0; k < 7; k++) {
    const b = new THREE.SphereGeometry(0.018, 8, 6).deleteAttribute('uv');
    b.translate((rand() - 0.5) * 0.6, 0.03, (rand() - 0.5) * 0.6);
    parts.push(ni(b));
  }
  return mergeGeometries(parts.map((g) => (g.index ? ni(g) : g)));
}

function sandDollarTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grd.addColorStop(0, '#f5ead6'); grd.addColorStop(1, '#e2cfae');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(140,110,80,0.6)'; g.lineWidth = 3.5;
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
    g.save(); g.translate(128, 128); g.rotate(a + Math.PI / 2);
    g.beginPath(); g.ellipse(0, -50, 15, 42, 0, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2;
    for (let d = -84; d < -18; d += 7) { g.beginPath(); g.moveTo(-10, d); g.lineTo(10, d); g.stroke(); }
    g.restore();
  }
  for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(150,120,90,${Math.random() * 0.22})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function coralPieceGeo() {
  const rand = mulberry32(23);
  const parts = [];
  const branch = (o, dir, len, r, depth) => {
    const g = new THREE.CylinderGeometry(r * 0.75, r, len, 7);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    g.translate(o.x, o.y, o.z);
    g.deleteAttribute('uv');
    parts.push(ni(g));
    const tip = o.clone().addScaledVector(dir, len);
    const cap = new THREE.SphereGeometry(r * 0.8, 7, 5);
    cap.translate(tip.x, tip.y, tip.z);
    cap.deleteAttribute('uv');
    parts.push(ni(cap));
    if (depth > 0) for (let k = 0; k < 2; k++) {
      const nd = dir.clone().add(new THREE.Vector3(rand() - 0.5, 0.2, rand() - 0.5)).normalize();
      branch(tip, nd, len * 0.72, r * 0.72, depth - 1);
    }
  };
  for (let k = 0; k < 3; k++) branch(new THREE.Vector3((rand() - 0.5) * 0.1, 0, (rand() - 0.5) * 0.1), new THREE.Vector3(rand() - 0.5, 1.3, rand() - 0.5).normalize(), 0.16, 0.035, 2);
  const g = mergeGeometries(parts);
  // tiny polyp pores
  return paint(g, (c, x, y, z) => { const p = hash(x * 300, y * 300 + z * 200); c.setScalar(p > 0.85 ? 0.75 : 1); });
}

function cowrieGeo() {
  let g = new THREE.SphereGeometry(0.1, 28, 18).deleteAttribute('uv');
  g = mergeVertices(g.deleteAttribute('normal'));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i, x * 1.25, y > 0 ? y * 0.72 : y * 0.25, z * 0.8);
  }
  g.computeVertexNormals();
  g.translate(0, 0.026, 0);
  return paint(g, (c, x, y, z) => {
    const spot = Math.sin(x * 70 + Math.sin(z * 40)) * Math.sin(z * 60) > 0.55;
    const band = Math.abs(Math.sin(z * 18)) < 0.15;
    c.set(spot ? 0x8a5a2b : band ? 0xe7c48f : 0xf5e8cf);
    if (y < 0.03) c.set(0xfff6e8);
    if (y < 0.03 && Math.abs(z) < 0.012) c.set(0x5a3d22); // the toothed slit
  });
}

function musselGeo() {
  const half = (side) => {
    let g = new THREE.SphereGeometry(0.1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).deleteAttribute('uv');
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const taper = 1 - 0.55 * THREE.MathUtils.smoothstep(x, -0.1, 0.1);
      p.setXYZ(i, x * 1.6, y * 0.32, z * 0.75 * taper);
    }
    g.rotateX(side * 0.35);
    g.translate(0, 0.015, side * 0.025);
    g.computeVertexNormals();
    return paint(g, (c, x, y, z) => {
      const ring = 0.5 + 0.5 * Math.sin(Math.hypot(x + 0.16, z) * 90);
      c.setRGB(0.1 + 0.05 * ring, 0.12 + 0.05 * ring, 0.24 + 0.1 * ring);
    });
  };
  return mergeGeometries([ni(half(1)), ni(half(-1))]);
}

function seaglassGeo(seed) {
  const rand = mulberry32(seed);
  const parts = [];
  for (let k = 0; k < 4; k++) {
    let g = new THREE.IcosahedronGeometry(1, 1).deleteAttribute('uv');
    g = mergeVertices(g.deleteAttribute('normal'));
    const sx = 0.035 + rand() * 0.03;
    g.scale(sx * 1.3, sx * 0.45, sx);
    g.rotateY(rand() * 3);
    g.translate((rand() - 0.5) * 0.18, sx * 0.4, (rand() - 0.5) * 0.18);
    g.computeVertexNormals();
    parts.push(ni(g));
  }
  return mergeGeometries(parts);
}

function coconutGeo() {
  let g = new THREE.SphereGeometry(0.13, 26, 18).deleteAttribute('uv');
  g = mergeVertices(g.deleteAttribute('normal'));
  const p = g.attributes.position;
  const n = makeSimplex(12);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ridge = 1 + 0.06 * Math.max(0, Math.cos(Math.atan2(z, y) * 3)) + 0.02 * n(x * 40, y * 40 + z * 20);
    p.setXYZ(i, x * 1.15 * ridge, y * ridge, z * ridge);
  }
  g.computeVertexNormals();
  g.rotateZ(0.4);
  g.translate(0, 0.11, 0);
  return paint(g, (c, x, y, z) => {
    const fib = 0.75 + 0.25 * Math.sin(x * 160 + Math.sin(y * 40) * 3);
    c.setRGB(0.42 * fib, 0.27 * fib, 0.14 * fib);
    if (x > 0.12 && Math.hypot(y - 0.12, z) < 0.03) c.setRGB(0.12, 0.07, 0.04); // the "eyes"
  });
}

function flowerGeo() {
  const parts = [];
  const petal = new THREE.Shape();
  petal.moveTo(0, 0); petal.bezierCurveTo(0.07, 0.03, 0.09, 0.13, 0, 0.16); petal.bezierCurveTo(-0.09, 0.13, -0.07, 0.03, 0, 0);
  for (let k = 0; k < 5; k++) {
    const g = new THREE.ShapeGeometry(petal, 8);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      p.setZ(i, -0.25 * y * y * 6 + Math.sin(p.getX(i) * 40) * 0.004); // cup the petals upward
    }
    g.rotateX(-Math.PI / 2 + 0.45);
    g.rotateY((k / 5) * Math.PI * 2);
    g.deleteAttribute('uv');
    parts.push(paint(g, (c, x, y, z) => {
      const r = Math.hypot(x, z);
      c.setRGB(1, 1, 1).lerp(new THREE.Color(0x7a0f2a), Math.max(0, 1 - r / 0.04));
    }));
  }
  const stamen = new THREE.CylinderGeometry(0.004, 0.006, 0.13, 5).deleteAttribute('uv');
  stamen.rotateX(-0.5); stamen.translate(0, 0.07, -0.03);
  parts.push(paint(stamen, (c) => c.setRGB(1.4, 1.2, 0.6)));
  const leaf = new THREE.Shape();
  leaf.moveTo(0, 0); leaf.quadraticCurveTo(0.06, 0.1, 0, 0.2); leaf.quadraticCurveTo(-0.06, 0.1, 0, 0);
  for (const a of [0.8, 3.6]) {
    const g = new THREE.ShapeGeometry(leaf, 6).deleteAttribute('uv');
    g.rotateX(-Math.PI / 2 + 0.1); g.rotateY(a); g.translate(0, 0.005, 0);
    parts.push(paint(g, (c) => c.setRGB(0.18, 0.42, 0.14)));
  }
  const g = mergeGeometries(parts.map((q) => (q.index ? ni(q) : q)));
  g.computeVertexNormals();
  g.translate(0, 0.02, 0);
  return g;
}

function lanternParts() {
  const body = new THREE.SphereGeometry(0.11, 18, 12);
  body.scale(1, 1.15, 1);
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const rib = 1 - 0.05 * Math.pow(Math.abs(Math.sin(a * 5)), 4);
    p.setX(i, p.getX(i) * rib); p.setZ(i, p.getZ(i) * rib);
  }
  body.computeVertexNormals();
  body.translate(0, 0.62, 0);
  const pole = new THREE.CylinderGeometry(0.012, 0.016, 0.62, 6);
  pole.translate(0, 0.31, 0);
  const cap = new THREE.CylinderGeometry(0.05, 0.06, 0.03, 10);
  cap.translate(0, 0.75, 0);
  return { body, pole, cap };
}

function doorGeo() {
  const w = 0.34, h = 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0); shape.lineTo(-w / 2, h - w / 2); shape.absarc(0, h - w / 2, w / 2, Math.PI, 0, true); shape.lineTo(w / 2, 0); shape.lineTo(-w / 2, 0);
  const door = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: 16 });
  door.deleteAttribute('uv');
  paint(door, (c, x, y) => {
    const plank = Math.abs(Math.sin(x * 46)) < 0.1 ? 0.55 : 1;
    const grain = 0.85 + 0.15 * Math.sin(y * 80 + x * 5);
    const band = Math.abs(y - 0.12) < 0.02 || Math.abs(y - 0.34) < 0.02;
    if (band) c.setRGB(0.18, 0.17, 0.17); else c.setRGB(0.48 * plank * grain, 0.3 * plank * grain, 0.16 * plank * grain);
  });
  const parts = [ni(door)];
  for (const y of [0.12, 0.34]) for (const x of [-0.12, -0.04, 0.04, 0.12]) {
    const stud = new THREE.SphereGeometry(0.012, 6, 4).deleteAttribute('uv');
    stud.translate(x, y, 0.045);
    parts.push(paint(ni(stud), (c) => c.setRGB(0.25, 0.24, 0.24)));
  }
  const ring = new THREE.TorusGeometry(0.025, 0.006, 6, 14).deleteAttribute('uv');
  ring.translate(0.09, 0.23, 0.05);
  parts.push(paint(ni(ring), (c) => c.setRGB(0.75, 0.6, 0.25)));
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  g.translate(0, -0.08, 0);
  return g;
}

function windowGeo() {
  const w = 0.16, h = 0.24;
  const outer = new THREE.Shape();
  outer.moveTo(-w / 2 - 0.03, -0.02); outer.lineTo(-w / 2 - 0.03, h - w / 2); outer.absarc(0, h - w / 2, w / 2 + 0.03, Math.PI, 0, true); outer.lineTo(w / 2 + 0.03, -0.02); outer.lineTo(-w / 2 - 0.03, -0.02);
  const hole = new THREE.Path();
  hole.moveTo(-w / 2, 0); hole.lineTo(w / 2, 0); hole.lineTo(w / 2, h - w / 2); hole.absarc(0, h - w / 2, w / 2, 0, Math.PI, false); hole.lineTo(-w / 2, 0);
  outer.holes.push(hole);
  const frame = new THREE.ExtrudeGeometry(outer, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 14 });
  frame.deleteAttribute('uv');
  paint(frame, (c) => c.setRGB(0.86, 0.74, 0.56));
  const inner = new THREE.Shape();
  inner.moveTo(-w / 2, 0); inner.lineTo(-w / 2, h - w / 2); inner.absarc(0, h - w / 2, w / 2, Math.PI, 0, true); inner.lineTo(w / 2, 0); inner.lineTo(-w / 2, 0);
  const dark = new THREE.ShapeGeometry(inner, 14).deleteAttribute('uv');
  dark.translate(0, 0, 0.004);
  paint(dark, (c, x, y) => c.setRGB(0.08 + y * 0.12, 0.06 + y * 0.1, 0.05 + y * 0.08));
  const bar = new THREE.BoxGeometry(0.012, h, 0.01).deleteAttribute('uv');
  bar.translate(0, h / 2 - 0.01, 0.012);
  paint(bar, (c) => c.setRGB(0.3, 0.22, 0.15));
  const g = mergeGeometries([ni(frame), ni(dark), ni(bar)]);
  g.computeVertexNormals();
  g.translate(0, -0.1, 0);
  return g;
}

function bridgeGeo() {
  const parts = [];
  const rand = mulberry32(31);
  for (let k = 0; k < 11; k++) {
    const plank = new THREE.BoxGeometry(0.1, 0.03, 0.46 + (rand() - 0.5) * 0.04).deleteAttribute('uv');
    plank.rotateY((rand() - 0.5) * 0.06);
    const x = -0.6 + k * 0.12;
    plank.translate(x, 0.04 + 0.06 * Math.sin(((k + 0.5) / 11) * Math.PI), 0);
    const tone = 0.8 + rand() * 0.25;
    parts.push(paint(ni(plank), (c, px, py) => c.setRGB(0.55 * tone, 0.38 * tone, 0.22 * tone).multiplyScalar(0.9 + 0.1 * Math.sin(px * 120))));
  }
  for (const z of [-0.22, 0.22]) {
    for (const x of [-0.62, 0.62]) {
      const post = new THREE.CylinderGeometry(0.018, 0.022, 0.32, 6).deleteAttribute('uv');
      post.translate(x, 0.12, z);
      parts.push(paint(ni(post), (c) => c.setRGB(0.42, 0.29, 0.17)));
    }
    const rope = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.62, 0.26, z), new THREE.Vector3(0, 0.22, z), new THREE.Vector3(0.62, 0.26, z)), 16, 0.008, 5).deleteAttribute('uv');
    parts.push(paint(ni(rope), (c) => c.setRGB(0.78, 0.68, 0.5)));
  }
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

function pinwheelParts() {
  const blades = [];
  for (let k = 0; k < 4; k++) {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0); sh.lineTo(0.13, 0.02); sh.quadraticCurveTo(0.1, 0.1, 0.02, 0.13); sh.lineTo(0, 0);
    const g = new THREE.ShapeGeometry(sh, 4).deleteAttribute('uv');
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getX(i) * 0.25);
    g.rotateZ((k / 4) * Math.PI * 2);
    blades.push(ni(g));
  }
  const wheel = mergeGeometries(blades);
  wheel.computeVertexNormals();
  const cols = [new THREE.Color(0xff5d6c), new THREE.Color(0xffc93c), new THREE.Color(0x39b7e8), new THREE.Color(0x7bd389)];
  const c = new Float32Array(wheel.attributes.position.count * 3);
  for (let i = 0; i < wheel.attributes.position.count; i++) {
    const col = cols[Math.floor(i / (wheel.attributes.position.count / 4))];
    c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
  }
  wheel.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const stick = new THREE.CylinderGeometry(0.01, 0.012, 0.62, 6);
  stick.translate(0, 0.31, 0);
  return { wheel, stick };
}

function getGeo(key, fn) {
  if (!geoCache[key]) geoCache[key] = fn();
  return geoCache[key];
}

export const DECOR_INFO = {
  scallop: { name: '扇貝', colors: [0xffb7a8, 0xffd3a8, 0xfff0e2, 0xf6a07a, 0xe9b6ff] },
  conch: { name: '海螺', colors: [0xffffff, 0xfff1e0] },
  starfish: { name: '海星', colors: [0xff8a3d, 0xff5e57, 0xd27bff, 0xffb347] },
  cowrie: { name: '寶螺', colors: [0xffffff] },
  mussel: { name: '淡菜殼', colors: [0xffffff] },
  sanddollar: { name: '海膽殼', colors: [0xffffff] },
  pebble: { name: '鵝卵石', colors: [0x9a958c, 0xe8e2d6, 0x5b5a58, 0xc08a6a, 0xb7c4c9] },
  seaglass: { name: '海玻璃', colors: [0x6fe0c8, 0x7fb8ff, 0xa5e86a, 0xffd27a] },
  coral: { name: '珊瑚', colors: [0xff9fb2, 0xffc3a0, 0xf5f0ea] },
  driftwood: { name: '漂流木', colors: [0xc9b49a, 0xb3a088] },
  seaweed: { name: '海藻', colors: [0x55702e, 0x3e5b2b, 0x6f6a2a] },
  coconut: { name: '椰子', colors: [0xffffff] },
  flower: { name: '扶桑花', colors: [0xff3b5c, 0xff7aa8, 0xffb627, 0xff6a3d] },
  pinwheel: { name: '風車', colors: [0xffffff] },
  lantern: { name: '燈籠', colors: [0xffa040, 0xff6b6b, 0xffd166] },
  door: { name: '城門', colors: [0xffffff], wall: true },
  window: { name: '窗戶', colors: [0xffffff], wall: true },
  bridge: { name: '木橋', colors: [0xffffff], facing: true },
};
export const DECOR_LIST = Object.keys(DECOR_INFO);

export function makeDecor(type, rand = Math.random) {
  const info = DECOR_INFO[type];
  const color = info.colors[Math.floor(rand() * info.colors.length)];
  const g = new THREE.Group();
  let mesh;
  switch (type) {
    case 'scallop':
      mesh = new THREE.Mesh(getGeo('scallop', scallopGeo), mat('scallop' + color, { color, vertexColors: true, roughness: 0.42, side: THREE.DoubleSide }));
      break;
    case 'conch':
      mesh = new THREE.Mesh(getGeo('conch', conchGeo), mat('conch' + color, { color, vertexColors: true, roughness: 0.28 }));
      break;
    case 'starfish':
      mesh = new THREE.Mesh(getGeo('starfish', starfishGeo), mat('star' + color, { color, vertexColors: true, roughness: 0.75 }));
      break;
    case 'cowrie':
      mesh = new THREE.Mesh(getGeo('cowrie', cowrieGeo), mat('cowrie', { vertexColors: true, roughness: 0.08, metalness: 0.05 }));
      break;
    case 'mussel':
      mesh = new THREE.Mesh(getGeo('mussel', musselGeo), mat('mussel', { vertexColors: true, roughness: 0.25, side: THREE.DoubleSide }));
      break;
    case 'pebble': {
      const v = Math.floor(rand() * 3);
      mesh = new THREE.Mesh(getGeo('pebble' + v, () => pebbleGeo(v * 7 + 1)), mat('pebble' + color, { color, vertexColors: true, roughness: 0.45 }));
      break;
    }
    case 'seaglass':
      mesh = new THREE.Mesh(getGeo('seaglass' + (color & 3), () => seaglassGeo(color & 15)), mat('glass' + color, { color, roughness: 0.35, transparent: true, opacity: 0.78, emissive: color, emissiveIntensity: 0.12 }));
      break;
    case 'driftwood':
      mesh = new THREE.Mesh(getGeo('driftwood', driftwoodGeo), mat('drift' + color, { color, vertexColors: true, roughness: 0.95 }));
      break;
    case 'seaweed':
      mesh = new THREE.Mesh(getGeo('seaweed', seaweedGeo), mat('weed' + color, { color, roughness: 0.35, side: THREE.DoubleSide }));
      break;
    case 'coral':
      mesh = new THREE.Mesh(getGeo('coralp', coralPieceGeo), mat('coralp' + color, { color, vertexColors: true, roughness: 0.8 }));
      break;
    case 'coconut':
      mesh = new THREE.Mesh(getGeo('coconut', coconutGeo), mat('coconut', { vertexColors: true, roughness: 0.9 }));
      break;
    case 'flower':
      mesh = new THREE.Mesh(getGeo('flower', flowerGeo), mat('flower' + color, { color, vertexColors: true, roughness: 0.55, side: THREE.DoubleSide }));
      break;
    case 'sanddollar': {
      const geo = getGeo('sanddollar', () => {
        const c = new THREE.CylinderGeometry(0.15, 0.155, 0.022, 40);
        c.translate(0, 0.012, 0);
        return c;
      });
      if (!matCache.sanddollarMat) matCache.sanddollarMat = withFog(new THREE.MeshStandardMaterial({ map: sandDollarTexture(), roughness: 0.85 }), 'prop-std');
      mesh = new THREE.Mesh(geo, matCache.sanddollarMat);
      break;
    }
    case 'pinwheel': {
      const parts = getGeo('pinwheel', pinwheelParts);
      const stick = new THREE.Mesh(parts.stick, mat('pole', { color: 0xf4efe6, roughness: 0.6 }));
      const wheel = new THREE.Mesh(parts.wheel, mat('pinwheel', { vertexColors: true, roughness: 0.5, side: THREE.DoubleSide }));
      wheel.position.set(0, 0.6, 0.02);
      stick.castShadow = wheel.castShadow = true;
      g.add(stick, wheel);
      g.userData.spinner = wheel;
      g.userData.flat = false;
      return g;
    }
    case 'lantern': {
      const parts = getGeo('lantern', lanternParts);
      const pole = new THREE.Mesh(parts.pole, mat('lanternpole', { color: 0xb3a088, roughness: 0.9 }));
      const cap = new THREE.Mesh(parts.cap, mat('lanterncap', { color: 0x2b2b2b, roughness: 0.5 }));
      const body = new THREE.Mesh(parts.body, mat('lantern' + color, { color, emissive: color, emissiveIntensity: 1.6, roughness: 0.6 }));
      pole.castShadow = true;
      g.add(pole, cap, body);
      g.userData.flat = false;
      return g;
    }
    case 'door':
      mesh = new THREE.Mesh(getGeo('door', doorGeo), mat('door', { vertexColors: true, roughness: 0.75 }));
      break;
    case 'window':
      mesh = new THREE.Mesh(getGeo('window', windowGeo), mat('window', { vertexColors: true, roughness: 0.9 }));
      break;
    case 'bridge':
      mesh = new THREE.Mesh(getGeo('bridge', bridgeGeo), mat('bridge', { vertexColors: true, roughness: 0.85 }));
      break;
    default:
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.1), mat('x', { color: 0xff00ff }));
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
  g.userData.flat = !['coral', 'door', 'window', 'bridge', 'flower'].includes(type);
  g.userData.wall = !!info.wall;
  g.userData.facing = !!info.facing;
  return g;
}

// ---------- flag ----------
const FLAG_COLORS = [0xe63946, 0xffb703, 0x219ebc, 0xff6fb5, 0x8e7dff, 0x2ec4b6];

function flagClothMat(color) {
  return mat('flag' + color, { color, roughness: 0.7, side: THREE.DoubleSide }, (shader) => {
    shader.uniforms.uTime = propTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float fx = uv.x;
        transformed.z += sin(fx * 7.0 - uTime * 7.0 + position.y * 4.0) * 0.045 * fx;
        transformed.y += sin(fx * 5.0 - uTime * 5.0) * 0.012 * fx;`
      );
  });
}

export function makeFlag(colorIndex = 0) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(
    getGeo('flagpole', () => { const c = new THREE.CylinderGeometry(0.016, 0.02, 1.0, 8); c.translate(0, 0.5, 0); return c; }),
    mat('pole', { color: 0xf4efe6, roughness: 0.6 })
  );
  const ball = new THREE.Mesh(getGeo('flagball', () => new THREE.SphereGeometry(0.035, 12, 8)), mat('gold', { color: 0xffcf5a, roughness: 0.3, metalness: 0.8 }));
  ball.position.y = 1.02;
  const clothGeo = getGeo('cloth', () => {
    const p = new THREE.PlaneGeometry(0.42, 0.24, 12, 4);
    // taper into a pennant
    const a = p.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const x = a.getX(i) + 0.21;
      a.setX(i, x);
      a.setY(i, a.getY(i) * (1 - (x / 0.42) * 0.85));
    }
    p.translate(0.015, 0.84, 0);
    return p;
  });
  const color = FLAG_COLORS[colorIndex % FLAG_COLORS.length];
  const cloth = new THREE.Mesh(clothGeo, flagClothMat(color));
  for (const m of [pole, ball, cloth]) { m.castShadow = true; g.add(m); }
  g.userData.flat = false;
  return g;
}

// ---------- treasure chest ----------
export function makeChest() {
  const g = new THREE.Group();
  const wood = mat('chestwood', { color: 0x7a4a2a, roughness: 0.8 });
  const gold = mat('gold', { color: 0xffcf5a, roughness: 0.3, metalness: 0.8 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.34), wood);
  base.position.y = 0.13;
  g.add(base);
  for (const x of [-0.18, 0.18]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.27, 0.35), gold);
    band.position.set(x, 0.13, 0);
    g.add(band);
  }
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.26, -0.17);
  const lidGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.5, 16, 1, false, 0, Math.PI);
  lidGeo.rotateZ(Math.PI / 2);
  lidGeo.rotateX(Math.PI / 2);
  const lid = new THREE.Mesh(lidGeo, wood);
  lid.position.set(0, 0, 0.17);
  lidPivot.add(lid);
  g.add(lidPivot);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.3), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.265;
  g.add(glow);
  g.traverse((o) => { if (o.isMesh && o !== glow) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.lid = lidPivot;
  g.userData.glow = glow;
  return g;
}

// ---------- hermit crab ----------
export function makeCrab(shellColor = 0xffe6cc) {
  const g = new THREE.Group();
  const body = mat('crabbody', { color: 0xe0563b, roughness: 0.55 });
  const dark = mat('crabeye', { color: 0x111111, roughness: 0.2 });
  const shell = new THREE.Mesh(getGeo('conch', conchGeo), mat('crabshell' + shellColor, { color: shellColor, vertexColors: true, roughness: 0.4 }));
  shell.scale.setScalar(1.15);
  shell.rotation.y = Math.PI;
  shell.position.set(0.05, 0.02, 0);
  g.add(shell);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), body);
  head.scale.set(1, 0.7, 1.1);
  head.position.set(-0.13, 0.07, 0);
  g.add(head);
  const legs = [];
  for (let k = 0; k < 6; k++) {
    const side = k < 3 ? 1 : -1;
    const leg = new THREE.Group();
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.13, 5), body);
    seg.position.y = -0.05;
    seg.rotation.z = 0.0;
    leg.add(seg);
    leg.position.set(-0.13 + (k % 3) * 0.035, 0.07, side * 0.04);
    leg.rotation.x = side * 0.9;
    g.add(leg);
    legs.push(leg);
  }
  for (const side of [1, -1]) {
    const claw = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 6), body);
    claw.scale.set(1.3, 0.8, 0.8);
    claw.position.set(-0.2, 0.06, side * 0.045);
    g.add(claw);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.06, 4), body);
    stalk.position.set(-0.17, 0.12, side * 0.02);
    g.add(stalk);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), dark);
    eye.position.set(-0.17, 0.15, side * 0.02);
    g.add(eye);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.legs = legs;
  g.scale.setScalar(1.6);
  return g;
}

// ---------- the hermit crabs' driftwood hut (level 4) ----------
export function makeCrabHome() {
  const g = new THREE.Group();
  const wood = mat('drift' + 0xb8a48a, { color: 0xb8a48a, roughness: 0.95 });
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.8, 6), wood);
    stick.position.set(Math.cos(a) * 0.18, 0.33, Math.sin(a) * 0.18);
    stick.lookAt(0, 1.2, 0);
    stick.rotateX(Math.PI / 2);
    stick.castShadow = true;
    g.add(stick);
  }
  const weed = new THREE.Mesh(getGeo('seaweed', seaweedGeo), mat('weed' + 0x55702e, { color: 0x55702e, roughness: 0.4, side: THREE.DoubleSide }));
  weed.scale.setScalar(0.7);
  weed.position.y = 0.55;
  g.add(weed);
  const crabs = [];
  const shells = [0xffe6cc, 0xffc9a8, 0xf3d9ff];
  for (let k = 0; k < 3; k++) {
    const c = makeCrab(shells[k]);
    const a = (k / 3) * Math.PI * 2 + 0.4;
    c.position.set(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55);
    c.rotation.y = -a + Math.PI;
    c.scale.setScalar(1.3 + k * 0.15);
    g.add(c);
    crabs.push(c);
  }
  g.userData.crabs = crabs;
  return g;
}

// ---------- the target pool marker (level 3) ----------
export function makeMarker(radius) {
  const g = new THREE.Group();
  const n = 16;
  const rand = mulberry32(9);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const d = makeDecor(k % 4 === 0 ? 'scallop' : 'pebble', rand);
    d.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    d.rotation.y = -a;
    d.userData.ox = Math.cos(a) * radius;
    d.userData.oz = Math.sin(a) * radius;
    g.add(d);
  }
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.92, radius * 1.08, 48),
    new THREE.MeshBasicMaterial({ color: 0x9ff3ff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  g.add(ring);
  g.userData.ring = ring;
  return g;
}
