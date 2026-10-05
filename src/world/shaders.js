// GLSL snippets shared by the sand, sim-water and ocean materials.

export const NOISE_GLSL = /* glsl */ `
float sHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float sNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), u.x),
             mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float sFbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * sNoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}
// Tileable-looking water caustics (after Dave Hoskins / joltz0r).
float causticPattern(vec2 p, float t) {
  vec2 q = mod(p * 6.2831853, 6.2831853) - 250.0;
  vec2 i = q;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = q + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(q.x / (sin(i.x + tt) / inten), q.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
`;

// Shared water surface shading. Expects the uniforms declared in WATER_PARS.
export const WATER_PARS = /* glsl */ `
uniform samplerCube uEnv;
uniform sampler2D uNormalTex;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uFogDensity;
uniform float uGridHalf;

vec3 rippleNormal(vec2 p, float strength) {
  vec3 a = texture2D(uNormalTex, p * 0.075 + vec2(uTime * 0.011, uTime * 0.017)).xyz * 2.0 - 1.0;
  vec3 b = texture2D(uNormalTex, p * 0.19 + vec2(-uTime * 0.019, uTime * 0.008)).xyz * 2.0 - 1.0;
  vec3 c = texture2D(uNormalTex, p * 0.43 + vec2(uTime * 0.03, -uTime * 0.021)).xyz * 2.0 - 1.0;
  vec2 d = a.xy * 0.55 + b.xy * 0.35 + c.xy * 0.1;
  return vec3(d.x, 0.0, d.y) * strength;
}

float foamTex(vec2 p) {
  float f = sFbm(p * 1.6 + vec2(uTime * 0.12, -uTime * 0.07));
  float g = sNoise(p * 5.0 - vec2(uTime * 0.3, uTime * 0.1));
  return smoothstep(0.42, 0.75, f * 0.8 + g * 0.35);
}

// depth: water column thickness under this pixel; foam: 0..1 extra foam.
vec4 shadeWater(vec3 P, vec3 geoN, float depth, float foam, float rough) {
  vec3 V = normalize(cameraPosition - P);
  float dist = length(cameraPosition - P);
  float detail = rough * mix(1.0, 0.35, smoothstep(30.0, 300.0, dist));
  vec3 N = normalize(geoN + rippleNormal(P.xz, detail));
  float NdV = max(dot(N, V), 0.0);
  float fres = min(0.02 + 0.98 * pow(1.0 - NdV, 5.0), 0.62);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y) + 0.02;
  vec3 refl = min(textureLod(uEnv, normalize(R), 2.5).rgb, vec3(2.5)) * vec3(0.55, 0.68, 0.8);

  vec3 H = normalize(uSunDir + V);
  float NdH = max(dot(N, H), 0.0);
  float spec = pow(NdH, 1400.0) * 5.0 + pow(NdH, 220.0) * 0.18;
  spec *= smoothstep(-0.02, 0.08, uSunDir.y);

  float shallowness = exp(-depth * 0.28);
  vec3 body = mix(uDeep, uShallow, shallowness) * uAmbient * 1.25;
  // light leaking through wave crests toward the sun
  float sss = pow(max(dot(V, -uSunDir), 0.0), 3.0) * smoothstep(0.0, 0.6, geoN.y) * 0.35;
  body += uShallow * uSunColor * sss * (1.0 - shallowness * 0.5);

  vec3 col = mix(body, refl, fres) + uSunColor * spec;
  float clarity = 1.0 - exp(-depth * 0.3);
  float alpha = clamp(clarity * 0.7 + fres * 0.6 + spec, 0.0, 1.0);

  float shoreFoam = smoothstep(0.16, 0.02, depth) * smoothstep(0.0, 0.02, depth);
  float f = clamp(shoreFoam * 1.25 + foam, 0.0, 1.4) * foamTex(P.xz);
  f = clamp(f, 0.0, 1.0);
  vec3 foamCol = (uSunColor * max(uSunDir.y, 0.15) * 0.75 + uAmbient * 0.9) * 0.95;
  col = mix(col, foamCol, f);
  alpha = max(alpha, f * 0.95);

  vec3 fd = P - cameraPosition;
  vec3 fogC = textureLod(uEnv, normalize(vec3(fd.x, length(fd.xz) * 0.05, fd.z)), 3.0).rgb;
  fogC /= max(1.0, max(fogC.r, max(fogC.g, fogC.b)) / 0.9);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, fogC, fogF);
  alpha = mix(alpha, 1.0, fogF);
  return vec4(col, alpha);
}
`;
