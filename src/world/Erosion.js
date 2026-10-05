import { N, M, S } from '../core/config.js';

// Waves and currents slowly melt sand: where water flows, steep sand relaxes
// toward its neighbours (diffusion) and over-steep faces slump (talus).
export class Erosion {
  constructor(terrain, sim) {
    this.terrain = terrain;
    this.sim = sim;
    this.acc = 0;
    this.strength = 1;
    this.enabled = true;
  }

  update(dt) {
    if (!this.enabled) return;
    this.acc += dt;
    if (this.acc < 0.05) return;
    const step = Math.min(this.acc, 0.1);
    this.acc = 0;
    const { h, mask } = this.terrain;
    const { d, spd } = this.sim;
    const talus = 0.62 * S; // ~32° for saturated, moving sand
    let i0 = N, j0 = N, i1 = -1, j1 = -1;
    for (let cj = 1; cj < M - 1; cj++) {
      for (let ci = 1; ci < M - 1; ci++) {
        const c = cj * M + ci;
        const dc = d[c];
        if (dc < 0.012) continue;
        const v = spd[c];
        const agitated = v > 0.12 || dc < 0.3;
        if (!agitated) continue;
        const rate = Math.min(0.3, (0.04 + v * 0.35 + (dc < 0.25 ? 0.06 : 0)) * step * this.strength);
        const slump = Math.min(0.5, (0.6 + v * 1.2) * step * this.strength);
        for (let q = 0; q < 4; q++) {
          const i = 2 * ci + (q & 1), j = 2 * cj + (q >> 1);
          const k = j * N + i;
          const m = mask[k];
          if (m <= 0) continue;
          const hk = h[k];
          const hl = h[k - 1], hr = h[k + 1], hd = h[k - N], hu = h[k + N];
          const dl = hk - hl, dr = hk - hr, dd = hk - hd, du = hk - hu;
          const maxDiff = Math.max(Math.abs(dl), Math.abs(dr), Math.abs(dd), Math.abs(du));
          if (maxDiff < 0.025) continue;
          const avg = (hl + hr + hd + hu) * 0.25;
          let nh = hk + (avg - hk) * rate * m;
          // talus: shed sand onto lower neighbours
          const nb = [k - 1, k + 1, k - N, k + N];
          const df = [dl, dr, dd, du];
          for (let e = 0; e < 4; e++) {
            const ex = df[e] - talus;
            if (ex > 0) {
              const mv = ex * 0.5 * slump * m;
              nh -= mv;
              h[nb[e]] += mv * mask[nb[e]];
            }
          }
          h[k] = nh;
          if (i < i0) i0 = i; if (i > i1) i1 = i;
          if (j < j0) j0 = j; if (j > j1) j1 = j;
        }
      }
    }
    if (i1 >= 0) this.terrain.markDirty(i0 - 1, j0 - 1, i1 + 1, j1 + 1);
  }
}
