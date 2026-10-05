import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Miniature-photo look: tilt-shift blur toward the top/bottom of the frame,
// gentle colour grade and a soft vignette.
const TiltGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTilt: { value: 1 },
    uFocus: { value: 0.52 },
    uWarm: { value: 0.03 },
    uSat: { value: 1.16 },
    uContrast: { value: 1.07 },
    uVignette: { value: 0.32 },
    uFade: { value: 0 },
    uFadeColor: { value: new THREE.Color(1, 0.97, 0.9) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTilt, uFocus, uWarm, uSat, uVignette, uFade, uContrast;
    uniform vec3 uFadeColor;
    varying vec2 vUv;
    void main() {
      float dist = abs(vUv.y - uFocus);
      float blur = uTilt * smoothstep(0.18, 0.62, dist) * 3.2;
      vec4 col = texture2D(tDiffuse, vUv);
      if (blur > 0.05) {
        vec2 px = blur / uResolution;
        vec4 acc = col * 0.2;
        const float GOLDEN = 2.39996;
        for (int i = 1; i < 12; i++) {
          float r = sqrt(float(i) / 12.0);
          float a = float(i) * GOLDEN;
          acc += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * px * r * 2.2) * (1.0 - r * 0.4);
        }
        float wsum = 0.2;
        for (int i = 1; i < 12; i++) { float r = sqrt(float(i) / 12.0); wsum += 1.0 - r * 0.4; }
        col = acc / wsum;
      }
      vec3 c = col.rgb;
      c = pow(max(c, vec3(0.0)) / 0.18, vec3(uContrast)) * 0.18;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      c *= vec3(1.0 + uWarm, 1.0, 1.0 - uWarm);
      vec2 q = vUv - 0.5;
      float vig = 1.0 - uVignette * smoothstep(0.25, 0.85, length(q * vec2(1.15, 1.0)));
      c *= vig;
      c = mix(c, uFadeColor, uFade);
      gl_FragColor = vec4(c, col.a);
    }`,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    // clamp extreme HDR values (sun disc, specular) so bloom stays a soft glow
    this.clamp = new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = vec4(min(c.rgb, vec3(24.0)), c.a); }',
    });
    this.composer.addPass(this.clamp);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.28, 0.35, 1.6);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(TiltGradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.enabled = true;
  }

  setQuality(q) {
    this.bloom.enabled = q !== 'low';
    this.grade.uniforms.uTilt.value = q === 'low' ? 0 : this.tiltOn ? 1 : 0;
  }

  // bloom only what would still be bright after tone mapping
  setExposure(exposure) {
    this.bloom.threshold = 2.6 / Math.max(0.1, exposure);
  }

  setTilt(on) {
    this.tiltOn = on;
    this.grade.uniforms.uTilt.value = on ? 1 : 0;
  }

  setSize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.grade.uniforms.uResolution.value.set(w * pr, h * pr);
  }

  render(dt) {
    this.composer.render(dt);
  }
}
