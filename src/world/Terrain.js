import * as THREE from 'three';
import { N, S, W, HALF, M, EDGE_LOCK, FLOOR } from '../core/config.js';
import { NOISE_GLSL } from './shaders.js';
import { injectFog } from './fog.js';

// Uniforms shared by every mesh that uses the sand material (play area,
// surrounding terrain, islands) so lighting and tide stay consistent.
export const sandUniforms = {
  uSandMap: { value: null },
  uSandNormal: { value: null },
  uSim: { value: null },
  uGridHalf: { value: HALF },
  uSimScale: { value: 1 / (2 * M * S) },
  uSimOffset: { value: 0.25 / M },
  uTime: { value: 0 },
  uSeaLevel: { value: 0 },
  uWetLine: { value: 0.5 },
  uAbsorb: { value: new THREE.Vector3(0.3, 0.075, 0.055) },
  uScatter: { value: new THREE.Color(0x0c3a40) },
  uCaustic: { value: new THREE.Color(1, 1, 1) },
  uSunDirW: { value: new THREE.Vector3(0, 1, 0) },
};

export function createSandMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0,
    vertexColors: true,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sandUniforms);
    injectFog(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNrm = normalize(mat3(modelMatrix) * objectNormal);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uSandMap;
        uniform sampler2D uSandNormal;
        uniform sampler2D uSim;
        uniform float uGridHalf;
        uniform float uSimScale;
        uniform float uSimOffset;
        uniform float uTime;
        uniform float uSeaLevel;
        uniform float uWetLine;
        uniform vec3 uAbsorb;
        uniform vec3 uScatter;
        uniform vec3 uCaustic;
        uniform vec3 uSunDirW;
        varying vec3 vWPos;
        varying vec3 vWNrm;
        ${NOISE_GLSL}
        float gWet; float gDepth; vec3 gBw;`
      )
      .replace(
        '#include <map_fragment>',
        `
        gBw = pow(abs(vWNrm), vec3(4.0));
        gBw /= (gBw.x + gBw.y + gBw.z + 1e-4);
        const float TS = 0.42;
        vec3 sx = texture2D(uSandMap, vWPos.zy * TS).rgb;
        vec3 sy = texture2D(uSandMap, vWPos.xz * TS).rgb;
        vec3 sz = texture2D(uSandMap, vWPos.xy * TS).rgb;
        vec3 sandCol = sx * gBw.x + sy * gBw.y + sz * gBw.z;
        float big = sNoise(vWPos.xz * 0.09) * 0.6 + sNoise(vWPos.xz * 0.31 + 7.0) * 0.4;
        sandCol *= mix(0.88, 1.08, big);
        // simulation data inside the play area, analytic tide outside
        float edge = max(abs(vWPos.x), abs(vWPos.z));
        float inGrid = 1.0 - smoothstep(uGridHalf - 1.2, uGridHalf - 0.15, edge);
        vec2 simUv = (vWPos.xz + uGridHalf) * uSimScale + uSimOffset;
        vec4 sim = texture2D(uSim, simUv);
        float simDepth = max(0.0, sim.r - vWPos.y);
        float outerDepth = max(0.0, uSeaLevel - vWPos.y);
        float outerWet = 1.0 - smoothstep(uSeaLevel + 0.05, uSeaLevel + uWetLine, vWPos.y);
        gDepth = mix(outerDepth, simDepth, inGrid);
        gWet = clamp(mix(outerWet, sim.g, inGrid), 0.0, 1.0);
        gWet = max(gWet, smoothstep(0.0, 0.02, gDepth));
        vec3 wetCol = sandCol * vec3(0.6, 0.52, 0.43);
        vec3 sc = mix(sandCol, wetCol, gWet);
        // submerged sand reads pale and cool, so the water above looks turquoise
        float under = smoothstep(0.03, 0.5, gDepth);
        vec3 seaFloor = mix(vec3(dot(sandCol, vec3(0.3, 0.5, 0.2))), sandCol, 0.4) * vec3(0.9, 0.97, 1.04);
        diffuseColor.rgb *= mix(sc, seaFloor, under);
        `
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.96, 0.38, gWet * (1.0 - smoothstep(0.0, 0.03, gDepth)));`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 d1 = texture2D(uSandNormal, vWPos.xz * 0.85).xyz * 2.0 - 1.0;
          vec3 d2 = texture2D(uSandNormal, vWPos.xz * 0.21 + 0.37).xyz * 2.0 - 1.0;
          float str = 0.4 * gBw.y * (1.0 - 0.55 * gWet);
          vec3 wn = normalize(vWNrm + vec3(d1.x + d2.x * 0.7, 0.0, d1.y + d2.y * 0.7) * str);
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float under = smoothstep(0.0, 0.06, gDepth) * exp(-gDepth * 0.5);
          float c = causticPattern(vWPos.xz * 0.11, uTime * 0.5);
          c += 0.4 * causticPattern(vWPos.xz * 0.19 + 3.1, uTime * 0.35);
          totalEmissiveRadiance += uCaustic * min(c, 1.5) * under * (0.25 + 0.75 * gBw.y) * 0.13 * diffuseColor.rgb;
          // a few sparkling sand grains on dry sand
          float g = sHash(floor(vWPos.xz * 55.0));
          vec3 vdir = normalize(cameraPosition - vWPos);
          float glint = step(0.993, g) * pow(max(dot(reflect(-uSunDirW, vWNrm), vdir), 0.0), 18.0);
          totalEmissiveRadiance += uCaustic * glint * (1.0 - gWet) * 1.4;
        }`
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 trans = exp(-uAbsorb * gDepth * 1.3);
          outgoingLight = outgoingLight * trans + uScatter * (1.0 - trans);
        }
        #include <opaque_fragment>`
      );
  };
  mat.customProgramCacheKey = () => 'sand-v1';
  return mat;
}

export class Terrain {
  constructor(material) {
    const n = N * N;
    this.h = new Float32Array(n);
    this.h0 = new Float32Array(n);
    this.mask = new Float32Array(n); // 0 = locked edge, 1 = freely editable
    this.ao = new Float32Array(n).fill(1);

    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3).fill(1);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = (j * N + i) * 3;
        this.pos[k] = -HALF + i * S;
        this.pos[k + 2] = -HALF + j * S;
        this.nrm[k + 1] = 1;
      }
    }
    const idx = new Uint32Array((N - 1) * (N - 1) * 6);
    let p = 0;
    for (let j = 0; j < N - 1; j++) {
      for (let i = 0; i < N - 1; i++) {
        const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
        if ((i + j) & 1) { idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d; }
        else { idx[p++] = a; idx[p++] = c; idx[p++] = d; idx[p++] = a; idx[p++] = d; idx[p++] = b; }
      }
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr = new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('normal', this.nrmAttr);
    geo.setAttribute('color', this.colAttr);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), W);
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(-HALF, FLOOR, -HALF), new THREE.Vector3(HALF, 30, HALF));

    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';

    this.skirt = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.skirt.receiveShadow = true;

    this.heightData = new Uint16Array(n);
    this.heightTex = new THREE.DataTexture(this.heightData, N, N, THREE.RedFormat, THREE.HalfFloatType);
    this.heightTex.magFilter = this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.wrapS = this.heightTex.wrapT = THREE.ClampToEdgeWrapping;

    this.dirty = null;
    this.version = 0;
  }

  load(heightFn) {
    for (let j = 0; j < N; j++) {
      const z = -HALF + j * S;
      for (let i = 0; i < N; i++) {
        const x = -HALF + i * S;
        const v = heightFn(x, z);
        this.h[j * N + i] = v;
        this.h0[j * N + i] = v;
        const e = Math.min(i, j, N - 1 - i, N - 1 - j);
        const t = Math.min(1, Math.max(0, (e - EDGE_LOCK) / 10));
        this.mask[j * N + i] = t * t * (3 - 2 * t);
      }
    }
    this.markDirty(0, 0, N - 1, N - 1);
    this.flush();
    this.buildSkirt();
  }

  buildSkirt() {
    const verts = [];
    const push = (i, j) => {
      const x = -HALF + i * S, z = -HALF + j * S;
      verts.push([x, this.h[j * N + i], z]);
    };
    const edges = [];
    for (let i = 0; i < N; i++) edges.push([i, 0]);
    for (let j = 1; j < N; j++) edges.push([N - 1, j]);
    for (let i = N - 2; i >= 0; i--) edges.push([i, N - 1]);
    for (let j = N - 2; j >= 0; j--) edges.push([0, j]);
    edges.forEach(([i, j]) => push(i, j));
    const pos = new Float32Array(verts.length * 2 * 3);
    const nrm = new Float32Array(verts.length * 2 * 3);
    const col = new Float32Array(verts.length * 2 * 3).fill(0.85);
    verts.forEach((v, k) => {
      pos.set(v, k * 6);
      pos.set([v[0], FLOOR - 4, v[2]], k * 6 + 3);
      const ox = Math.abs(v[0]) > HALF - 1e-4 ? Math.sign(v[0]) : 0;
      const oz = Math.abs(v[2]) > HALF - 1e-4 ? Math.sign(v[2]) : 0;
      nrm.set([ox, 0.3, oz], k * 6);
      nrm.set([ox, 0.3, oz], k * 6 + 3);
    });
    const idx = [];
    for (let k = 0; k < verts.length - 1; k++) {
      const a = k * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, c, b, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    this.skirt.geometry.dispose();
    this.skirt.geometry = g;
  }

  index(i, j) { return j * N + i; }

  heightAt(x, z) {
    let fi = (x + HALF) / S, fj = (z + HALF) / S;
    fi = Math.min(Math.max(fi, 0), N - 1.001);
    fj = Math.min(Math.max(fj, 0), N - 1.001);
    const i = fi | 0, j = fj | 0;
    const tx = fi - i, tz = fj - j;
    const a = this.h[j * N + i], b = this.h[j * N + i + 1];
    const c = this.h[(j + 1) * N + i], d = this.h[(j + 1) * N + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  originalAt(x, z) {
    const i = Math.round((x + HALF) / S), j = Math.round((z + HALF) / S);
    if (i < 0 || j < 0 || i >= N || j >= N) return 0;
    return this.h0[j * N + i];
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = S;
    const hx = this.heightAt(x - e, z) - this.heightAt(x + e, z);
    const hz = this.heightAt(x, z - e) - this.heightAt(x, z + e);
    return out.set(hx, 2 * e, hz).normalize();
  }

  inside(x, z, margin = 0) {
    return Math.abs(x) <= HALF - margin && Math.abs(z) <= HALF - margin;
  }

  markDirty(i0, j0, i1, j1) {
    i0 = Math.max(0, i0); j0 = Math.max(0, j0);
    i1 = Math.min(N - 1, i1); j1 = Math.min(N - 1, j1);
    if (!this.dirty) this.dirty = [i0, j0, i1, j1];
    else {
      const d = this.dirty;
      d[0] = Math.min(d[0], i0); d[1] = Math.min(d[1], j0);
      d[2] = Math.max(d[2], i1); d[3] = Math.max(d[3], j1);
    }
  }

  // Recompute normals/AO for the dirty region and upload it. Returns the
  // region so the water simulation can resync its ground copy.
  flush() {
    if (!this.dirty) return null;
    const [i0, j0, i1, j1] = this.dirty;
    this.dirty = null;
    const h = this.h, pos = this.pos, nrm = this.nrm, col = this.col;
    const R = 6; // AO reaches this far, so normals/AO must be refreshed around edits
    const a0 = Math.max(0, i0 - R), b0 = Math.max(0, j0 - R);
    const a1 = Math.min(N - 1, i1 + R), b1 = Math.min(N - 1, j1 + R);
    for (let j = b0; j <= b1; j++) {
      for (let i = a0; i <= a1; i++) {
        const k = j * N + i;
        const hc = h[k];
        pos[k * 3 + 1] = hc;
        const l = i > 0 ? 1 : 0, r = i < N - 1 ? 1 : 0, d = j > 0 ? N : 0, u = j < N - 1 ? N : 0;
        const gx = (h[k + r - d] + 2 * h[k + r] + h[k + r + u]) - (h[k - l - d] + 2 * h[k - l] + h[k - l + u]);
        const gz = (h[k - l + u] + 2 * h[k + u] + h[k + r + u]) - (h[k - l - d] + 2 * h[k - d] + h[k + r - d]);
        let nx = -gx, ny = 8 * S, nz = -gz;
        const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nrm[k * 3] = nx * inv; nrm[k * 3 + 1] = ny * inv; nrm[k * 3 + 2] = nz * inv;
        // cheap horizon-based occlusion from 8 directions at two radii
        let occ = 0;
        for (let r = 2; r <= 6; r += 4) {
          const dist = r * S;
          const il = Math.max(0, i - r), ir = Math.min(N - 1, i + r);
          const jd = Math.max(0, j - r), ju = Math.min(N - 1, j + r);
          const s = [h[j * N + il], h[j * N + ir], h[jd * N + i], h[ju * N + i],
            h[jd * N + il], h[jd * N + ir], h[ju * N + il], h[ju * N + ir]];
          for (let q = 0; q < 8; q++) {
            const dd = q < 4 ? dist : dist * 1.414;
            const v = (s[q] - hc) / dd;
            if (v > 0) occ += v > 1.6 ? 1.6 : v;
          }
        }
        const ao = Math.max(0.42, 1 - occ * 0.045);
        col[k * 3] = ao; col[k * 3 + 1] = ao; col[k * 3 + 2] = ao;
      }
    }
    const toHalf = THREE.DataUtils.toHalfFloat;
    for (let j = b0; j <= b1; j++) for (let i = a0; i <= a1; i++) this.heightData[j * N + i] = toHalf(h[j * N + i]);
    this.heightTex.needsUpdate = true;
    const start = b0 * N * 3, count = (b1 - b0 + 1) * N * 3;
    for (const attr of [this.posAttr, this.nrmAttr, this.colAttr]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(start, count);
      attr.needsUpdate = true;
    }
    this.version++;
    return [a0, b0, a1, b1];
  }

  // Heightfield ray march; returns the hit point or null.
  raycast(ray, maxDist = 400) {
    const o = ray.origin, d = ray.direction;
    // clip against the play-area box
    let tmin = 0, tmax = maxDist;
    for (const [oc, dc] of [[o.x, d.x], [o.z, d.z]]) {
      if (Math.abs(dc) < 1e-9) {
        if (oc < -HALF || oc > HALF) return null;
      } else {
        let t1 = (-HALF - oc) / dc, t2 = (HALF - oc) / dc;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
      }
    }
    if (tmin > tmax) return null;
    const step = S * 0.5;
    let prev = tmin;
    for (let t = tmin; t <= tmax; t += step) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y <= this.heightAt(x, z)) {
        let lo = prev, hi = t;
        for (let k = 0; k < 10; k++) {
          const m = (lo + hi) / 2;
          const mx = o.x + d.x * m, my = o.y + d.y * m, mz = o.z + d.z * m;
          if (my <= this.heightAt(mx, mz)) hi = m; else lo = m;
        }
        return new THREE.Vector3(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi);
      }
      prev = t;
    }
    return null;
  }
}
