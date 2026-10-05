import * as THREE from 'three';
import { HALF } from '../core/config.js';
import { withFog } from './fog.js';
import { makeCrab } from './Props.js';

function makeGull() {
  const g = new THREE.Group();
  const white = withFog(new THREE.MeshStandardMaterial({ color: 0xf7f7f2, roughness: 0.8 }), 'gull');
  const grey = withFog(new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.8, side: THREE.DoubleSide }), 'gull-w');
  const beakM = withFog(new THREE.MeshStandardMaterial({ color: 0xf2b134, roughness: 0.5 }), 'gull-b');
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), white);
  body.scale.set(2.2, 0.85, 0.9);
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), white);
  head.position.set(0.48, 0.1, 0);
  g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.18, 6), beakM);
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(0.66, 0.08, 0);
  g.add(beak);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 4), white);
  tail.rotation.z = Math.PI / 2;
  tail.scale.set(1, 1, 0.3);
  tail.position.set(-0.55, 0.02, 0);
  g.add(tail);
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0); wingShape.lineTo(0.25, 0.5); wingShape.lineTo(0.05, 1.25); wingShape.lineTo(-0.25, 1.1); wingShape.lineTo(-0.2, 0);
  const wingGeo = new THREE.ShapeGeometry(wingShape);
  wingGeo.rotateX(Math.PI / 2);
  const wings = [];
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    const w = new THREE.Mesh(wingGeo, grey);
    w.scale.z = side;
    pivot.add(w);
    pivot.position.set(0.05, 0.08, side * 0.12);
    g.add(pivot);
    wings.push({ pivot, side });
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.wings = wings;
  return g;
}

export class Critters {
  constructor(scene) {
    this.scene = scene;
    this.gulls = [];
    for (let k = 0; k < 6; k++) {
      const g = makeGull();
      g.userData.orbit = {
        cx: (Math.random() - 0.5) * 40, cz: -10 - Math.random() * 40,
        r: 12 + Math.random() * 22, h: 9 + Math.random() * 9,
        speed: (0.12 + Math.random() * 0.1) * (Math.random() < 0.5 ? 1 : -1), phase: Math.random() * 6.28,
        flap: Math.random() * 6.28,
      };
      scene.add(g);
      this.gulls.push(g);
    }
    this.crabs = [];
  }

  setupCrabs(terrain, count, rand) {
    for (const c of this.crabs) this.scene.remove(c);
    this.crabs = [];
    for (let k = 0; k < count; k++) {
      const c = makeCrab([0xffe6cc, 0xf6d1b5, 0xe8d8ff][k % 3]);
      c.scale.setScalar(1.4 + rand() * 0.5);
      c.userData.state = { x: (rand() - 0.5) * 24, z: -2 + rand() * 14, dir: rand() * 6.28, speed: 0, timer: rand() * 3 };
      this.scene.add(c);
      this.crabs.push(c);
    }
    this.terrain = terrain;
  }

  update(dt, time, sim, cursor) {
    for (const g of this.gulls) {
      const o = g.userData.orbit;
      o.phase += o.speed * dt;
      const x = o.cx + Math.cos(o.phase) * o.r;
      const z = o.cz + Math.sin(o.phase) * o.r;
      const y = o.h + Math.sin(time * 0.4 + o.r) * 1.2;
      const nx = o.cx + Math.cos(o.phase + Math.sign(o.speed) * 0.05) * o.r;
      const nz = o.cz + Math.sin(o.phase + Math.sign(o.speed) * 0.05) * o.r;
      g.position.set(x, y, z);
      g.rotation.set(0, Math.atan2(-(nz - z), nx - x), -Math.sign(o.speed) * 0.25);
      // flap in bursts, then glide
      const gliding = Math.sin(time * 0.35 + o.r) > 0.2;
      o.flap += dt * (gliding ? 0 : 9);
      const a = gliding ? 0.12 : Math.sin(o.flap) * 0.65;
      for (const w of g.userData.wings) w.pivot.rotation.x = -w.side * a;
    }
    if (!this.terrain) return;
    const t = this.terrain;
    for (const c of this.crabs) {
      const s = c.userData.state;
      s.timer -= dt;
      const depth = sim.depthAt(s.x, s.z);
      let flee = false;
      if (cursor && Math.hypot(cursor.x - s.x, cursor.z - s.z) < 2.2) flee = true;
      if (s.timer <= 0 || depth > 0.01 || flee) {
        if (flee && cursor) s.dir = Math.atan2(s.z - cursor.z, s.x - cursor.x) + (Math.random() - 0.5) * 0.6;
        else if (depth > 0.01) s.dir = Math.PI / 2 + (Math.random() - 0.5); // walk inland, away from the sea
        else s.dir += (Math.random() - 0.5) * 2.5;
        s.speed = flee || depth > 0.01 ? 1.6 : Math.random() < 0.45 ? 0 : 0.35 + Math.random() * 0.35;
        s.timer = flee ? 0.6 : 1.5 + Math.random() * 3;
      }
      // hermit crabs walk sideways, and won't climb up sand castles
      const nx = s.x + Math.cos(s.dir) * s.speed * dt;
      const nz = s.z + Math.sin(s.dir) * s.speed * dt;
      const rise = t.heightAt(nx + Math.cos(s.dir) * 0.25, nz + Math.sin(s.dir) * 0.25) - t.heightAt(s.x, s.z);
      if (rise > 0.12 && !flee) { s.dir += Math.PI * (0.6 + Math.random() * 0.8); s.timer = 1; }
      else { s.x = nx; s.z = nz; }
      if (t.heightAt(s.x, s.z) - t.originalAt(s.x, s.z) > 0.35) { s.dir += 0.05; s.speed = Math.max(s.speed, 0.8); }
      const lim = HALF - 2;
      if (Math.abs(s.x) > lim || Math.abs(s.z) > lim) {
        s.x = Math.max(-lim, Math.min(lim, s.x));
        s.z = Math.max(-lim, Math.min(lim, s.z));
        s.dir += Math.PI;
      }
      c.position.set(s.x, t.heightAt(s.x, s.z), s.z);
      c.rotation.y = -s.dir + Math.PI / 2;
      const walk = s.speed > 0 ? time * 18 * s.speed : 0;
      c.userData.legs.forEach((leg, i) => {
        leg.rotation.z = Math.sin(walk + i * 1.7) * 0.4;
      });
    }
  }
}
