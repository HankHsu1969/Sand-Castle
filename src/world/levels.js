import { makeSimplex, fbm, smoothstep, clamp, polyDist } from '../core/noise.js';

// Each level supplies a height function covering the whole world (the
// sculptable square plus the scenery around it), plus lighting, tide and goals.
// The sea is always toward -Z; the camera starts on the land side (+Z).

function beachHeight(d, dune, slope = 0.075) {
  if (d >= 0) {
    const h = slope * d + 0.9 * smoothstep(6, 16, d) + dune * smoothstep(9, 30, d);
    return Math.min(h, 7);
  }
  const s = -d;
  return Math.max(-(0.085 * s + 0.0022 * s * s), -16);
}

function islands(x, z, list) {
  let h = -Infinity;
  for (const is of list) {
    const dx = x - is.x, dz = z - is.z;
    const r = Math.sqrt(dx * dx + dz * dz);
    const t = 1 - r / is.r;
    if (t > -0.6) {
      const v = t > 0 ? is.h * Math.pow(t, 0.7) - 0.4 : -0.4 + t * 18;
      if (v > h) h = v;
    }
  }
  return h;
}

function makeDetail(seed) {
  const n1 = makeSimplex(seed);
  const n2 = makeSimplex(seed + 11);
  return {
    dune: (x, z) => 0.7 + 0.9 * fbm(n1, x * 0.035, z * 0.035, 4),
    // fine variation + wave ripples on the wet beach
    micro: (x, z, h) => {
      let v = 0.025 * fbm(n2, x * 0.18, z * 0.18, 3);
      if (h < 0.35) {
        const w = smoothstep(0.35, -0.5, h);
        v += w * 0.035 * Math.sin(z * 2.6 + 0.9 * Math.sin(x * 0.35) + n1(x * 0.1, z * 0.1) * 2.0);
      }
      return v;
    },
  };
}

const COMMON_DECOR = ['scallop', 'conch', 'starfish', 'pebble', 'driftwood', 'seaweed', 'coral', 'urchin'];

export const LEVELS = [
  {
    id: 1,
    name: '晨曦海灣',
    en: 'Dawn Cove',
    image: 'assets/img/level1.jpg',
    blurb: '粉色晨光灑在平靜的小海灣。先熟悉堆沙、挖沙與塑形，蓋出你的第一座沙堡吧！',
    seed: 101,
    sun: { elevation: 13, azimuth: 118, color: 0xffc9a8, intensity: 2.7 },
    sky: { turbidity: 2.7, rayleigh: 2.3, mie: 0.0028, mieG: 0.82, clouds: 0.34, exposure: 0.42 },
    hemi: { sky: 0xffd7c4, ground: 0xd9b48a, intensity: 1.0 },
    fog: { color: 0xf6c7b4, density: 0.0014 },
    sea: { shallow: 0x5fd6c8, deep: 0x1d5f8a, scatter: 0x7fe0d2 },
    tide: { low: 0.0, high: 0.6, waveAmp: 0.075, wavePeriod: 8 },
    music: 0,
    treasures: 1,
    goals: [
      { type: 'height', target: 2.0 },
      { type: 'towers', count: 2 },
      { type: 'decor', count: 4 },
      { type: 'treasure', count: 1 },
    ],
    tips: ['左鍵使用工具 · 右鍵拖曳旋轉視角 · 滾輪縮放 · WASD 移動', '試試「堆沙」工具按住左鍵堆出沙丘吧！'],
    build() {
      const det = makeDetail(this.seed);
      const isl = [{ x: -160, z: -260, r: 60, h: 14 }, { x: 210, z: -330, r: 45, h: 10 }];
      return (x, z) => {
        const shore = -5 - 0.011 * x * x;
        const slope = -0.022 * x;
        const d = (z - shore) / Math.sqrt(1 + slope * slope);
        // a broad, flat sandy terrace where you build; dunes only further back
        const play = 1 - smoothstep(18, 32, Math.max(Math.abs(x), z));
        let h = beachHeight(d, det.dune(x, z) * (1 - play));
        if (d > 0) h = h * (1 - play) + Math.min(h, 0.55 + 0.02 * d) * play;
        // rocky headlands far to the sides
        const head = smoothstep(34, 70, Math.abs(x)) * smoothstep(-70, -10, z);
        h += head * (1.5 + 2.5 * det.dune(x * 2, z * 2));
        h = Math.max(h, islands(x, z, isl));
        return h + det.micro(x, z, h);
      };
    },
    scenery: { palms: 26, rocks: 34, islands: [{ x: -160, z: -260, r: 60 }, { x: 210, z: -330, r: 45 }], coral: 0 },
  },
  {
    id: 2,
    name: '珊瑚潟湖',
    en: 'Coral Lagoon',
    image: 'assets/img/level2.jpg',
    blurb: '珊瑚礁圍出一片清澈的潟湖。築起長長的城牆與高塔，在城堡最高處插上旗幟！',
    seed: 202,
    sun: { elevation: 56, azimuth: 140, color: 0xfff4e0, intensity: 3.1 },
    sky: { turbidity: 2.2, rayleigh: 2.6, mie: 0.003, mieG: 0.8, clouds: 0.3, exposure: 0.36 },
    hemi: { sky: 0xbfe6ff, ground: 0xf0dcb8, intensity: 1.15 },
    fog: { color: 0xbfe4f2, density: 0.0011 },
    sea: { shallow: 0x3fe6d6, deep: 0x0d63a8, scatter: 0x6ff2e2 },
    tide: { low: 0.0, high: 0.7, waveAmp: 0.06, wavePeriod: 7 },
    music: 1,
    treasures: 1,
    goals: [
      { type: 'wall', length: 13.5 },
      { type: 'towers', count: 4 },
      { type: 'flagHigh', height: 2.0 },
      { type: 'treasure', count: 1 },
    ],
    tips: ['「城牆」工具：按住左鍵拖曳，沿著路徑築牆。', '旗幟要插在高度 60 公分以上的地方。'],
    build() {
      const det = makeDetail(this.seed);
      const isl = [{ x: 120, z: -150, r: 22, h: 6 }, { x: -230, z: -280, r: 70, h: 18 }];
      return (x, z) => {
        const shore = -6 + 0.0035 * x * x;
        const d = (z - shore) / Math.sqrt(1 + Math.pow(0.007 * x, 2));
        let h = beachHeight(d, det.dune(x, z), 0.07);
        if (d < 0) {
          // shallow lagoon floor, then the reef crest, then open ocean
          const rz = z + 72 + 0.0015 * x * x;
          const lag = Math.max(h, -2.6 + 0.6 * (det.dune(x * 3, z * 3) - 0.7));
          const ocean = Math.max(-16, -3 + Math.min(0, rz + 4) * 0.25);
          const outside = smoothstep(-2, -14, rz);
          const base = lag * (1 - outside) + ocean * outside;
          // the reef crest rises from the floor almost to the surface
          h = Math.max(h, base + 2.75 * Math.exp(-Math.pow(rz / 6, 2)));
        }
        h = Math.max(h, islands(x, z, isl));
        return h + det.micro(x, z, h);
      };
    },
    scenery: { palms: 30, rocks: 16, islands: [{ x: 120, z: -150, r: 22 }, { x: -230, z: -280, r: 70 }], coral: 60 },
  },
  {
    id: 3,
    name: '棕櫚小島',
    en: 'Palm Isle',
    image: 'assets/img/level3.jpg',
    blurb: '被棕櫚樹環抱的小島。挖一條水道把海水引進貝殼池，再用城堡迎接漲潮。',
    seed: 303,
    sun: { elevation: 34, azimuth: 62, color: 0xffe2b8, intensity: 2.9 },
    sky: { turbidity: 2.4, rayleigh: 2.5, mie: 0.0035, mieG: 0.82, clouds: 0.42, exposure: 0.4 },
    hemi: { sky: 0xcfe8ff, ground: 0xe6c99a, intensity: 1.05 },
    fog: { color: 0xd6e8ef, density: 0.0012 },
    sea: { shallow: 0x48dccb, deep: 0x115d93, scatter: 0x75e8d8 },
    tide: { low: 0.0, high: 0.8, waveAmp: 0.11, wavePeriod: 8 },
    music: 2,
    treasures: 2,
    marker: { x: 4, z: 6, r: 1.4 },
    goals: [
      { type: 'waterMarker' },
      { type: 'towers', count: 3 },
      { type: 'tideFlag' },
      { type: 'treasure', count: 2 },
    ],
    tips: ['「挖渠」工具：拖曳就能挖出一條水道，水道要比海面更低。', '準備好了就按右上角「迎接漲潮」，旗幟不能被淹沒！'],
    build() {
      const det = makeDetail(this.seed);
      const isl = [{ x: 140, z: -120, r: 26, h: 8 }, { x: -170, z: -210, r: 34, h: 9 }, { x: 40, z: -380, r: 80, h: 22 }];
      return (x, z) => {
        const dx = x, dz = z - 22;
        const r = Math.sqrt(dx * dx + dz * dz);
        const wob = 2.5 * det.dune(x * 0.6, z * 0.6) - 1.5;
        const d = 27 + wob - r;
        let h = beachHeight(d, det.dune(x, z) * 1.6);
        h = Math.max(h, islands(x, z, isl));
        return h + det.micro(x, z, h);
      };
    },
    scenery: { palms: 46, rocks: 22, islands: [{ x: 140, z: -120, r: 26 }, { x: -170, z: -210, r: 34 }, { x: 40, z: -380, r: 80 }], coral: 20, islandCenter: { x: 0, z: 22, r: 27 } },
  },
  {
    id: 4,
    name: '沙洲屏障',
    en: 'Sand Barrier',
    image: 'assets/img/level4.jpg',
    blurb: '寄居蟹一家住在沙洲後方的低地。補好堤防的缺口，保護牠們度過漲潮！',
    seed: 404,
    sun: { elevation: 20, azimuth: 252, color: 0xffcf8f, intensity: 2.8 },
    sky: { turbidity: 3.0, rayleigh: 2.4, mie: 0.004, mieG: 0.85, clouds: 0.36, exposure: 0.44 },
    hemi: { sky: 0xffe0bd, ground: 0xd8b07c, intensity: 1.0 },
    fog: { color: 0xf3d6b0, density: 0.0013 },
    sea: { shallow: 0x4fcfc0, deep: 0x154f80, scatter: 0x80dccc },
    tide: { low: 0.0, high: 1.15, waveAmp: 0.11, wavePeriod: 8 },
    music: 3,
    treasures: 2,
    crabHome: { x: 0, z: 4.6 },
    goals: [
      { type: 'tideCrab' },
      { type: 'decor', count: 6 },
      { type: 'towers', count: 2 },
      { type: 'treasure', count: 2 },
    ],
    tips: ['堤防中間有個缺口，海水會從那裡灌進低地。', '海浪會侵蝕沙子，堤防要夠高也要夠厚！'],
    build() {
      const det = makeDetail(this.seed);
      const isl = [{ x: -120, z: -170, r: 30, h: 7 }, { x: 260, z: -300, r: 90, h: 20 }];
      return (x, z) => {
        let h = beachHeight(z + 8, det.dune(x, z) * 0.8);
        // a raised plateau behind the barrier line
        const behind = smoothstep(-4.4, -2.4, z);
        const plateau = 1.75 + 0.15 * det.dune(x * 1.5, z * 1.5);
        h = h * (1 - behind) + Math.max(h, plateau) * behind;
        // the low basin where the hermit crabs live
        const e = Math.pow(x / 12.5, 2) + Math.pow((z - 4.4) / 6.2, 2);
        const basin = 1 - smoothstep(0.62, 1.0, e);
        const floor = 0.22 + 0.25 * e + 0.25 * Math.exp(-(x * x + Math.pow(z - 4.6, 2)) / 2.2);
        h = h * (1 - basin) + floor * basin;
        // barrier crest
        const crest = 1.85 * Math.exp(-Math.pow((z + 3.2) / 1.4, 2));
        if (crest > 0.05) h = Math.max(h, crest);
        // the breach: a gully through the barrier into the basin
        const breach = 1 - smoothstep(2.6, 4.6, Math.abs(x));
        const gmask = breach * smoothstep(-5.6, -4.3, z) * (1 - smoothstep(-1.2, 0.2, z));
        if (gmask > 0) h = h * (1 - gmask) + Math.min(h, 0.5 + 0.25 * Math.pow(x / 3, 2)) * gmask;
        h = Math.max(h, islands(x, z, isl));
        return h + det.micro(x, z, h);
      };
    },
    scenery: { palms: 30, rocks: 26, islands: [{ x: -120, z: -170, r: 30 }, { x: 260, z: -300, r: 90 }], coral: 0 },
  },
  {
    id: 5,
    name: '夕陽三角洲',
    en: 'Sunset Delta',
    image: 'assets/img/level5.jpg',
    blurb: '河流在夕陽下分成閃亮的支流匯入大海。建造你最宏偉的城堡，迎接大潮的考驗！',
    seed: 505,
    sun: { elevation: 7, azimuth: 222, color: 0xff9a5a, intensity: 2.6 },
    sky: { turbidity: 9, rayleigh: 3.4, mie: 0.011, mieG: 0.9, clouds: 0.48, exposure: 0.5, skyLum: 1.15 },
    hemi: { sky: 0xffb59a, ground: 0xb98a63, intensity: 0.9 },
    fog: { color: 0xf0a888, density: 0.0016 },
    sea: { shallow: 0x58c4bc, deep: 0x1d3f72, scatter: 0x8ad0c2 },
    tide: { low: 0.0, high: 1.0, waveAmp: 0.09, wavePeriod: 8.5 },
    music: 4,
    treasures: 2,
    rivers: [
      [[2, 70], [3, 32], [0, 19], [-3, 10], [-2, 2], [-5, -4], [-7, -14]],
      [[0, 19], [5, 12], [9, 5], [10, -2], [12, -12]],
      [[-3, 10], [-9, 6], [-13, -1], [-15, -10]],
    ],
    goals: [
      { type: 'towers', count: 5 },
      { type: 'wall', length: 20 },
      { type: 'height', target: 4.0 },
      { type: 'tideFlag' },
      { type: 'treasure', count: 2 },
    ],
    tips: ['河水會一直流向大海，城堡別蓋在河道裡。', '大潮會淹沒大半沙洲，城堡要蓋得夠高！'],
    build() {
      const det = makeDetail(this.seed);
      const rivers = this.rivers;
      const isl = [{ x: 180, z: -200, r: 40, h: 9 }, { x: -260, z: -320, r: 85, h: 20 }];
      return (x, z) => {
        const shore = -6 - 4 * Math.exp(-x * x / 300);
        let h = beachHeight(z - shore, det.dune(x, z) * 0.9, 0.055);
        let rd = Infinity;
        for (const r of rivers) rd = Math.min(rd, polyDist(x, z, r));
        const bed = -0.2 + 0.032 * z;
        const w = 1.9 + 0.012 * Math.max(0, 20 - z);
        const ch = bed + 0.9 * Math.pow(rd / w, 2);
        // smooth minimum so the river banks blend softly into the sand flats
        const k = 0.6;
        const hh = Math.max(k - Math.abs(h - ch), 0) / k;
        h = Math.min(h, ch) - hh * hh * k * 0.25;
        h = Math.max(h, islands(x, z, isl));
        return h + det.micro(x, z, h);
      };
    },
    scenery: { palms: 34, rocks: 18, islands: [{ x: 180, z: -200, r: 40 }, { x: -260, z: -320, r: 85 }], coral: 0 },
  },
];

// The scene behind the title screen: a golden morning cove with a finished castle.
export const SHOWCASE = {
  ...LEVELS[0],
  id: 0,
  name: '沙堡物語',
  sun: { elevation: 17, azimuth: 128, color: 0xffd6a6, intensity: 2.9 },
  sky: { turbidity: 2.5, rayleigh: 2.4, mie: 0.0034, mieG: 0.84, clouds: 0.38, exposure: 0.44 },
  hemi: { sky: 0xffe2cc, ground: 0xdcb88c, intensity: 1.05 },
  fog: { color: 0xf7d6be, density: 0.0012 },
  tide: { low: 0.0, high: 0.6, waveAmp: 0.08, wavePeriod: 8 },
  treasures: 0,
  goals: [],
};

export const DECOR_TYPES = COMMON_DECOR;

export const TREASURES = [
  { id: 'coin', name: '海盜金幣', desc: '印著骷髏頭的古老金幣，據說來自一艘沉沒的海盜船。' },
  { id: 'seaglass', name: '彩色海玻璃', desc: '被海浪打磨了數十年的玻璃碎片，像糖果一樣溫潤。' },
  { id: 'bottle', name: '瓶中信', desc: '「致發現這封信的人：願你永遠記得今天的海風。」' },
  { id: 'pearl', name: '月光珍珠', desc: '藏在牡蠣裡的珍珠，在陽光下泛著淡淡的虹彩。' },
  { id: 'key', name: '古老鑰匙', desc: '生鏽的黃銅鑰匙，不知道能打開哪一個寶箱？' },
  { id: 'compass', name: '航海羅盤', desc: '指針總是溫柔地指向家的方向。' },
  { id: 'ring', name: '紅寶石戒指', desc: '鑲著紅寶石的金戒指，閃耀著夕陽的顏色。' },
  { id: 'fossil', name: '菊石化石', desc: '一億年前的海洋居民，完美的螺旋令人著迷。' },
];

// which treasures appear in which level (indices into TREASURES)
export const LEVEL_TREASURES = { 1: [0], 2: [1], 3: [2, 3], 4: [4, 5], 5: [6, 7] };

export function goalText(goal) {
  switch (goal.type) {
    case 'height': return `堆出 ${Math.round(goal.target * 30)} 公分高的城堡`;
    case 'towers': return `用水桶塔蓋 ${goal.count} 座塔樓`;
    case 'wall': return `築起總長 ${(goal.length * 0.3).toFixed(1)} 公尺的城牆`;
    case 'decor': return `擺放 ${goal.count} 個海灘裝飾`;
    case 'treasure': return `挖出 ${goal.count} 個寶藏`;
    case 'flagHigh': return `在 ${Math.round(goal.height * 30)} 公分高處插上旗幟`;
    case 'waterMarker': return '挖水道把海水引進貝殼池';
    case 'tideFlag': return '迎接漲潮：至少一面旗幟不被淹沒';
    case 'tideCrab': return '迎接漲潮：寄居蟹的家保持乾燥';
    default: return '';
  }
}

export { clamp };
