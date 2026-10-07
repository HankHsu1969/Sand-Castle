import MANIFEST from './sculpt-models.json';

// Preset sculptures: shapes made with Hunyuan3D from Higgsfield renders and
// baked (tools/bake_sculptures.py) into sand density grids — 0–255, x fastest,
// +Z the sculpture's front, +Y up, the base at y = 0. Once placed they are
// ordinary sculpture voxels that every tool can carve.

export const SCULPT_MODELS = MANIFEST;

const cache = new Map();

export function loadSculptModel(id) {
  if (cache.has(id)) return cache.get(id);
  const entry = MANIFEST.find((m) => m.id === id);
  const p = fetch(`assets/sculptures/${id}.sand`)
    .then((res) => {
      if (!res.ok) throw new Error(`sculpture ${id}: ${res.status}`);
      return new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    })
    .then((buf) => {
      const head = new DataView(buf, 0, 10);
      const nx = head.getUint16(4, true), ny = head.getUint16(6, true), nz = head.getUint16(8, true);
      const data = new Uint8Array(buf, 10, nx * ny * nz);
      // lowest solid cell in each column, so the base can be bedded into the beach
      const low = new Int16Array(nx * nz).fill(-1);
      for (let z = 0; z < nz; z++) {
        for (let x = 0; x < nx; x++) {
          for (let y = 0; y < ny; y++) {
            if (data[x + nx * (y + ny * z)] >= 128) { low[x + nx * z] = y; break; }
          }
        }
      }
      return { ...entry, nx, ny, nz, data, low };
    });
  p.catch(() => cache.delete(id));
  cache.set(id, p);
  return p;
}

export function preloadSculptModels() {
  for (const m of MANIFEST) loadSculptModel(m.id).catch(() => {});
}
