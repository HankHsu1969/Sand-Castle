// Shared world dimensions. The sculptable beach is a square heightfield of
// N×N vertices; the shallow-water simulation runs at half that resolution.
export const N = 320;               // terrain vertices per side
export const S = 0.12;              // spacing between terrain vertices (world units)
export const W = (N - 1) * S;       // world width of the sculptable area
export const HALF = W / 2;
export const M = N / 2;             // water simulation cells per side
export const L = S * 2;             // water cell size
export const EDGE_LOCK = 6;         // vertices near the border that never change
export const CM_PER_UNIT = 30;      // display scale: 1 world unit ≈ 30 cm of sand
export const FLOOR = -6;            // nothing can be dug below this

export const toCm = (u) => Math.round(u * CM_PER_UNIT);
export const fmtLen = (u) => {
  const cm = u * CM_PER_UNIT;
  return cm >= 100 ? `${(cm / 100).toFixed(1)} 公尺` : `${Math.round(cm)} 公分`;
};
