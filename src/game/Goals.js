import { goalText } from '../world/levels.js';
import { N } from '../core/config.js';
import { waveParams } from '../world/WaterSim.js';

const RISE = 18, PEAK = 9, FALL = 15;

export class Goals {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.tide = { phase: 'idle', t: 0 };
    this.evalTimer = 0;
    this.markerTimer = 0;
    this.maxBuilt = 0;
  }

  setup(level) {
    this.level = level;
    this.list = (level.goals || []).map((g) => ({ ...g, text: goalText(g), done: false, progress: 0, label: '' }));
    this.tide = { phase: 'idle', t: 0 };
    this.allDone = false;
    this.completeFired = false;
    this.maxBuilt = 0;
    this.markerTimer = 0;
    this.evaluate(true);
  }

  get tideActive() { return this.tide.phase !== 'idle'; }

  tideLevel() {
    const { low, high } = this.level.tide;
    const tt = this.tide;
    const ease = (x) => x * x * (3 - 2 * x);
    switch (tt.phase) {
      case 'rise': return low + (high - low) * ease(Math.min(1, tt.t / RISE));
      case 'peak': return high;
      case 'fall': return high - (high - low) * ease(Math.min(1, tt.t / FALL));
      default: return low;
    }
  }

  tideProgress() {
    const tt = this.tide;
    if (tt.phase === 'rise') return tt.t / (RISE + PEAK + FALL);
    if (tt.phase === 'peak') return (RISE + tt.t) / (RISE + PEAK + FALL);
    if (tt.phase === 'fall') return (RISE + PEAK + tt.t) / (RISE + PEAK + FALL);
    return 0;
  }

  startTide() {
    if (this.tideActive) return false;
    const g = this.game;
    this.tide = { phase: 'rise', t: 0 };
    this.tideFlags = g.props.filter((p) => p.kind === 'flag' && !p.fallen);
    this.hadFlags = this.tideFlags.length > 0;
    this.crabFlooded = false;
    g.audio.sfx('conch');
    g.ui.toast('🐚 漲潮了！看看你的城堡能不能撐過海浪', 'tide');
    if (this.list.some((x) => x.type === 'tideFlag' && !x.done) && !this.hadFlags) {
      setTimeout(() => g.ui.toast('提示：先插一面旗幟，才能完成漲潮挑戰喔', 'info'), 1600);
    }
    return true;
  }

  update(dt) {
    const g = this.game;
    const tt = this.tide;
    if (tt.phase !== 'idle') {
      tt.t += dt;
      if (tt.phase === 'rise' && tt.t >= RISE) { tt.phase = 'peak'; tt.t = 0; }
      else if (tt.phase === 'peak' && tt.t >= PEAK) { tt.phase = 'fall'; tt.t = 0; }
      else if (tt.phase === 'fall' && tt.t >= FALL) { tt.phase = 'idle'; tt.t = 0; this.finishTide(); }
      // anything that gets swamped during the tide
      for (const f of g.props) {
        if (f.kind !== 'flag' || f.fallen) continue;
        if (g.sim.depthAt(f.x, f.z) > 0.045) g.knockFlag(f);
      }
      if (this.level.crabHome && !this.crabFlooded) {
        const ch = this.level.crabHome;
        if (g.sim.depthAt(ch.x, ch.z) > 0.04) {
          this.crabFlooded = true;
          g.floodCrabs(true);
        }
      }
    }
    g.sim.tide = this.tideLevel();
    const { low, high } = this.level.tide;
    const tideFrac = (g.sim.tide - low) / Math.max(0.01, high - low);
    g.audio.setTideIntensity(tideFrac);
    waveParams.surge = 1 + 0.6 * Math.max(0, tideFrac);

    this.evalTimer -= dt;
    if (this.evalTimer <= 0) {
      this.evalTimer = 0.4;
      this.evaluate(false);
    }
    // the shell pool needs to hold sea water for a moment
    const mk = this.level.marker;
    if (mk) {
      const wet = g.sim.depthAt(mk.x, mk.z) > 0.04;
      this.markerTimer = wet ? this.markerTimer + dt : 0;
    }
  }

  finishTide() {
    const g = this.game;
    const survivors = (this.tideFlags || []).filter((f) => !f.fallen && g.props.includes(f));
    let success = false;
    for (const goal of this.list) {
      if (goal.done) continue;
      if (goal.type === 'tideFlag' && this.hadFlags && survivors.length > 0) { this.complete(goal); success = true; }
      if (goal.type === 'tideCrab' && !this.crabFlooded) { this.complete(goal); success = true; }
    }
    const needed = this.list.some((x) => (x.type === 'tideFlag' || x.type === 'tideCrab'));
    if (!success && needed) {
      const failCrab = this.level.crabHome && this.crabFlooded;
      const failFlag = this.list.some((x) => x.type === 'tideFlag' && !x.done);
      if (failCrab) g.ui.toast('寄居蟹的家被淹了… 把堤防蓋得更高更厚再試一次！', 'fail');
      else if (failFlag && this.hadFlags) g.ui.toast('旗幟被海浪捲走了… 把城堡加高再試一次！', 'fail');
      if (failCrab || (failFlag && this.hadFlags)) g.audio.sfx('fail');
    } else if (!needed) {
      g.ui.toast('潮水退去了，沙灘又恢復平靜 🌊', 'info');
    }
    g.cleanupAfterTide();
    if (this.level.crabHome) g.floodCrabs(false);
  }

  complete(goal) {
    if (goal.done) return;
    goal.done = true;
    goal.progress = 1;
    this.game.audio.sfx('goal');
    this.game.ui.toast(`✔ ${goal.text}`, 'goal');
  }

  computeMaxBuilt() {
    const { h, h0, solid } = this.game.terrain;
    let m = 0;
    for (let k = 0; k < N * N; k++) {
      const v = (h[k] > solid[k] ? h[k] : solid[k]) - h0[k];
      if (v > m) m = v;
    }
    this.maxBuilt = m;
  }

  evaluate(silent) {
    const g = this.game;
    if (!this.list.length) return;
    this.computeMaxBuilt();
    const decorCount = g.props.filter((p) => p.kind === 'decor').length;
    const found = g.treasures.filter((t) => t.found).length;
    for (const goal of this.list) {
      if (goal.done) { goal.label = '完成'; continue; }
      let p = 0, label = '';
      switch (goal.type) {
        case 'height':
          p = this.maxBuilt / goal.target;
          label = `${Math.round(this.maxBuilt * 30)} / ${Math.round(goal.target * 30)} 公分`;
          break;
        case 'towers':
          p = g.tools.stats.towers / goal.count;
          label = `${Math.min(g.tools.stats.towers, goal.count)} / ${goal.count}`;
          break;
        case 'wall':
          p = g.tools.stats.wall / goal.length;
          label = `${(Math.min(g.tools.stats.wall, goal.length) * 0.3).toFixed(1)} / ${(goal.length * 0.3).toFixed(1)} 公尺`;
          break;
        case 'decor':
          p = decorCount / goal.count;
          label = `${Math.min(decorCount, goal.count)} / ${goal.count}`;
          break;
        case 'treasure':
          p = found / goal.count;
          label = `${Math.min(found, goal.count)} / ${goal.count}`;
          break;
        case 'flagHigh': {
          let best = 0;
          for (const f of g.props) {
            if (f.kind !== 'flag' || f.fallen) continue;
            const fy = f.sy !== undefined ? f.sy : g.terrain.heightAt(f.x, f.z);
            best = Math.max(best, fy - g.terrain.originalAt(f.x, f.z));
          }
          p = best / goal.height;
          label = `${Math.round(best * 30)} / ${Math.round(goal.height * 30)} 公分`;
          break;
        }
        case 'waterMarker':
          p = this.markerTimer > 1.2 && !this.tideActive ? 1 : Math.min(0.95, this.markerTimer);
          label = p >= 1 ? '' : this.markerTimer > 0 ? '海水流進來了…' : '尚未引水';
          break;
        case 'tideFlag':
        case 'tideCrab':
          p = 0;
          label = this.tideActive ? '漲潮中…' : '按「迎接漲潮」挑戰';
          break;
        default:
          break;
      }
      goal.progress = Math.max(0, Math.min(1, p));
      goal.label = label;
      if (p >= 1 && !silent) this.complete(goal);
      else if (p >= 1) goal.done = true;
    }
    this.allDone = this.list.every((x) => x.done);
    g.ui.renderGoals(this.list);
    if (this.allDone && !this.completeFired) {
      this.completeFired = true;
      setTimeout(() => g.levelComplete(), 1800);
    }
  }
}
