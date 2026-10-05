import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { HALF } from '../core/config.js';
import { NOISE_GLSL, WATER_PARS } from './shaders.js';
import { sandUniforms } from './Terrain.js';
import { fogUniforms } from './fog.js';
import { waveParams } from './WaterSim.js';

const OUTER = 420;      // extent of the surrounding terrain mesh
const DEPTH_RES = 512;  // seabed lookup for the ocean shader

function axisCoords(limit, fine, grow, innerN) {
  const out = [];
  let x = HALF, s = fine;
  while (x < limit) { out.push(x); x += s; s *= grow; }
  out.push(limit);
  // inside the play area the mesh is hidden (terrain) or discarded (ocean)
  const inner = [];
  for (let i = 0; i <= innerN; i++) inner.push(-HALF + 0.6 + (i * (2 * HALF - 1.2)) / innerN);
  return [...out.map((v) => -v).reverse(), ...inner, ...out];
}

export class Environment {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;

    this.sky = new Sky();
    this.sky.scale.setScalar(9000);
    // brightness scale so every level's sky sits at a similar exposure
    this.sky.material.uniforms.uSkyScale = { value: 1 };
    this.sky.material.fragmentShader = this.sky.material.fragmentShader
      .replace('uniform float time;', 'uniform float time; uniform float uSkyScale;')
      .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * uSkyScale, 1.0 );');
    scene.add(this.sky);
    this.halfBuf = new Uint16Array(16 * 16 * 4);
    this.skyScene = new THREE.Scene();

    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -27; sc.right = 27; sc.top = 27; sc.bottom = -27; sc.near = 1; sc.far = 220;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 2.5;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfe0ff, 0xd8b88a, 1);
    scene.add(this.hemi);

    this.cubeRT = new THREE.WebGLCubeRenderTarget(256, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    this.cubeCam = new THREE.CubeCamera(1, 20000, this.cubeRT);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;

    const loader = new THREE.TextureLoader();
    const normalTex = loader.load('assets/img/water_normal.png');
    normalTex.wrapS = normalTex.wrapT = THREE.RepeatWrapping;
    normalTex.anisotropy = 8;

    this.waterUniforms = {
      uEnv: { value: this.cubeRT.texture },
      uNormalTex: { value: normalTex },
      uTime: { value: 0 },
      uSunDir: { value: this.sunDir },
      uSunColor: { value: new THREE.Color() },
      uAmbient: { value: new THREE.Color() },
      uDeep: { value: new THREE.Color() },
      uShallow: { value: new THREE.Color() },
      uFogDensity: { value: 0.002 },
      uGridHalf: { value: HALF },
    };
    fogUniforms.uFogEnv.value = this.cubeRT.texture;

    this.depthData = new Uint16Array(DEPTH_RES * DEPTH_RES);
    this.depthTex = new THREE.DataTexture(this.depthData, DEPTH_RES, DEPTH_RES, THREE.RedFormat, THREE.HalfFloatType);
    this.depthTex.magFilter = this.depthTex.minFilter = THREE.LinearFilter;

    this.buildOcean();
    this.outer = null;
  }

  // shared water uniforms for the simulated water mesh
  attachWater(material) {
    Object.assign(material.uniforms, this.waterUniforms);
  }

  buildOcean() {
    const xs = axisCoords(4200, 0.6, 1.075, 32);
    const geo = this.gridGeometry(xs, xs, () => 0);
    this.oceanUniforms = {
      ...this.waterUniforms,
      uSea: { value: 0 },
      uWaveTime: { value: 0 },
      uWaveAmp: { value: 0.06 },
      uWaveOmega: { value: 1 },
      uWaveK: { value: 0.42 },
      uDepthTex: { value: this.depthTex },
      uDepthRange: { value: OUTER },
      uReef: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.oceanUniforms,
      transparent: true,
      vertexShader: /* glsl */ `
        uniform float uSea, uWaveTime, uWaveAmp, uWaveOmega, uWaveK, uGridHalf;
        varying vec3 vWPos;
        varying vec3 vNrm;
        float waveH(vec2 p) {
          float t = uWaveTime;
          float ph = uWaveOmega * t - uWaveK * p.y + 0.035 * p.x;
          float crest = exp(2.2 * (cos(ph) - 1.0));
          float set = 0.72 + 0.28 * sin(uWaveOmega * 0.19 * t + 0.6);
          float h = uWaveAmp * (set * (crest * 2.2 - 0.62) + 0.22 * sin(uWaveOmega * 1.37 * t - uWaveK * 1.6 * p.y - 0.08 * p.x + 1.7));
          float d = max(abs(p.x), abs(p.y));
          float m = smoothstep(uGridHalf + 3.0, uGridHalf + 70.0, d);
          h += m * (0.16 * sin(dot(p, vec2(0.05, 0.13)) - t * 0.8)
                  + 0.08 * sin(dot(p, vec2(-0.21, 0.17)) - t * 1.25 + 1.3)
                  + 0.05 * sin(dot(p, vec2(0.31, -0.07)) - t * 1.7 + 2.1));
          return h;
        }
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float h = waveH(wp.xz);
          float e = 0.6;
          float hx = waveH(wp.xz + vec2(e, 0.0));
          float hz = waveH(wp.xz + vec2(0.0, e));
          vNrm = normalize(vec3(h - hx, e, h - hz));
          wp.y = uSea + h;
          vWPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        ${WATER_PARS}
        uniform sampler2D uDepthTex;
        uniform float uDepthRange;
        uniform float uReef;
        varying vec3 vWPos;
        varying vec3 vNrm;
        void main() {
          if (abs(vWPos.x) < uGridHalf - 0.01 && abs(vWPos.z) < uGridHalf - 0.01) discard;
          vec2 duv = vWPos.xz / (2.0 * uDepthRange) + 0.5;
          float seabed = -40.0;
          if (duv.x > 0.0 && duv.x < 1.0 && duv.y > 0.0 && duv.y < 1.0) seabed = texture2D(uDepthTex, duv).r;
          float depth = max(vWPos.y - seabed, 0.0);
          float far = max(abs(vWPos.x), abs(vWPos.z));
          // waves breaking over shallow reefs and island shores
          float brk = smoothstep(1.2, 0.25, depth) * smoothstep(uGridHalf + 6.0, uGridHalf + 30.0, far);
          float foam = brk * (0.55 + 0.45 * sin(vWPos.z * 0.35 + vWPos.x * 0.05 - uTime * 1.4)) * (0.6 + uReef);
          vec4 c = shadeWater(vWPos, vNrm, depth, foam, 1.0);
          gl_FragColor = c;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.ocean = new THREE.Mesh(geo, mat);
    this.ocean.frustumCulled = false;
    this.ocean.renderOrder = 1;
    this.scene.add(this.ocean);
  }

  gridGeometry(xs, zs, hfn) {
    const nx = xs.length, nz = zs.length;
    const pos = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = (j * nx + i) * 3;
        pos[k] = xs[i];
        pos[k + 1] = hfn(xs[i], zs[j]);
        pos[k + 2] = zs[j];
      }
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let p = 0;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    return geo;
  }

  buildOuter(heightFn, sandMaterial, seed) {
    if (this.outer) {
      this.scene.remove(this.outer);
      this.outer.geometry.dispose();
    }
    const xs = axisCoords(OUTER, 0.6, 1.07, 62);
    const eps = 1e-3;
    const geo = this.gridGeometry(xs, xs, (x, z) => {
      const h = heightFn(x, z);
      return Math.abs(x) < HALF - eps && Math.abs(z) < HALF - eps ? h - 0.7 : h;
    });
    geo.computeVertexNormals();
    // tint: green vegetation inland, grey rock on steep slopes
    const pos = geo.attributes.position.array;
    const nrm = geo.attributes.normal.array;
    const col = new Float32Array(pos.length);
    for (let k = 0; k < pos.length; k += 3) {
      const x = pos[k], y = pos[k + 1], z = pos[k + 2];
      const ny = nrm[k + 1];
      let r = 1, g = 1, b = 1;
      const n = 0.5 + 0.5 * Math.sin(x * 0.07 + Math.sin(z * 0.05) * 2) * Math.cos(z * 0.06);
      const veg = THREE.MathUtils.smoothstep(y, 2.6, 4.2) * (0.6 + 0.4 * n);
      r = THREE.MathUtils.lerp(r, 0.36, veg); g = THREE.MathUtils.lerp(g, 0.62, veg); b = THREE.MathUtils.lerp(b, 0.26, veg);
      const rock = THREE.MathUtils.smoothstep(1 - ny, 0.3, 0.55);
      r = THREE.MathUtils.lerp(r, 0.62, rock); g = THREE.MathUtils.lerp(g, 0.6, rock); b = THREE.MathUtils.lerp(b, 0.62, rock);
      col[k] = r; col[k + 1] = g; col[k + 2] = b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.outer = new THREE.Mesh(geo, sandMaterial);
    this.outer.receiveShadow = true;
    this.outer.frustumCulled = false;
    this.scene.add(this.outer);

    // seabed lookup texture for the ocean shader
    const toHalf = THREE.DataUtils.toHalfFloat;
    for (let j = 0; j < DEPTH_RES; j++) {
      const z = ((j + 0.5) / DEPTH_RES) * 2 * OUTER - OUTER;
      for (let i = 0; i < DEPTH_RES; i++) {
        const x = ((i + 0.5) / DEPTH_RES) * 2 * OUTER - OUTER;
        this.depthData[j * DEPTH_RES + i] = toHalf(heightFn(x, z));
      }
    }
    this.depthTex.needsUpdate = true;
  }

  applyLevel(level) {
    const { sun, sky, hemi, sea, fog } = level;
    const phi = THREE.MathUtils.degToRad(90 - sun.elevation);
    const theta = THREE.MathUtils.degToRad(sun.azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);

    const u = this.sky.material.uniforms;
    u.turbidity.value = sky.turbidity;
    u.rayleigh.value = sky.rayleigh;
    u.mieCoefficient.value = sky.mie;
    u.mieDirectionalG.value = sky.mieG;
    u.sunPosition.value.copy(this.sunDir).multiplyScalar(450000);
    u.cloudCoverage.value = sky.clouds;
    u.cloudDensity.value = 0.45;
    u.cloudElevation.value = 0.55;
    u.cloudScale.value = 0.00018;
    u.cloudSpeed.value = 0.00004;

    this.sun.color.set(sun.color);
    this.sun.intensity = sun.intensity;
    this.sun.position.copy(this.sunDir).multiplyScalar(90);
    this.hemi.color.set(hemi.sky);
    this.hemi.groundColor.set(hemi.ground);
    this.hemi.intensity = hemi.intensity * 0.72;
    this.renderer.toneMappingExposure = sky.exposure;
    // horizon luminance that tone-maps to a soft, saturated sky
    this.targetSkyLum = (sky.skyLum ?? 1.7) * (0.44 / sky.exposure);

    const wu = this.waterUniforms;
    wu.uSunColor.value.set(sun.color).multiplyScalar(sun.intensity * 0.55);
    const amb = new THREE.Color(hemi.sky).multiplyScalar(hemi.intensity * 0.55);
    amb.add(new THREE.Color(sun.color).multiplyScalar(sun.intensity * Math.max(this.sunDir.y, 0.05) * 0.35));
    wu.uAmbient.value.copy(amb);
    wu.uDeep.value.set(sea.deep);
    wu.uShallow.value.set(sea.shallow);
    wu.uFogDensity.value = fog.density;
    fogUniforms.uFogDensity2.value = fog.density;

    sandUniforms.uSunDirW.value.copy(this.sunDir);
    sandUniforms.uCaustic.value.set(sun.color).multiplyScalar(sun.intensity * 0.9);
    const sc = new THREE.Color(sea.scatter).lerp(new THREE.Color(0x2a9fd6), 0.35).multiplyScalar(0.16);
    sc.multiply(amb);
    sandUniforms.uScatter.value.copy(sc);

    this.oceanUniforms.uReef.value = level.id === 2 ? 0.6 : 0;
    this.renderSkyEnv();
  }

  renderSkyEnv() {
    const u = this.sky.material.uniforms;
    // Environment cube (reflections + fog) without the blinding sun disc
    this.scene.remove(this.sky);
    this.skyScene.add(this.sky);
    u.showSunDisc.value = 0;
    const mie = u.mieCoefficient.value;
    u.mieCoefficient.value = mie * 0.18;
    this.cubeCam.position.set(0, 2, 0);
    // measure the horizon brightness at scale 1, then normalise it
    u.uSkyScale.value = 1;
    this.cubeCam.update(this.renderer, this.skyScene);
    const lum = this.measureHorizon();
    u.uSkyScale.value = THREE.MathUtils.clamp(this.targetSkyLum / Math.max(lum, 1e-3), 0.05, 4);
    this.cubeCam.update(this.renderer, this.skyScene);
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this.skyScene, 0, 1, 20000);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.35;
    u.showSunDisc.value = 1;
    u.mieCoefficient.value = mie;
    this.skyScene.remove(this.sky);
    this.scene.add(this.sky);
  }

  measureHorizon() {
    const fromHalf = THREE.DataUtils.fromHalfFloat;
    const buf = this.halfBuf;
    let sum = 0, n = 0;
    for (const face of [0, 1, 4, 5]) {
      this.renderer.readRenderTargetPixels(this.cubeRT, 120, 112, 16, 16, buf, face);
      for (let i = 0; i < 256; i++) {
        const v = 0.2126 * fromHalf(buf[i * 4]) + 0.7152 * fromHalf(buf[i * 4 + 1]) + 0.0722 * fromHalf(buf[i * 4 + 2]);
        if (Number.isFinite(v)) { sum += v; n++; }
      }
    }
    return n ? sum / n : 1;
  }

  update(dt, time, sim, camera) {
    this.waterUniforms.uTime.value = time;
    this.sky.material.uniforms.time.value = time;
    const ou = this.oceanUniforms;
    ou.uSea.value = sim.tide;
    ou.uWaveTime.value = sim.time;
    ou.uWaveAmp.value = waveParams.amp * waveParams.surge;
    ou.uWaveOmega.value = waveParams.omega;
    ou.uWaveK.value = waveParams.k;
    sandUniforms.uTime.value = time;
    sandUniforms.uSeaLevel.value = sim.tide;
    // keep the sky centred on the camera
    this.sky.position.copy(camera.position);
  }
}
