import * as THREE from 'three';
import { N, S, HALF, M, L } from '../core/config.js';
import { NOISE_GLSL, WATER_PARS } from './shaders.js';

const G = 9.81;
const TO_HALF = THREE.DataUtils.toHalfFloat;

// Wave train shared by the simulation boundary and the ocean shader: narrow
// crests and broad troughs like real swell, arriving in gentle sets.
export const waveParams = { amp: 0.08, omega: (2 * Math.PI) / 7.5, k: 0.42, surge: 1 };
export function waveHeight(x, z, t) {
  const { amp, omega, k, surge } = waveParams;
  const ph = omega * t - k * z + 0.035 * x;
  const crest = Math.exp(2.2 * (Math.cos(ph) - 1));
  const set = 0.72 + 0.28 * Math.sin(omega * 0.19 * t + 0.6);
  return amp * surge * (set * (crest * 2.2 - 0.62) + 0.22 * Math.sin(omega * 1.37 * t - k * 1.6 * z - 0.08 * x + 1.7));
}

// Shallow-water "virtual pipes" simulation (Mei et al. 2007) on an M×M grid
// whose cells each cover 2×2 terrain vertices.
export class WaterSim {
  constructor(terrain) {
    this.terrain = terrain;
    const n = M * M;
    this.b = new Float32Array(n);
    this.beach = new Float32Array(n); // ground without sculptures
    this.d = new Float32Array(n);
    this.fl = new Float32Array(n);
    this.fr = new Float32Array(n);
    this.fd = new Float32Array(n);
    this.fu = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.spd = new Float32Array(n);
    this.wet = new Float32Array(n);
    this.foam = new Float32Array(n);
    this.surf = new Float32Array(n);
    this.source = new Float32Array(n).fill(-999);
    this.border = new Uint8Array(n);
    this.cx = new Float32Array(n);
    this.cz = new Float32Array(n);
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < M; i++) {
        const c = j * M + i;
        this.border[c] = i === 0 || j === 0 || i === M - 1 || j === M - 1 ? 1 : 0;
        this.cx[c] = -HALF + (2 * i + 0.5) * S;
        this.cz[c] = -HALF + (2 * j + 0.5) * S;
      }
    }
    this.tide = 0;
    this.time = 0;
    this.acc = 0;
    this.enabled = true;

    this.simData = new Uint16Array(n * 4);
    this.simTex = new THREE.DataTexture(this.simData, M, M, THREE.RGBAFormat, THREE.HalfFloatType);
    this.groundData = new Uint16Array(n);
    this.groundTex = new THREE.DataTexture(this.groundData, M, M, THREE.RedFormat, THREE.HalfFloatType);
    for (const t of [this.simTex, this.groundTex]) {
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
    }

    this.buildMesh();
  }

  buildMesh() {
    const n = M * M;
    this.mPos = new Float32Array(n * 3);
    this.mNrm = new Float32Array(n * 3);
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < M; i++) {
        const c = j * M + i;
        this.mPos[c * 3] = i === 0 ? -HALF : i === M - 1 ? HALF : this.cx[c];
        this.mPos[c * 3 + 2] = j === 0 ? -HALF : j === M - 1 ? HALF : this.cz[c];
        this.mNrm[c * 3 + 1] = 1;
      }
    }
    const idx = new Uint32Array((M - 1) * (M - 1) * 6);
    let p = 0;
    for (let j = 0; j < M - 1; j++) {
      for (let i = 0; i < M - 1; i++) {
        const a = j * M + i, b = a + 1, c = a + M, d = c + 1;
        idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    this.mPosAttr = new THREE.BufferAttribute(this.mPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.mNrmAttr = new THREE.BufferAttribute(this.mNrm, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.mPosAttr);
    geo.setAttribute('normal', this.mNrmAttr);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), HALF * 2);

    this.uniforms = {
      uSim: { value: this.simTex },
      uGround: { value: this.groundTex },
      uSimScale: { value: 1 / (2 * M * S) },
      uSimOffset: { value: 0.25 / M },
      uTerrainTex: { value: this.terrain.heightTex },
      uTerrainScale: { value: 1 / (S * N) },
      uTerrainOffset: { value: 0.5 / N },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, // shared water uniforms are merged in by Environment
      transparent: true,
      depthWrite: true,
      vertexShader: /* glsl */ `
        varying vec3 vWPos;
        varying vec3 vNrm;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWPos = wp.xyz;
          vNrm = normal;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        ${WATER_PARS}
        uniform sampler2D uSim;
        uniform sampler2D uGround;
        uniform float uSimScale;
        uniform float uSimOffset;
        uniform sampler2D uTerrainTex;
        uniform float uTerrainScale;
        uniform float uTerrainOffset;
        varying vec3 vWPos;
        varying vec3 vNrm;
        void main() {
          vec2 uv = (vWPos.xz + uGridHalf) * uSimScale + uSimOffset;
          vec4 sim = texture2D(uSim, uv);
          float ground = texture2D(uTerrainTex, (vWPos.xz + uGridHalf) * uTerrainScale + uTerrainOffset).r;
          float depth = vWPos.y - ground;
          if (depth < 0.0) discard;
          float rough = 0.55 + 0.6 * clamp(sim.b, 0.0, 1.5);
          vec4 c = shadeWater(vWPos, normalize(vNrm), depth, sim.a, rough);
          c.a *= smoothstep(0.0, 0.025, depth);
          gl_FragColor = c;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'simWater';
  }

  // Copy terrain heights into the simulation ground (cells cover 2×2 vertices).
  syncGround(rect) {
    const h = this.terrain.h, s = this.terrain.solid;
    // sculptures are solid ground for the water as well
    const g = (a) => (h[a] > s[a] ? h[a] : s[a]);
    const ci0 = rect ? Math.max(0, rect[0] >> 1) : 0;
    const cj0 = rect ? Math.max(0, rect[1] >> 1) : 0;
    const ci1 = rect ? Math.min(M - 1, rect[2] >> 1) : M - 1;
    const cj1 = rect ? Math.min(M - 1, rect[3] >> 1) : M - 1;
    for (let j = cj0; j <= cj1; j++) {
      for (let i = ci0; i <= ci1; i++) {
        const a = 2 * j * N + 2 * i;
        const v = (g(a) + g(a + 1) + g(a + N) + g(a + N + 1)) * 0.25;
        const c = j * M + i;
        this.beach[c] = (h[a] + h[a + 1] + h[a + N] + h[a + N + 1]) * 0.25;
        this.b[c] = v;
        this.groundData[c] = TO_HALF(v);
      }
    }
    this.groundTex.needsUpdate = true;
  }

  reset(tide, sources = null) {
    this.tide = tide;
    this.syncGround(null);
    this.d.fill(0); this.fl.fill(0); this.fr.fill(0); this.fd.fill(0); this.fu.fill(0);
    this.vx.fill(0); this.vz.fill(0); this.spd.fill(0); this.foam.fill(0);
    this.source.fill(-999);
    if (sources) for (const [c, level] of sources) this.source[c] = level;
    for (let c = 0; c < M * M; c++) {
      this.d[c] = Math.max(0, tide - this.b[c]);
      this.wet[c] = this.d[c] > 0.005 ? 1 : 0;
    }
    // let the waves, swash and rivers settle before the first frame
    for (let k = 0; k < 360; k++) this.step(1 / 120);
    this.writeTextures();
    this.updateMesh();
  }

  boundaryLevel(c) {
    return this.tide + waveHeight(this.cx[c], this.cz[c], this.time);
  }

  step(dt) {
    this.time += dt;
    const { b, d, fl, fr, fd, fu } = this;
    const A = L * L;
    const gk = dt * G * L;
    // 1) update outflow fluxes
    for (let j = 0; j < M; j++) {
      const row = j * M;
      for (let i = 0; i < M; i++) {
        const c = row + i;
        const dc = d[c];
        const hc = b[c] + dc;
        const fric = 1 / (1 + dt * 0.12 / (dc + 0.015));
        let l = 0, r = 0, dn = 0, up = 0;
        if (i > 0) { l = fl[c] * fric + gk * (hc - b[c - 1] - d[c - 1]); if (l < 0) l = 0; }
        if (i < M - 1) { r = fr[c] * fric + gk * (hc - b[c + 1] - d[c + 1]); if (r < 0) r = 0; }
        if (j > 0) { dn = fd[c] * fric + gk * (hc - b[c - M] - d[c - M]); if (dn < 0) dn = 0; }
        if (j < M - 1) { up = fu[c] * fric + gk * (hc - b[c + M] - d[c + M]); if (up < 0) up = 0; }
        const out = (l + r + dn + up) * dt;
        const vol = dc * A;
        if (out > vol) {
          const k = out > 1e-9 ? vol / out : 0;
          l *= k; r *= k; dn *= k; up *= k;
        }
        fl[c] = l; fr[c] = r; fd[c] = dn; fu[c] = up;
      }
    }
    // 2) update depths and velocities
    const { vx, vz, spd, foam, wet, border, source } = this;
    const invA = 1 / A;
    const foamDecay = Math.exp(-dt * 0.55);
    for (let j = 0; j < M; j++) {
      const row = j * M;
      for (let i = 0; i < M; i++) {
        const c = row + i;
        const inL = i > 0 ? fr[c - 1] : 0;
        const inR = i < M - 1 ? fl[c + 1] : 0;
        const inD = j > 0 ? fu[c - M] : 0;
        const inU = j < M - 1 ? fd[c + M] : 0;
        const old = d[c];
        let nd = old + dt * (inL + inR + inD + inU - fl[c] - fr[c] - fd[c] - fu[c]) * invA;
        if (nd < 0) nd = 0;
        if (nd < 0.003) nd *= 1 - dt * 0.6;
        if (border[c]) nd = Math.max(0, this.boundaryLevel(c) - b[c]);
        if (source[c] > -900) nd = Math.max(nd, source[c] - b[c]);
        d[c] = nd;
        const avg = (old + nd) * 0.5;
        if (avg > 0.006) {
          const u = (inL - fl[c] + fr[c] - inR) * 0.5 / (L * avg);
          const v = (inD - fd[c] + fu[c] - inU) * 0.5 / (L * avg);
          vx[c] = u; vz[c] = v;
          let s = Math.sqrt(u * u + v * v);
          if (s > 4) s = 4;
          spd[c] = s;
        } else {
          vx[c] = 0; vz[c] = 0; spd[c] = 0;
        }
        // foam where the flow is fast, on thin swash, and at the advancing front
        let f = foam[c] * foamDecay;
        if (nd > 0.004) {
          const s = spd[c];
          const crest = b[c] + nd - this.tide;
          if (nd < 0.6 && crest > 0.035) f += dt * crest * 14;
          if (s > 0.45) f += dt * (s - 0.45) * 1.6;
          if (nd < 0.07) f += dt * s * 2.2;
          if (wet[c] < 0.6) f += 0.35;
          wet[c] = 1;
        } else {
          wet[c] = Math.max(0, wet[c] - dt * (1 / 70));
        }
        foam[c] = f > 1 ? 1 : f;
      }
    }
  }

  update(dt) {
    if (!this.enabled) return;
    // the water runs a little faster than real time so channels fill briskly
    this.acc += Math.min(dt, 0.05) * 1.4;
    const h = 1 / 120;
    let steps = 0;
    while (this.acc >= h && steps < 8) {
      this.step(h);
      this.acc -= h;
      steps++;
    }
    if (steps >= 8) this.acc = 0;
    this.writeTextures();
    this.updateMesh();
  }

  // Wetness can be painted directly (freshly piled sand is wet sand).
  wetAround(x, z, r) {
    const ci = Math.round((x + HALF) / (2 * S) - 0.25), cj = Math.round((z + HALF) / (2 * S) - 0.25);
    const rr = Math.ceil(r / L) + 1;
    for (let j = cj - rr; j <= cj + rr; j++) {
      for (let i = ci - rr; i <= ci + rr; i++) {
        if (i < 0 || j < 0 || i >= M || j >= M) continue;
        const c = j * M + i;
        const dx = this.cx[c] - x, dz = this.cz[c] - z;
        if (dx * dx + dz * dz < r * r) this.wet[c] = 1;
      }
    }
  }

  cellAt(x, z) {
    const i = Math.min(M - 1, Math.max(0, Math.round(((x + HALF) / S - 0.5) / 2)));
    const j = Math.min(M - 1, Math.max(0, Math.round(((z + HALF) / S - 0.5) / 2)));
    return j * M + i;
  }

  depthAt(x, z) { return this.d[this.cellAt(x, z)]; }

  writeTextures() {
    const { b, d, surf, simData, wet, spd, foam } = this;
    const n = M * M;
    for (let c = 0; c < n; c++) surf[c] = d[c] > 0.004 ? b[c] + d[c] : -999;
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < M; i++) {
        const c = j * M + i;
        let s = surf[c];
        let y = s;
        if (s < -900) {
          // extend the water level horizontally into dry neighbours so the
          // waterline is where the surface meets the sand
          let m = -999;
          if (i > 0 && surf[c - 1] > m) m = surf[c - 1];
          if (i < M - 1 && surf[c + 1] > m) m = surf[c + 1];
          if (j > 0 && surf[c - M] > m) m = surf[c - M];
          if (j < M - 1 && surf[c + M] > m) m = surf[c + M];
          // (below the beach, not a sculpture's top, so its sides don't read as underwater)
          s = m > -900 ? Math.min(m, b[c] + 0.004) : this.beach[c] - 0.3;
          // far from any water: tuck the vertex deep under the sand so edge
          // triangles slope downward instead of climbing castle walls
          y = m > -900 ? m : Math.min(b[c], this.tide) - 3;
        }
        const o = c * 4;
        simData[o] = TO_HALF(s);
        simData[o + 1] = TO_HALF(wet[c]);
        simData[o + 2] = TO_HALF(spd[c]);
        simData[o + 3] = TO_HALF(foam[c]);
        this.mPos[c * 3 + 1] = y;
      }
    }
    this.simTex.needsUpdate = true;
  }

  updateMesh() {
    const p = this.mPos, nr = this.mNrm;
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < M; i++) {
        const c = j * M + i;
        const yl = p[(c - (i > 0 ? 1 : 0)) * 3 + 1], yr = p[(c + (i < M - 1 ? 1 : 0)) * 3 + 1];
        const yd = p[(c - (j > 0 ? M : 0)) * 3 + 1], yu = p[(c + (j < M - 1 ? M : 0)) * 3 + 1];
        let nx = yl - yr, ny = 2 * L, nz = yd - yu;
        const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nr[c * 3] = nx * inv; nr[c * 3 + 1] = ny * inv; nr[c * 3 + 2] = nz * inv;
      }
    }
    this.mPosAttr.needsUpdate = true;
    this.mNrmAttr.needsUpdate = true;
  }
}
