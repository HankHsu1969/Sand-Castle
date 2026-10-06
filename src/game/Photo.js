import * as THREE from 'three';
import { HALF, N, S } from '../core/config.js';
import { LEVELS } from '../world/levels.js';
import POSE_PX from './photo-poses.json';

// Photo mode: 珊珊, a cartoon beachgoer, poses next to the player's castle or
// sculpture; the shot comes out as a polaroid shown on screen (and can be saved).
// She wears a different swimsuit on each beach (assets/img/photo/l1 … l5).

const POSES = [
  { name: '比 YA' },
  { name: '揮手' },
  { name: '指著作品', pointsLeft: true },
  { name: '蹲下比心' },
];
const UNITS_PER_PX = 5.2 / 1292; // about 1.55 m tall, hat included
const poseFile = (outfit, i) => `assets/img/photo/${outfit}/pose${i}.png`;
const $ = (s) => document.querySelector(s);

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  r.addColorStop(0, 'rgba(0,0,0,0.55)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export class PhotoMode {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.pose = 0;
    this.side = 1; // which side of the work she stands on, as seen from the camera
    this.outfit = 'l1';
    this.textureSets = {}; // outfit → pose textures
    this.wantShot = false;
    this.busy = false;
    this.photoURL = null;

    // the visible cut-out; its normals lean up and toward the camera so the sky
    // and sun light her the way they light the beach
    const geo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const nrm = geo.attributes.normal;
    for (let k = 0; k < nrm.count; k++) nrm.setXYZ(k, 0, 0.55, 0.835);
    this.mat = new THREE.MeshLambertMaterial({ alphaTest: 0.4, side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0.32 });
    this.person = new THREE.Mesh(geo, this.mat);
    // an invisible twin turned toward the sun casts her shadow on the sand
    // (its map + alphaTest make three cut the shadow to her silhouette)
    this.caster = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, alphaTest: 0.5, side: THREE.DoubleSide }));
    this.caster.castShadow = true;
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, color: 0x000000 }));
    this.group = new THREE.Group();
    this.group.add(this.person, this.caster, this.blob);
    this.group.visible = false;
    game.scene.add(this.group);
    this.bindUI();
  }

  get textures() { return this.textureSets[this.outfit]; }

  // this beach's swimsuit
  useOutfit() {
    const i = LEVELS.indexOf(this.game.level);
    this.outfit = POSE_PX[`l${i + 1}`] ? `l${i + 1}` : 'l1';
    if (!this.textureSets[this.outfit]) {
      const tl = new THREE.TextureLoader();
      const outfit = this.outfit;
      this.textureSets[outfit] = POSES.map((p, k) => {
        const t = tl.load(poseFile(outfit, k), () => { if (this.outfit === outfit) this.applyPose(); });
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        return t;
      });
    }
    document.querySelectorAll('.photo-pose img').forEach((img, k) => { img.src = poseFile(this.outfit, k); });
  }

  // ---------- UI ----------
  bindUI() {
    $('#photo-poses').innerHTML = POSES.map((p, i) => `
      <button class="photo-pose${i === 0 ? ' active' : ''}" data-pose="${i}" title="${p.name}">
        <img src="${poseFile('l1', i)}" alt="" /><span>${p.name}</span>
      </button>`).join('');
    $('#photo-poses').addEventListener('click', (e) => {
      const b = e.target.closest('.photo-pose');
      if (b) this.setPose(Number(b.dataset.pose));
    });
    $('#btn-photo-side').onclick = () => { this.side = -this.side; this.place(false); this.game.audio.sfx('tool'); };
    $('#btn-photo-shoot').onclick = () => this.shoot();
    $('#btn-photo-exit').onclick = () => this.exit();
    $('#btn-photo-again').onclick = () => this.closeResult();
    $('#btn-photo-done').onclick = () => { this.closeResult(); this.exit(); };
  }

  setPose(i) {
    this.pose = i;
    document.querySelectorAll('.photo-pose').forEach((b, k) => b.classList.toggle('active', k === i));
    this.applyPose();
    this.place(false);
    this.game.audio.sfx('tool');
  }

  // ---------- entering & leaving ----------
  enter() {
    const g = this.game;
    if (this.active || g.state !== 'play') return;
    this.useOutfit();
    g.tools.end();
    this.active = true;
    g.state = 'photo';
    $('#hud').classList.remove('show');
    $('#ui').classList.add('photo-mode');
    $('#photo-bar').classList.add('show');
    this.subject = this.findSubject();
    this.place(true);
    this.group.visible = true;
    g.audio.sfx('sparkle');
  }

  exit() {
    const g = this.game;
    if (!this.active) return;
    this.closeResult();
    this.active = false;
    this.group.visible = false;
    $('#photo-bar').classList.remove('show');
    $('#ui').classList.remove('photo-mode');
    g.state = 'play';
    $('#hud').classList.add('show');
  }

  // What the player is looking at: the castle or sculpture around the view's
  // centre — its middle, how far it reaches sideways and how tall it is.
  findSubject() {
    const g = this.game, t = g.terrain, c = g.controls.target;
    const right = this.rightVector();
    let sw = 0, sx = 0, sz = 0;
    const cells = [];
    const R = 4.5;
    const i0 = Math.max(0, Math.floor((c.x - R + HALF) / S)), i1 = Math.min(N - 1, Math.ceil((c.x + R + HALF) / S));
    const j0 = Math.max(0, Math.floor((c.z - R + HALF) / S)), j1 = Math.min(N - 1, Math.ceil((c.z + R + HALF) / S));
    for (let j = j0; j <= j1; j += 2) {
      for (let i = i0; i <= i1; i += 2) {
        const k = j * N + i, x = -HALF + i * S, z = -HALF + j * S;
        if (Math.hypot(x - c.x, z - c.z) > R) continue;
        const rise = Math.max(t.h[k], t.solid[k]) - t.h0[k];
        if (rise < 0.2) continue;
        cells.push([x, z, rise]);
        sw += rise; sx += x * rise; sz += z * rise;
      }
    }
    if (!sw) return { x: c.x, z: c.z, reach: 0.6, height: 0.5 };
    const cx = sx / sw, cz = sz / sw;
    let reach = 0, height = 0;
    for (const [x, z, rise] of cells) {
      reach = Math.max(reach, Math.abs((x - cx) * right.x + (z - cz) * right.z));
      height = Math.max(height, rise);
    }
    return { x: cx, z: cz, reach, height };
  }

  rightVector() {
    const g = this.game;
    const d = new THREE.Vector3().subVectors(g.controls.target, g.camera.position);
    d.y = 0;
    if (d.lengthSq() < 1e-6) d.set(0, 0, -1);
    d.normalize();
    return new THREE.Vector3(-d.z, 0, d.x);
  }

  poseSize() {
    const tex = this.textures && this.textures[this.pose];
    const h = POSE_PX[this.outfit][this.pose] * UNITS_PER_PX;
    const aspect = tex && tex.image ? tex.image.width / tex.image.height : 0.4;
    return { w: h * aspect, h };
  }

  applyPose() {
    if (!this.textures) return;
    const tex = this.textures[this.pose];
    this.mat.map = tex;
    this.mat.emissiveMap = tex;
    this.mat.needsUpdate = true;
    this.caster.material.map = tex;
    this.caster.material.needsUpdate = true;
    const { w, h } = this.poseSize();
    // pointing poses point at the work, whichever side she is on
    const flip = POSES[this.pose].pointsLeft && this.side < 0 ? -1 : 1;
    this.person.scale.set(w * flip, h, 1);
    this.caster.scale.set(w * flip, h, 1);
    this.blob.scale.set(Math.min(w, 1.6) * 1.1, 1, 0.9);
  }

  // Stand her beside the work on open sand, a little toward the camera, and
  // (on entering) frame the two of them.
  place(frame) {
    const g = this.game, t = g.terrain, s = this.subject;
    const right = this.rightVector();
    const fwd = new THREE.Vector3(right.z, 0, -right.x); // away from the camera
    this.applyPose();
    const { w, h } = this.poseSize();
    const free = (x, z) => {
      if (!t.inside(x, z, 1)) return false;
      const i = Math.round((x + HALF) / S), j = Math.round((z + HALF) / S), k = j * N + i;
      return Math.max(t.h[k], t.solid[k]) - t.h0[k] < 0.25 && g.sim.depthAt(x, z) < 0.08;
    };
    const spot = (side) => {
      for (let step = 0; step < 14; step++) {
        const d = s.reach + w * 0.45 + 0.5 + step * 0.35;
        const x = s.x + right.x * side * d - fwd.x * 0.5, z = s.z + right.z * side * d - fwd.z * 0.5;
        if (free(x, z) && free(x + right.x * side * w * 0.3, z + right.z * side * w * 0.3)) return [x, z];
      }
      return null;
    };
    let p = spot(this.side);
    if (!p) { p = spot(-this.side); if (p) { this.side = -this.side; this.applyPose(); } }
    if (!p) p = [s.x + right.x * this.side * (s.reach + 1.5), s.z + right.z * this.side * (s.reach + 1.5)];
    const y = t.heightAt(p[0], p[1]);
    this.group.position.set(p[0], y - 0.03, p[1]);
    this.blob.position.y = 0.05;
    if (!frame) return;
    // frame the work and her together, keeping the current direction of view
    const mid = new THREE.Vector3((s.x + p[0]) / 2, 0, (s.z + p[1]) / 2);
    const span = Math.hypot(s.x - p[0], s.z - p[1]) + s.reach + w;
    const tall = Math.max(h, s.height + 0.5);
    mid.y = y + tall * 0.45;
    const dist = Math.max(span * 1.25, tall * 1.7, 6);
    const back = fwd.clone().multiplyScalar(-dist);
    g.controls.target.copy(mid);
    g.camera.position.set(mid.x + back.x, mid.y + dist * 0.2, mid.z + back.z);
    g.controls.update();
  }

  update() {
    if (!this.active) return;
    const g = this.game, p = this.group.position, cam = g.camera.position;
    this.person.rotation.y = Math.atan2(cam.x - p.x, cam.z - p.z);
    const sun = g.env.sunDir;
    this.caster.rotation.y = Math.atan2(sun.x, sun.z);
  }

  // ---------- shooting ----------
  shoot() {
    if (!this.active || this.busy || $('#photo-modal').classList.contains('show')) return;
    this.busy = true;
    this.wantShot = true; // grabbed straight after the next frame is drawn
    this.game.audio.sfx('shutter');
    const f = $('#photo-flash');
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }

  // Called right after rendering, while the frame is still in the drawing buffer.
  afterRender() {
    if (!this.wantShot) return;
    this.wantShot = false;
    const src = this.game.renderer.domElement;
    const shot = document.createElement('canvas');
    shot.width = src.width;
    shot.height = src.height;
    shot.getContext('2d').drawImage(src, 0, 0);
    this.compose(shot).then((canvas) => {
      this.photoURL = canvas.toDataURL('image/jpeg', 0.88);
      this.showResult();
    }).finally(() => { this.busy = false; });
  }

  async compose(shot) {
    const level = this.game.level;
    try { await document.fonts.load('700 52px "LXGW WenKai TC"'); } catch { /* fallback font */ }
    const W = 1600, ph = Math.round((W * shot.height) / shot.width);
    const B = 44, BOT = 176;
    const c = document.createElement('canvas');
    c.width = W + B * 2;
    c.height = ph + B + BOT;
    const g = c.getContext('2d');
    g.fillStyle = '#fbf7ee';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(shot, B, B, W, ph);
    g.strokeStyle = 'rgba(80, 60, 40, 0.15)';
    g.lineWidth = 2;
    g.strokeRect(B, B, W, ph);
    const emblem = await new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = 'assets/icons/emblem.png';
    });
    const cy = ph + B + BOT / 2 + 4;
    let x = B + 6;
    if (emblem) { g.drawImage(emblem, x, cy - 52, 104, 104); x += 122; }
    g.fillStyle = '#4b3a28';
    g.textBaseline = 'middle';
    g.font = '700 52px "LXGW WenKai TC", "Noto Sans TC", sans-serif';
    g.fillText(`沙堡物語 · ${level ? level.name : ''}`, x, cy - 18);
    g.fillStyle = '#8a7358';
    g.font = '400 30px "LXGW WenKai TC", "Noto Sans TC", sans-serif';
    g.fillText('和珊珊在沙雕前的合照', x, cy + 34);
    const d = new Date();
    const date = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    g.font = '600 40px Fredoka, sans-serif';
    g.fillStyle = '#c0703f';
    g.textAlign = 'right';
    g.fillText(date, c.width - B - 6, cy);
    return c;
  }

  showResult() {
    $('#photo-img').src = this.photoURL;
    const a = $('#btn-photo-save');
    a.href = this.photoURL;
    a.download = `sandcastle-${Date.now()}.jpg`;
    $('#photo-modal').classList.add('show');
    $('#photo-bar').classList.remove('show');
  }

  closeResult() {
    if (!$('#photo-modal').classList.contains('show')) return;
    $('#photo-modal').classList.remove('show');
    if (this.active) $('#photo-bar').classList.add('show');
  }
}
