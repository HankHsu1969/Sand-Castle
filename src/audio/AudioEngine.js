// Everything audible is synthesized at runtime with the Web Audio API:
// a generative "beach lounge" score, ocean ambience and sound effects.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Chord progressions per track (MIDI notes) plus melody scale and tempo.
const TRACKS = {
  title: { bpm: 66, key: 55, chords: [[43, 55, 59, 62, 66], [40, 52, 55, 59, 66], [36, 52, 55, 59, 64], [38, 54, 57, 62, 64]], scale: [0, 2, 4, 7, 9], bright: 0.5 },
  0: { bpm: 64, key: 62, chords: [[38, 54, 57, 61, 64], [35, 50, 54, 57, 62], [43, 55, 59, 62, 66], [45, 52, 57, 61, 64]], scale: [0, 2, 4, 7, 9], bright: 0.45 },
  1: { bpm: 74, key: 64, chords: [[40, 56, 59, 63, 66], [37, 52, 56, 59, 63], [45, 56, 61, 64, 68], [47, 54, 59, 63, 68]], scale: [0, 2, 4, 7, 9], bright: 0.7 },
  2: { bpm: 70, key: 60, chords: [[36, 52, 55, 59, 62], [41, 53, 57, 60, 64], [45, 55, 60, 64, 67], [43, 55, 59, 62, 64]], scale: [0, 2, 4, 6, 7, 9], bright: 0.6 },
  3: { bpm: 68, key: 57, chords: [[45, 56, 61, 64, 68], [42, 54, 57, 61, 64], [38, 54, 57, 61, 66], [40, 52, 56, 59, 62]], scale: [0, 2, 4, 7, 9], bright: 0.55 },
  4: { bpm: 60, key: 65, chords: [[41, 57, 60, 64, 67], [38, 53, 57, 60, 64], [46, 57, 62, 65, 69], [48, 55, 58, 62, 65]], scale: [0, 2, 4, 7, 9], bright: 0.4 },
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.vol = { music: 0.7, sfx: 0.8, ambience: 0.7 };
    try {
      const saved = JSON.parse(localStorage.getItem('sandcastle.volume') || 'null');
      if (saved) Object.assign(this.vol, saved);
    } catch { /* storage unavailable */ }
    this.track = null;
    this.brushActive = false;
    this.brushKind = 'raise';
    this.nextGrain = 0;
    this.ksCache = new Map();
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createDynamicsCompressor();
    this.master.threshold.value = -14;
    this.master.ratio.value = 3;
    this.master.connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    for (const b of [this.musicBus, this.sfxBus, this.ambBus]) b.connect(this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.6, 2.4);
    this.reverbOut = ctx.createGain();
    this.reverbOut.gain.value = 0.9;
    this.reverb.connect(this.reverbOut).connect(this.master);

    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2400;
    this.delay.connect(dl).connect(fb).connect(this.delay);
    this.delayOut = ctx.createGain();
    this.delayOut.gain.value = 0.35;
    dl.connect(this.delayOut).connect(this.musicBus);
    this.delayOut.connect(this.reverb);

    this.noiseBuf = this.makeNoise(3);
    this.applyVolumes();
    this.startAmbience();
    this.schedTimer = setInterval(() => this.schedule(), 60);
    if (this.pendingTrack != null) this.playMusic(this.pendingTrack);
  }

  get running() { return !!this.ctx && this.ctx.state === 'running'; }

  resume() {
    if (!this.ctx) this.start();
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.55, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx * 0.9, t, 0.05);
    this.ambBus.gain.setTargetAtTime(this.vol.ambience * 0.75, t, 0.1);
  }

  setVolume(kind, v) {
    this.vol[kind] = v;
    try { localStorage.setItem('sandcastle.volume', JSON.stringify(this.vol)); } catch { /* ignore */ }
    this.applyVolumes();
  }

  makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (t < 0.01 ? t / 0.01 : 1);
      }
    }
    return buf;
  }

  // Karplus–Strong plucked string rendered into a buffer (cached per pitch).
  pluckBuffer(midi) {
    if (this.ksCache.has(midi)) return this.ksCache.get(midi);
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * 2.4);
    const buf = this.ctx.createBuffer(1, len, rate);
    const out = buf.getChannelData(0);
    const period = Math.round(rate / mtof(midi));
    const ring = new Float32Array(period);
    for (let i = 0; i < period; i++) ring[i] = (Math.random() * 2 - 1) * 0.6 + (i < period / 2 ? 0.2 : -0.2);
    let idx = 0, prev = 0;
    const damp = 0.4965 + Math.min(0.0028, midi * 0.00002);
    for (let i = 0; i < len; i++) {
      const cur = ring[idx];
      const nxt = ring[(idx + 1) % period];
      const v = (cur + nxt) * damp;
      ring[idx] = v * 0.7 + prev * 0.3;
      prev = v;
      out[i] = cur;
      idx = (idx + 1) % period;
    }
    this.ksCache.set(midi, buf);
    return buf;
  }

  // ---------------- music ----------------
  playMusic(id) {
    if (!this.ctx) { this.pendingTrack = id; return; }
    if (this.track && this.track.id === id) return;
    const t = this.ctx.currentTime;
    if (this.musicGain) {
      const old = this.musicGain;
      old.gain.setTargetAtTime(0, t, 0.8);
      setTimeout(() => old.disconnect(), 4000);
    }
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.gain.setTargetAtTime(1, t + 0.3, 1.2);
    this.musicGain.connect(this.musicBus);
    this.musicSend = this.ctx.createGain();
    this.musicSend.gain.value = 0.55;
    this.musicGain.connect(this.musicSend).connect(this.reverb);
    const def = TRACKS[id] || TRACKS.title;
    this.track = { id, def, beat: 0, next: t + 0.4, melodyNote: 2, bar: 0 };
  }

  schedule() {
    if (!this.ctx || !this.track) return;
    const ahead = this.ctx.currentTime + 0.25;
    const tr = this.track;
    const spb = 60 / tr.def.bpm / 2; // eighth notes
    while (tr.next < ahead) {
      this.playStep(tr, tr.next, spb);
      tr.next += spb * (tr.beat % 2 === 0 ? 1.08 : 0.92); // gentle swing
      tr.beat++;
    }
  }

  playStep(tr, t, spb) {
    const def = tr.def;
    const stepsPerChord = 16; // two bars of eighths
    const ci = Math.floor(tr.beat / stepsPerChord) % def.chords.length;
    const chord = def.chords[ci];
    const pos = tr.beat % stepsPerChord;
    if (pos === 0) {
      this.pad(chord.slice(1), t, spb * stepsPerChord * 1.05);
      this.bass(chord[0], t, spb * 7);
      this.strum(chord.slice(1), t + 0.02, 0.16);
    }
    if (pos === 8) this.bass(chord[0] + 7, t, spb * 6, 0.5);
    // guitar comping on some off-beats
    if ((pos === 6 || pos === 11) && Math.random() < 0.6) this.strum(chord.slice(2), t, 0.08);
    // kalimba melody: random walk on the pentatonic scale
    const density = 0.3 + def.bright * 0.25;
    if (pos % 2 === 0 ? Math.random() < density : Math.random() < density * 0.45) {
      const sc = def.scale;
      tr.melodyNote = Math.max(0, Math.min(sc.length * 2 - 1, tr.melodyNote + Math.round((Math.random() - 0.5) * 3.2)));
      const oct = Math.floor(tr.melodyNote / sc.length);
      const midi = def.key + 12 + oct * 12 + sc[tr.melodyNote % sc.length];
      this.kalimba(midi, t, 0.16 + Math.random() * 0.08);
    }
    // soft shaker
    if (def.bright > 0.5 && pos % 2 === 1) this.shaker(t, 0.02 + (pos % 4 === 3 ? 0.015 : 0));
  }

  pad(notes, t, dur) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.055, t + 2.2);
    out.gain.setValueAtTime(0.055, t + dur - 2.5);
    out.gain.linearRampToValueAtTime(0, t + dur + 1.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(1100, t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(600, t + dur);
    lp.connect(out).connect(this.musicGain);
    for (const n of notes) {
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = det < 0 ? 'sawtooth' : 'triangle';
        o.frequency.value = mtof(n);
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.value = det < 0 ? 0.35 : 0.8;
        o.connect(g).connect(lp);
        o.start(t);
        o.stop(t + dur + 2);
      }
    }
  }

  bass(n, t, dur, vel = 1) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = mtof(n);
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = mtof(n);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16 * vel, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.musicGain);
    o.start(t); o2.start(t);
    o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
  }

  strum(notes, t, vel) {
    notes.forEach((n, i) => this.pluck(n, t + i * 0.035, vel * (1 - i * 0.08)));
  }

  pluck(midi, t, vel, bus) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.pluckBuffer(midi);
    const g = ctx.createGain();
    g.gain.value = vel;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 0.6;
    src.connect(lp).connect(g).connect(pan).connect(bus || this.musicGain);
    src.start(t);
  }

  kalimba(midi, t, vel, bus) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 1.8);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 4.07;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.25, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 0.8;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(pan).connect(bus || this.musicGain);
    if (!bus) pan.connect(this.delay);
    o.start(t); o2.start(t);
    o.stop(t + 2); o2.stop(t + 0.4);
  }

  shaker(t, vel) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    src.connect(hp).connect(g).connect(this.musicGain);
    src.start(t, Math.random() * 2, 0.12);
  }

  // ---------------- ambience ----------------
  // Real ocean recordings (ElevenLabs Sound Effects) — two seamless surf loops
  // layered out of phase, plus occasional single wave washes and gulls.
  async loadSamples() {
    const files = {
      ocean: 'assets/audio/ocean_loop.wav',
      ocean2: 'assets/audio/ocean_loop2.wav',
      wash1: 'assets/audio/wash1.mp3',
      wash2: 'assets/audio/wash2.mp3',
      gulls1: 'assets/audio/gulls1.mp3',
      gulls2: 'assets/audio/gulls2.mp3',
      scoop1: 'assets/audio/scoop1.mp3',
      scoop2: 'assets/audio/scoop2.mp3',
    };
    this.samples = {};
    await Promise.all(Object.entries(files).map(async ([key, url]) => {
      try {
        const res = await fetch(url);
        this.samples[key] = await this.ctx.decodeAudioData(await res.arrayBuffer());
      } catch (e) {
        console.warn('audio sample failed', key, e);
      }
    }));
    this.startOceanLoops();
  }

  startAmbience() {
    const ctx = this.ctx;
    this.oceanFilter = ctx.createBiquadFilter();
    this.oceanFilter.type = 'lowpass';
    this.oceanFilter.frequency.value = 9000;
    this.oceanGain = ctx.createGain();
    this.oceanGain.gain.value = 0;
    this.oceanFilter.connect(this.oceanGain).connect(this.ambBus);
    this.tideIntensity = 0;
    this.nextWash = ctx.currentTime + 6 + Math.random() * 6;
    this.nextGull = ctx.currentTime + 7 + Math.random() * 8;
    this.ambTimer = setInterval(() => this.ambienceTick(), 250);
    this.loadSamples();
  }

  startOceanLoops() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const layer = (buf, gain, offset) => {
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(g).connect(this.oceanFilter);
      src.start(t + 0.05, offset % buf.duration);
    };
    layer(this.samples.ocean, 1.0, 0);
    layer(this.samples.ocean2, 0.55, 11);
    this.oceanGain.gain.setTargetAtTime(0.85, t, 1.5);
  }

  setWavePeriod() { /* the recorded surf keeps its own natural rhythm */ }

  // 0 = calm low tide, 1 = high tide crashing in
  setTideIntensity(x) {
    if (!this.ctx || !this.oceanGain) return;
    const v = Math.max(0, Math.min(1, x));
    if (Math.abs(v - this.tideIntensity) < 0.02) return;
    this.tideIntensity = v;
    const t = this.ctx.currentTime;
    this.oceanGain.gain.setTargetAtTime(0.85 + v * 0.55, t, 0.8);
    this.oceanFilter.frequency.setTargetAtTime(9000 + v * 7000, t, 0.8);
  }

  playSample(key, { gain = 1, rate = 1, pan = 0, offset = 0, duration, bus, when, fadeOut = 0 } = {}) {
    const buf = this.samples && this.samples[key];
    if (!this.ctx || !buf) return null;
    const ctx = this.ctx;
    const t = when ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(g).connect(p).connect(bus || this.sfxBus);
    const dur = duration ?? (buf.duration - offset) / rate;
    if (fadeOut > 0) {
      g.gain.setValueAtTime(gain, t + Math.max(0, dur - fadeOut));
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
    }
    src.start(t, offset, dur * rate);
    return src;
  }

  ambienceTick() {
    const t = this.ctx.currentTime;
    const tide = this.tideIntensity || 0;
    if (t > this.nextWash) {
      const key = Math.random() < 0.5 ? 'wash1' : 'wash2';
      this.playSample(key, { gain: 0.16 + tide * 0.4 + Math.random() * 0.08, rate: 0.92 + Math.random() * 0.14, pan: (Math.random() - 0.5) * 0.9, bus: this.ambBus });
      this.nextWash = t + (tide > 0.2 ? 3.5 + Math.random() * 3 : 11 + Math.random() * 9);
    }
    if (t > this.nextGull) {
      const key = Math.random() < 0.5 ? 'gulls1' : 'gulls2';
      this.playSample(key, { gain: 0.32 + Math.random() * 0.15, rate: 0.95 + Math.random() * 0.1, pan: (Math.random() - 0.5) * 1.4, bus: this.ambBus });
      this.nextGull = t + 16 + Math.random() * 22;
    }
  }

  // ---------------- sound effects ----------------
  noiseHit(t, { type = 'bandpass', freq = 2000, q = 1, dur = 0.1, vel = 0.2, sweepTo = null, attack = 0.005 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random() * 2, dur + 0.05);
    return g;
  }

  tone(t, { freq, type = 'sine', dur = 0.3, vel = 0.2, glideTo = null, attack = 0.005, reverb = 0.3 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus);
    if (reverb > 0) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      g.connect(s).connect(this.reverb);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // continuous brushing sound, driven every frame by the tool code
  brush(active, kind = 'raise', wet = 0) {
    this.brushActive = active;
    this.brushKind = kind;
    if (!this.ctx || !active) return;
    const t = this.ctx.currentTime;
    if (t < this.nextGrain) return;
    const dig = kind === 'dig' || kind === 'channel';
    const smooth = kind === 'smooth' || kind === 'flatten';
    if (this.samples && this.samples.scoop1) {
      const key = Math.random() < 0.5 ? 'scoop1' : 'scoop2';
      const rate = smooth ? 0.7 + Math.random() * 0.1 : dig ? 0.85 + Math.random() * 0.2 : 1.0 + Math.random() * 0.25 - wet * 0.1;
      this.playSample(key, { gain: smooth ? 0.22 : 0.42, rate, pan: (Math.random() - 0.5) * 0.4, duration: smooth ? 0.5 : 0.38, fadeOut: 0.12 });
      this.nextGrain = t + (smooth ? 0.3 : 0.17) + Math.random() * 0.08;
      return;
    }
    this.noiseHit(t, {
      freq: smooth ? 1600 : dig ? 1100 + Math.random() * 500 : 2200 + Math.random() * 900 - wet * 900,
      q: 0.9, dur: smooth ? 0.16 : 0.09, vel: smooth ? 0.05 : 0.09, attack: 0.012,
    });
    this.nextGrain = t + (smooth ? 0.12 : 0.07) + Math.random() * 0.05;
  }

  sfx(name) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.01;
    switch (name) {
      case 'thump':
        this.tone(t, { freq: 150, glideTo: 48, dur: 0.32, vel: 0.5, reverb: 0.1 });
        this.noiseHit(t, { type: 'lowpass', freq: 900, sweepTo: 200, dur: 0.35, vel: 0.25 });
        this.noiseHit(t + 0.05, { freq: 3000, dur: 0.25, vel: 0.05, attack: 0.03 });
        break;
      case 'pat':
        this.tone(t, { freq: 110, glideTo: 60, dur: 0.18, vel: 0.25, reverb: 0 });
        this.noiseHit(t, { type: 'lowpass', freq: 700, dur: 0.15, vel: 0.12 });
        break;
      case 'shell':
        this.tone(t, { freq: 2350, dur: 0.18, vel: 0.08, reverb: 0.4 });
        this.tone(t + 0.045, { freq: 3520, dur: 0.22, vel: 0.06, reverb: 0.4 });
        this.noiseHit(t, { freq: 4000, dur: 0.05, vel: 0.05 });
        break;
      case 'wood':
        this.tone(t, { freq: 320, type: 'triangle', glideTo: 250, dur: 0.14, vel: 0.22, reverb: 0.1 });
        this.noiseHit(t, { freq: 1800, dur: 0.04, vel: 0.08 });
        break;
      case 'soft':
        this.noiseHit(t, { type: 'lowpass', freq: 900, dur: 0.12, vel: 0.12 });
        this.tone(t, { freq: 420, glideTo: 380, dur: 0.12, vel: 0.06, reverb: 0.1 });
        break;
      case 'flag':
        for (let k = 0; k < 5; k++) this.noiseHit(t + k * 0.05, { freq: 900 + k * 120, q: 2, dur: 0.06, vel: 0.06 });
        this.tone(t, { freq: 660, dur: 0.15, vel: 0.06 });
        this.tone(t + 0.08, { freq: 990, dur: 0.25, vel: 0.06 });
        break;
      case 'remove':
        this.tone(t, { freq: 700, glideTo: 300, dur: 0.15, vel: 0.1 });
        break;
      case 'undo':
        this.tone(t, { freq: 520, glideTo: 780, dur: 0.12, vel: 0.07, type: 'triangle' });
        break;
      case 'click':
        this.tone(t, { freq: 1200, dur: 0.05, vel: 0.06, reverb: 0 });
        break;
      case 'hover':
        this.tone(t, { freq: 1800, dur: 0.03, vel: 0.025, reverb: 0 });
        break;
      case 'tool':
        this.kalimba(84, t, 0.12, this.sfxBus);
        break;
      case 'whoosh':
        this.noiseHit(t, { freq: 400, sweepTo: 3000, q: 1.2, dur: 0.9, vel: 0.12, attack: 0.4 });
        break;
      case 'splash':
        if (!this.playSample(Math.random() < 0.5 ? 'wash1' : 'wash2', { gain: 0.7, rate: 1.1, offset: 0.4, duration: 2.2, fadeOut: 0.8 })) {
          this.noiseHit(t, { type: 'lowpass', freq: 3500, sweepTo: 300, dur: 0.8, vel: 0.25, attack: 0.01 });
        }
        break;
      case 'sparkle':
        [88, 91, 95, 100].forEach((m, i) => this.kalimba(m, t + i * 0.06, 0.05, this.sfxBus));
        break;
      case 'treasure': {
        [72, 76, 79, 84, 88, 91].forEach((m, i) => this.kalimba(m, t + i * 0.09, 0.18, this.sfxBus));
        this.noiseHit(t + 0.2, { type: 'highpass', freq: 7000, dur: 1.4, vel: 0.05, attack: 0.3 });
        this.tone(t, { freq: mtof(60), dur: 1.6, vel: 0.08, attack: 0.1, reverb: 0.6 });
        break;
      }
      case 'goal':
        this.kalimba(79, t, 0.2, this.sfxBus);
        this.kalimba(84, t + 0.12, 0.2, this.sfxBus);
        this.kalimba(91, t + 0.24, 0.12, this.sfxBus);
        break;
      case 'complete': {
        [60, 64, 67, 72, 76, 79, 84].forEach((m, i) => this.kalimba(m, t + i * 0.11, 0.18, this.sfxBus));
        [48, 55, 64, 67, 71].forEach((m) => this.tone(t, { freq: mtof(m), type: 'triangle', dur: 3.5, vel: 0.05, attack: 0.6, reverb: 0.8 }));
        [60, 64, 67, 72].forEach((m, i) => this.pluck(m, t + 0.9 + i * 0.05, 0.25, this.sfxBus));
        break;
      }
      case 'conch': {
        const ctx = this.ctx;
        for (const [m, v] of [[43, 0.16], [55, 0.07], [62, 0.03]]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(mtof(m) * 0.97, t);
          o.frequency.linearRampToValueAtTime(mtof(m), t + 0.4);
          const vib = ctx.createOscillator();
          vib.frequency.value = 5;
          const vg = ctx.createGain();
          vg.gain.value = 2.5;
          vib.connect(vg).connect(o.frequency);
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 800;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(v, t + 0.35);
          g.gain.setValueAtTime(v, t + 1.5);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
          o.connect(lp).connect(g).connect(this.sfxBus);
          g.connect(this.reverb);
          o.start(t); vib.start(t);
          o.stop(t + 2.7); vib.stop(t + 2.7);
        }
        break;
      }
      case 'fail':
        [67, 64, 60, 55].forEach((m, i) => this.kalimba(m, t + i * 0.18, 0.14, this.sfxBus));
        break;
      case 'crab':
        for (let k = 0; k < 4; k++) this.tone(t + k * 0.04, { freq: 2600 + Math.random() * 600, dur: 0.02, vel: 0.03, reverb: 0 });
        break;
      default:
        break;
    }
  }
}
