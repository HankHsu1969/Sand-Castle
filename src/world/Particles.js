import * as THREE from 'three';

// CPU particle pool rendered as point sprites. shape 0 = soft grain, 1 = star.
export class Particles {
  constructor(scene, { max = 2000, additive = false, shape = 0 } = {}) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.floor = new Float32Array(max).fill(-1e9);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', this.colAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uShape: { value: shape } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float uScale;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = aColor; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uShape;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float a;
          if (uShape < 0.5) {
            a = smoothstep(1.0, 0.35, length(p));
          } else {
            float r = length(p);
            float star = max(0.0, 1.0 - abs(p.x) * 6.0) * max(0.0, 1.0 - abs(p.y) * 1.1)
                       + max(0.0, 1.0 - abs(p.y) * 6.0) * max(0.0, 1.0 - abs(p.x) * 1.1);
            a = clamp(star + smoothstep(0.5, 0.0, r) * 0.8, 0.0, 1.0);
          }
          if (a * vAlpha < 0.01) discard;
          gl_FragColor = vec4(vColor, a * vAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, { life = 1, size = 0.1, color = new THREE.Color(1, 1, 1), gravity = -9, floor = -1e9 } = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = gravity;
    this.floor[i] = floor;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k + 1] += this.grav[i] * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < this.floor[i]) {
        this.pos[k + 1] = this.floor[i];
        this.vel[k] *= 0.3; this.vel[k + 1] = 0; this.vel[k + 2] *= 0.3;
      }
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.min(1, t * 3) * Math.min(1, (1 - t) * 12 + 0.2);
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  setScale(viewportHeight, fov) {
    this.points.material.uniforms.uScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  }
}
