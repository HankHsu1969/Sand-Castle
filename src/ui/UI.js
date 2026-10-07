import * as THREE from 'three';
import { LEVELS, TREASURES } from '../world/levels.js';
import { TOOLS } from '../game/Tools.js';
import { DECOR_INFO, DECOR_LIST, makeDecor } from '../world/Props.js';
import { SCULPT_MODELS, preloadSculptModels } from '../world/SculptModels.js';

const $ = (sel, root = document) => root.querySelector(sel);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class UI {
  constructor(game) {
    this.game = game;
    this.root = $('#ui');
    this.toolIndex = 0;
    this.buildStatic();
    this.bindButtons();
  }

  get audio() { return this.game.audio; }

  // ---------- static structure ----------
  buildStatic() {
    const levels = LEVELS.map((l, i) => `
      <button class="level-card" data-level="${i}">
        <div class="lc-img" style="background-image:url(${l.image})"></div>
        <div class="lc-badge">${i + 1}</div>
        <div class="lc-lock"><span>🔒</span><em>完成上一關後解鎖</em></div>
        <div class="lc-done">✓ 已完成</div>
        <div class="lc-body">
          <h3>${l.name}<small>${l.en}</small></h3>
          <p>${l.blurb}</p>
        </div>
      </button>`).join('');
    $('#level-grid').innerHTML = levels;

    $('#toolbar').innerHTML = TOOLS.map((t, i) => `
      <button class="tool" data-tool="${i}" title="${t.name}（${t.key}）">
        <img src="${t.icon}" alt="" draggable="false"/>
        <span class="tool-key">${t.key}</span>
        <span class="tool-name">${t.name}</span>
      </button>`).join('');

    $('#sculpt-palette').innerHTML = [
      { id: 'block', name: '方塊', shape: 'block' },
      { id: 'slab', name: '長塊', shape: 'slab' },
      ...SCULPT_MODELS,
    ].map((m) => `
      <button class="sculpt-pick${m.id === 'block' ? ' active' : ''}" data-kind="${m.id}" title="${m.name}">
        ${m.thumb ? `<img src="${m.thumb}" alt="" draggable="false"/>` : `<i class="shape-${m.shape}"></i>`}
        <span>${m.name}</span>
      </button>`).join('');

    $('#decor-palette').innerHTML = DECOR_LIST.map((d) => `
      <button class="decor" data-decor="${d}" title="${DECOR_INFO[d].name}">
        <img alt="" data-thumb="${d}"/>
        <span>${DECOR_INFO[d].name}</span>
      </button>`).join('');
  }

  bindButtons() {
    const g = this.game;
    this.root.addEventListener('pointerover', (e) => {
      const b = e.target.closest('button');
      if (b && !b.disabled && b !== this.lastHover) { this.lastHover = b; this.audio.sfx('hover'); }
    });
    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) this.audio.sfx('click');
    });

    $('#btn-skip').onclick = (e) => { e.stopPropagation(); g.intro.skip(); };
    $('#gate').addEventListener('click', () => this.leaveGate());

    $('#btn-start').onclick = () => {
      const open = LEVELS.findIndex((l, i) => i < g.save.unlocked && !g.save.completed.includes(l.id));
      const next = open >= 0 ? open : 0;
      this.hideTitle();
      g.startLevel(next);
    };
    $('#btn-levels').onclick = () => this.openPanel('levels');
    $('#btn-collection').onclick = () => this.openPanel('collection');
    $('#btn-settings').onclick = () => this.openPanel('settings');
    $('#btn-credits').onclick = () => this.openPanel('credits');
    for (const b of document.querySelectorAll('.panel-close')) b.onclick = () => this.closePanels();

    $('#level-grid').addEventListener('click', (e) => {
      const card = e.target.closest('.level-card');
      if (!card || card.classList.contains('locked')) return;
      this.closePanels();
      this.hideTitle();
      g.startLevel(Number(card.dataset.level));
    });

    // toolbar
    $('#toolbar').addEventListener('click', (e) => {
      const b = e.target.closest('.tool');
      if (b) this.selectTool(Number(b.dataset.tool));
    });
    $('#decor-palette').addEventListener('click', (e) => {
      const b = e.target.closest('.decor');
      if (!b) return;
      g.tools.decorType = b.dataset.decor;
      for (const x of document.querySelectorAll('.decor')) x.classList.toggle('active', x === b);
      this.audio.sfx('tool');
      this.showPicker('decor', false);
    });
    $('#decor-current').onclick = () => { this.showPicker('decor', true); this.audio.sfx('tool'); };
    $('#sculpt-palette').addEventListener('click', (e) => {
      const b = e.target.closest('.sculpt-pick');
      if (!b) return;
      g.tools.sculptKind = b.dataset.kind;
      for (const x of document.querySelectorAll('.sculpt-pick')) x.classList.toggle('active', x === b);
      this.updateBrushLabel();
      this.audio.sfx('tool');
      this.showPicker('sculpt', false);
    });
    $('#sculpt-current').onclick = () => { this.showPicker('sculpt', true); this.audio.sfx('tool'); };
    $('#brush-size').oninput = (e) => { g.tools.radius = Number(e.target.value); this.updateBrushLabel(); };
    $('#brush-strength').oninput = (e) => { g.tools.strength = Number(e.target.value); this.updateBrushLabel(); };

    $('#btn-tide').onclick = () => this.requestTide();
    $('#goal-head').onclick = () => this.toggleMission();
    const panel = $('#goal-panel');
    panel.addEventListener('pointerenter', () => { this.missionHover = true; clearTimeout(this.missionTimer); });
    panel.addEventListener('pointerleave', () => { this.missionHover = false; this.scheduleCollapse(); });
    $('#btn-undo').onclick = () => g.undo();
    $('#btn-help').onclick = () => this.toggleHelp();
    $('#btn-photo').onclick = () => g.photo.enter();
    $('#btn-pause').onclick = () => this.togglePause();
    $('#btn-hud-settings').onclick = () => this.openPanel('settings');
    $('#help').onclick = () => this.toggleHelp(false);

    $('#btn-resume').onclick = () => this.togglePause(false);
    $('#btn-restart').onclick = () => { this.togglePause(false); g.startLevel(g.levelIndex); };
    $('#btn-pause-settings').onclick = () => this.openPanel('settings');
    $('#btn-to-menu').onclick = () => { this.togglePause(false); this.leaveToMenu(); };

    $('#btn-next').onclick = () => {
      this.hideComplete();
      if (g.levelIndex + 1 >= LEVELS.length) this.showEnding();
      else g.startLevel(g.levelIndex + 1);
    };
    $('#btn-keep').onclick = () => { this.hideComplete(); g.state = 'play'; };
    $('#btn-complete-menu').onclick = () => { this.hideComplete(); this.leaveToMenu(); };
    $('#btn-treasure-ok').onclick = () => $('#treasure-modal').classList.remove('show');
    $('#btn-ending-menu').onclick = () => {
      $('#ending').classList.remove('show');
      this.leaveToMenu();
    };

    // settings
    for (const k of ['music', 'sfx', 'ambience']) {
      const el = $(`#vol-${k}`);
      el.value = this.audio.vol[k];
      el.oninput = () => this.audio.setVolume(k, Number(el.value));
    }
    const q = $('#quality');
    q.value = g.save.settings.quality;
    q.onchange = () => { g.applyQuality(q.value); g.persist(); };
    const tilt = $('#tiltshift');
    tilt.checked = g.save.settings.tilt !== false;
    tilt.onchange = () => { g.save.settings.tilt = tilt.checked; g.post.setTilt(tilt.checked); g.persist(); };
    const hints = $('#show-hints');
    hints.checked = g.save.settings.hints !== false;
    $('#tool-label').classList.toggle('off', !hints.checked);
    hints.onchange = () => {
      g.save.settings.hints = hints.checked;
      $('#tool-label').classList.toggle('off', !hints.checked);
      g.persist();
    };
  }

  // ---------- gate / intro / title ----------
  showGate() {
    $('#gate').classList.remove('loading');
    $('#gate').classList.add('ready');
  }

  leaveGate() {
    const gate = $('#gate');
    if (!gate.classList.contains('ready') || gate.classList.contains('leaving')) return;
    gate.classList.add('leaving');
    setTimeout(() => gate.classList.add('hidden'), 1200);
    this.game.enterFromGate();
  }

  introStart() {
    const b = $('#blackout');
    b.classList.add('show');
    setTimeout(() => b.classList.add('fade'), 60);
    const line = $('#intro-line');
    setTimeout(() => line.classList.add('show'), 900);
    setTimeout(() => line.classList.remove('show'), 4600);
    setTimeout(() => { line.textContent = '在潮水回來之前，蓋一座屬於你的城堡。'; line.classList.add('show'); }, 5400);
    setTimeout(() => line.classList.remove('show'), 9200);
    $('#btn-skip').classList.add('show');
  }

  introEnd() {
    $('#intro-line').classList.remove('show');
    $('#btn-skip').classList.remove('show');
    $('#blackout').classList.remove('show', 'fade');
  }

  showTitleLogo() {
    const logo = $('#title-logo');
    logo.classList.add('show');
  }

  showMenu() {
    $('#hud').classList.remove('show');
    $('#title').classList.add('show');
    this.showTitleLogo();
    setTimeout(() => $('#menu').classList.add('show'), 150);
    const started = this.game.save.completed.length > 0 || this.game.save.unlocked > 1;
    $('#btn-start').querySelector('span').textContent = started ? '繼續旅程' : '開始旅程';
    this.refreshLevels();
  }

  hideTitle() {
    $('#title').classList.remove('show');
    $('#menu').classList.remove('show');
  }

  leaveToMenu() {
    $('#hud').classList.remove('show');
    this.game.backToMenu();
  }

  refreshLevels() {
    const s = this.game.save;
    document.querySelectorAll('.level-card').forEach((c, i) => {
      c.classList.toggle('locked', i + 1 > s.unlocked);
      c.classList.toggle('done', s.completed.includes(i + 1));
    });
  }

  openPanel(name) {
    this.closePanels(true);
    if (name === 'collection') this.renderCollection();
    if (name === 'levels') this.refreshLevels();
    $(`#panel-${name}`).classList.add('show');
    this.panelOpen = name;
  }

  closePanels(quiet) {
    for (const p of document.querySelectorAll('.panel')) p.classList.remove('show');
    this.panelOpen = null;
    if (!quiet) this.audio.sfx('click');
  }

  handleEscape() {
    if (this.panelOpen) this.closePanels();
    else if (this.game.state === 'paused') this.togglePause(false);
    else if ($('#help').classList.contains('show')) this.toggleHelp(false);
    else if ($('#treasure-modal').classList.contains('show')) $('#treasure-modal').classList.remove('show');
  }

  renderCollection() {
    const have = this.game.save.treasures;
    $('#collection-grid').innerHTML = TREASURES.map((t) => {
      const got = have.includes(t.id);
      return `<div class="tcard ${got ? 'got' : ''}">
        <img src="assets/treasures/${t.id}.png" alt=""/>
        <h4>${got ? t.name : '？？？'}</h4>
        <p>${got ? t.desc : '藏在某片沙灘底下……'}</p>
      </div>`;
    }).join('');
    $('#collection-count').textContent = `${have.length} / ${TREASURES.length}`;
  }

  // ---------- transitions ----------
  async fadeOut(level) {
    const f = $('#fader');
    $('#fader-title').textContent = level ? `第 ${level.id} 關 · ${level.name}` : '回到海灣…';
    $('#fader-sub').textContent = level ? level.en : '';
    f.classList.add('show');
    await wait(750);
  }

  async fadeIn() {
    await wait(250);
    $('#fader').classList.remove('show');
    await wait(500);
  }

  // ---------- HUD ----------
  showHUD(level) {
    $('#hud').classList.add('show');
    $('#lvl-num').textContent = level.id;
    $('#lvl-name').textContent = level.name;
    $('#lvl-en').textContent = level.en;
    $('#lvl-blurb').textContent = level.blurb;
    this.lastDone = undefined;
    const hasTide = level.goals.some((g) => g.type === 'tideFlag' || g.type === 'tideCrab');
    $('#tide-box').classList.toggle('featured', hasTide);
    this.selectTool(0, true);
    $('#brush-size').value = this.game.tools.radius;
    $('#brush-strength').value = this.game.tools.strength;
    this.updateBrushLabel();
    this.ensureThumbs();
    const tips = level.tips || [];
    $('#tip').textContent = tips[0] || '';
    this.tipIndex = 0;
    this.tipTimer = 9;
  }

  selectTool(i, quiet) {
    const t = TOOLS[i];
    if (!t) return;
    const again = this.game.tools.tool === t.id;
    this.toolIndex = i;
    this.game.tools.setTool(t.id);
    document.querySelectorAll('.tool').forEach((b, k) => b.classList.toggle('active', k === i));
    $('#tool-label').innerHTML = `<b>${t.name}</b><span>${t.hint}</span>`;
    if (t.id === 'sculpt') preloadSculptModels();
    // choosing a tool with a picker opens it; choosing it again folds it away
    for (const name of ['decor', 'sculpt']) {
      if (t.id === name) this.showPicker(name, !again || !$(`#${name}-palette`).classList.contains('show'));
      else this.hidePicker(name);
    }
    $('#brush-panel').classList.toggle('dim', t.id === 'decor' || t.id === 'flag');
    this.updateBrushLabel();
    if (!quiet) this.audio.sfx('tool');
  }

  // The decoration and sculpture pickers fold into a small chip once something
  // is chosen, so they don't cover the beach where the piece is going.
  showPicker(name, open) {
    const tools = this.game.tools;
    const pick = name === 'decor'
      ? document.querySelector(`.decor[data-decor="${tools.decorType}"]`)
      : document.querySelector(`.sculpt-pick[data-kind="${tools.sculptKind}"]`);
    if (pick) {
      for (const x of pick.parentElement.children) x.classList.toggle('active', x === pick);
      $(`#${name}-current .cur`).innerHTML = pick.innerHTML;
    }
    $(`#${name}-palette`).classList.toggle('show', open);
    $(`#${name}-current`).classList.toggle('show', !open);
  }

  hidePicker(name) {
    $(`#${name}-palette`).classList.remove('show');
    $(`#${name}-current`).classList.remove('show');
  }

  nudgeBrush(d) {
    const el = $('#brush-size');
    const v = Math.min(Number(el.max), Math.max(Number(el.min), this.game.tools.radius + d));
    el.value = v;
    this.game.tools.radius = v;
    this.updateBrushLabel();
  }

  updateBrushLabel() {
    const t = this.game.tools;
    const size = t.tool === 'carve' ? t.carveDims().width : t.tool === 'sculpt' ? t.sculptSize() : t.radius * 2;
    $('#brush-size-val').textContent = `${Math.round(size * 30)} 公分`;
    $('#brush-strength-val').textContent = `${Math.round(t.strength * 100)}%`;
  }

  renderGoals(list) {
    const el = $('#goal-list');
    if (!el) return;
    el.innerHTML = list.map((g) => `
      <li class="${g.done ? 'done' : ''}">
        <i class="check">${g.done ? '✓' : ''}</i>
        <div class="gtext">
          <span>${g.text}</span>
          ${g.done ? '' : `<em>${g.label || ''}</em>`}
          <div class="gbar"><div style="width:${Math.round(g.progress * 100)}%"></div></div>
        </div>
      </li>`).join('');
    const found = this.game.treasures.filter((t) => t.found).length;
    $('#treasure-count').textContent = `${found} / ${this.game.treasures.length}`;
    // collapsed header shows progress and pulses when a goal is ticked off
    const done = list.filter((g) => g.done).length;
    const counter = $('#goal-count');
    if (counter.textContent !== `${done}/${list.length}`) {
      const grew = this.lastDone !== undefined && done > this.lastDone;
      counter.textContent = `${done}/${list.length}`;
      if (grew) {
        const panel = $('#goal-panel');
        panel.classList.remove('pulse');
        void panel.offsetWidth;
        panel.classList.add('pulse');
      }
    }
    this.lastDone = done;
  }

  requestTide() {
    const g = this.game;
    if (g.state !== 'play') return;
    if (!g.goals.startTide()) return;
    $('#btn-tide').disabled = true;
  }

  update(dt) {
    const g = this.game;
    const goals = g.goals;
    const lvl = g.level;
    const range = Math.max(0.01, lvl.tide.high - lvl.tide.low);
    const frac = (g.sim.tide - lvl.tide.low) / range;
    $('#tide-fill').style.height = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
    const active = goals.tideActive;
    $('#tide-box').classList.toggle('active', active);
    if (!active) $('#btn-tide').disabled = false;
    const phase = goals.tide.phase;
    $('#tide-state').textContent = active ? (phase === 'rise' ? '漲潮中' : phase === 'peak' ? '滿潮' : '退潮中') : '低潮';
    $('#tide-prog').style.width = `${Math.round(goals.tideProgress() * 100)}%`;
    this.tipTimer -= dt;
    if (this.tipTimer <= 0 && lvl.tips && lvl.tips.length > 1) {
      this.tipIndex = (this.tipIndex + 1) % lvl.tips.length;
      const tip = $('#tip');
      tip.classList.add('swap');
      setTimeout(() => { tip.textContent = lvl.tips[this.tipIndex]; tip.classList.remove('swap'); }, 400);
      this.tipTimer = 10;
    }
  }

  // The mission window opens at the start of a level, folds itself away
  // after ~10 s, and reopens whenever the player clicks its header.
  levelBanner() {
    this.toggleMission(true);
  }

  toggleMission(force) {
    const panel = $('#goal-panel');
    const open = force === undefined ? panel.classList.contains('collapsed') : force;
    panel.classList.toggle('collapsed', !open);
    panel.classList.toggle('expanded', open);
    clearTimeout(this.missionTimer);
    if (open) this.scheduleCollapse();
  }

  scheduleCollapse() {
    clearTimeout(this.missionTimer);
    if (this.missionHover || !$('#goal-panel').classList.contains('expanded')) return;
    this.missionTimer = setTimeout(() => this.toggleMission(false), 10000);
  }

  toast(text, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = text;
    $('#toasts').appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 500);
    }, type === 'fail' ? 5200 : 3600);
  }

  toggleHelp(force) {
    const h = $('#help');
    const on = force === undefined ? !h.classList.contains('show') : force;
    h.classList.toggle('show', on);
  }

  togglePause(force) {
    const g = this.game;
    const p = $('#pause');
    const on = force === undefined ? !p.classList.contains('show') : force;
    if (on && g.state !== 'play') return;
    p.classList.toggle('show', on);
    g.state = on ? 'paused' : 'play';
    g.controls.enabled = !on;
    if (!on) this.closePanels(true);
  }

  showTreasure(info) {
    $('#treasure-img').src = `assets/treasures/${info.id}.png`;
    $('#treasure-name').textContent = info.name;
    $('#treasure-desc').textContent = info.desc;
    $('#treasure-modal').classList.add('show');
  }

  showComplete(level, stats) {
    $('#complete-img').style.backgroundImage = `url(${level.image})`;
    $('#complete-level').textContent = `第 ${level.id} 關 · ${level.name}`;
    $('#stat-towers').textContent = stats.towers;
    $('#stat-wall').textContent = `${(stats.wall * 0.3).toFixed(1)} m`;
    $('#stat-treasure').textContent = stats.treasures;
    $('#stat-decor').textContent = stats.decor;
    $('#btn-next').querySelector('span').textContent = stats.last ? '觀看結局' : '下一關';
    setTimeout(() => $('#complete-modal').classList.add('show'), 600);
  }

  hideComplete() {
    $('#complete-modal').classList.remove('show');
  }

  showEnding() {
    const g = this.game;
    g.state = 'ending';
    $('#hud').classList.remove('show');
    $('#ending').classList.add('show');
    g.audio.playMusic(4);
    g.audio.sfx('complete');
  }

  // ---------- decor thumbnails rendered from the real 3D models ----------
  ensureThumbs() {
    if (this.thumbsDone) return;
    this.thumbsDone = true;
    const renderer = this.game.renderer;
    const size = 128;
    const rt = new THREE.WebGLRenderTarget(size, size);
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x8a7055, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
    const buf = new Uint8Array(size * size * 4);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const prevClear = renderer.getClearAlpha();
    const prevTarget = renderer.getRenderTarget();
    renderer.setClearAlpha(0);
    for (const type of DECOR_LIST) {
      const obj = makeDecor(type, () => 0.3);
      obj.rotation.y = 0.6;
      scene.add(obj);
      const box = new THREE.Box3().setFromObject(obj);
      const c = box.getCenter(new THREE.Vector3());
      const r = box.getSize(new THREE.Vector3()).length() * 0.55;
      cam.position.set(c.x + r * 1.6, c.y + r * 2.0, c.z + r * 2.4);
      cam.lookAt(c);
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
      const img = ctx.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        img.data.set(buf.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
      }
      ctx.putImageData(img, 0, 0);
      const el = document.querySelector(`[data-thumb="${type}"]`);
      if (el) el.src = canvas.toDataURL();
      scene.remove(obj);
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearAlpha(prevClear);
    rt.dispose();
  }
}
