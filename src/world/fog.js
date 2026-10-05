// Directional aerial-perspective fog: distant geometry fades into the colour
// of the sky behind it (sampled from the environment cube) instead of a flat
// fog colour, so the horizon blends seamlessly at sunrise and sunset.
export const fogUniforms = {
  uFogEnv: { value: null },
  uFogDensity2: { value: 0.002 },
};

export function injectFog(shader) {
  Object.assign(shader.uniforms, fogUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <fog_pars_vertex>', 'varying vec3 vFogWPos;')
    .replace(
      '#include <fog_vertex>',
      `#ifdef USE_INSTANCING
        vFogWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      #else
        vFogWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      #endif`
    );
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <fog_pars_fragment>', 'uniform samplerCube uFogEnv;\nuniform float uFogDensity2;\nvarying vec3 vFogWPos;')
    .replace(
      '#include <fog_fragment>',
      `{
        vec3 fd = vFogWPos - cameraPosition;
        float dist = length(fd);
        vec3 fc = textureLod(uFogEnv, normalize(vec3(fd.x, length(fd.xz) * 0.05, fd.z)), 3.0).rgb;
        fc /= max(1.0, max(fc.r, max(fc.g, fc.b)) / 0.9);
        float ff = 1.0 - exp(-uFogDensity2 * uFogDensity2 * dist * dist);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, ff);
      }`
    );
}

// Convenience: give a stock material the fog (and optionally extra hooks).
// `key` must be unique per distinct `extra` so three.js doesn't share programs.
export function withFog(material, key = 'fog', extra = null) {
  material.onBeforeCompile = (shader) => {
    injectFog(shader);
    if (extra) extra(shader);
  };
  material.customProgramCacheKey = () => key;
  return material;
}
