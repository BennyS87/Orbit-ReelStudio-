// Orbit - audio engine (Web Audio). Works with both realtime AudioContext and OfflineAudioContext.
(function () {
  const O = (window.Orbit = window.Orbit || {});
  const S = O.Sound;

  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const clampF = (f, ctx) => Math.min(ctx ? ctx.sampleRate * 0.49 : 20000, Math.max(20, f));

  // ---------------- per-context caches ----------------
  const ctxCaches = new WeakMap();
  function cache(ctx) {
    let c = ctxCaches.get(ctx);
    if (!c) { c = { waves: new Map(), irs: new Map() }; ctxCaches.set(ctx, c); }
    return c;
  }

  function noiseBuffer(ctx) {
    const c = cache(ctx);
    if (!c.noise) {
      const len = Math.floor(ctx.sampleRate * 2);
      const b = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = b.getChannelData(0);
      let seed = 12345;
      for (let i = 0; i < len; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = (seed / 0x3fffffff) - 1; }
      c.noise = b;
    }
    return c.noise;
  }

  function periodicWave(ctx, harmonics) {
    const c = cache(ctx);
    const key = harmonics.map(h => h.toFixed(3)).join(',');
    let w = c.waves.get(key);
    if (!w) {
      const n = harmonics.length + 1;
      const real = new Float32Array(n), imag = new Float32Array(n);
      for (let i = 1; i < n; i++) imag[i] = harmonics[i - 1];
      if (harmonics.every(h => h === 0)) imag[1] = 0.0001;
      w = ctx.createPeriodicWave(real, imag);
      c.waves.set(key, w);
    }
    return w;
  }

  function setWave(ctx, osc, wave, harmonics) {
    if (wave === 'custom') osc.setPeriodicWave(periodicWave(ctx, harmonics || S.defaultHarmonics('sawtooth')));
    else osc.type = wave;
  }

  const curveCache = new Map();
  function curve(kind, amount) {
    const key = kind + Math.round(amount * 200);
    let c = curveCache.get(key);
    if (c) return c;
    const n = kind === 'crush' ? 8192 : 2048;
    c = new Float32Array(n);
    if (kind === 'dist') {
      const k = 1 + amount * amount * 60;
      const norm = Math.tanh(k);
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
    } else if (kind === 'fold') {
      const g = 1 + amount * 6;
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.sin(x * g * Math.PI / 2) * (1 - amount * 0.2) + x * amount * 0.0; }
    } else if (kind === 'crush') {
      const bits = 12 - amount * 10.5; // 12 bits -> 1.5 bits
      const levels = Math.pow(2, bits) / 2;
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.round(x * levels) / levels; }
    }
    curveCache.set(key, c);
    return c;
  }

  function impulse(ctx, seconds, damp) {
    const c = cache(ctx);
    const key = seconds.toFixed(2) + '_' + damp.toFixed(2);
    let b = c.irs.get(key);
    if (b) return b;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * Math.min(10, seconds * 1.1 + 0.05));
    b = ctx.createBuffer(2, len, sr);
    const pre = Math.floor(sr * 0.012);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0, seed = 777 + ch * 99991;
      for (let i = 0; i < len; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const white = seed / 2147483648 - 1;
        const t = i / sr;
        // damping: lowpass coefficient closes over time
        const a = Math.min(0.98, 0.05 + damp * 0.9 * Math.min(1, t / seconds) + damp * 0.05);
        lp = lp * a + white * (1 - a);
        const env = i < pre ? 0 : Math.exp(-6.9 * (t - pre / sr) / seconds);
        d[i] = lp * env * (1 + damp * 2);
      }
    }
    c.irs.set(key, b);
    return b;
  }

  // ---------------- Channel strip (one per distinct sound owner) ----------------
  class Channel {
    constructor(ctx, dest, sound, bpm) {
      this.ctx = ctx;
      const g = () => ctx.createGain();
      this.input = g();
      this.distDry = g(); this.distWet = g(); this.distSum = g();
      this.shaper = ctx.createWaveShaper(); this.shaper.oversample = '4x';
      this.crusher = ctx.createWaveShaper();
      this.eqLow = ctx.createBiquadFilter(); this.eqLow.type = 'lowshelf'; this.eqLow.frequency.value = 220;
      this.eqMid = ctx.createBiquadFilter(); this.eqMid.type = 'peaking'; this.eqMid.Q.value = 0.9;
      this.eqHigh = ctx.createBiquadFilter(); this.eqHigh.type = 'highshelf'; this.eqHigh.frequency.value = 4500;
      this.panner = ctx.createStereoPanner();
      this.vol = g();
      this.echoSend = g(); this.delay = ctx.createDelay(6); this.echoFilter = ctx.createBiquadFilter(); this.echoFb = g();
      this.echoFilter.type = 'lowpass';
      this.revSend = g(); this.convolver = ctx.createConvolver(); this.revOut = g();

      this.input.connect(this.distDry).connect(this.distSum);
      this.input.connect(this.shaper).connect(this.distWet).connect(this.distSum);
      this.distSum.connect(this.crusher).connect(this.eqLow).connect(this.eqMid).connect(this.eqHigh).connect(this.panner).connect(this.vol);
      this.vol.connect(dest);
      this.vol.connect(this.echoSend).connect(this.delay).connect(this.echoFilter).connect(this.echoFb).connect(this.delay);
      this.echoFilter.connect(dest);
      this.vol.connect(this.revSend).connect(this.convolver).connect(this.revOut).connect(dest);
      this.irKey = null;
      this.update(sound, bpm, true);
    }

    update(s, bpm, immediate) {
      const ctx = this.ctx, now = ctx.currentTime;
      const set = (p, v) => { if (immediate) p.value = v; else p.setTargetAtTime(v, now, 0.02); };
      // distortion
      if (s.drive > 0.005) {
        if (this._drive !== s.drive) { this.shaper.curve = curve('dist', s.drive); this._drive = s.drive; }
        set(this.distWet.gain, s.distMix * (1 - s.drive * 0.45));
        set(this.distDry.gain, 1 - s.distMix);
      } else { set(this.distWet.gain, 0); set(this.distDry.gain, 1); }
      // bit crush
      if (this._crush !== s.crush) { this.crusher.curve = s.crush > 0.01 ? curve('crush', s.crush) : null; this._crush = s.crush; }
      // EQ
      set(this.eqLow.gain, s.eqLow); set(this.eqMid.gain, s.eqMid); set(this.eqMid.frequency, Math.min(ctx.sampleRate * 0.45, s.eqMidFreq)); set(this.eqHigh.gain, s.eqHigh);
      // output
      set(this.panner.pan, s.pan); set(this.vol.gain, s.volume);
      // echo
      const dt = (S.ECHO_BEATS[s.echoDiv] || 0.5) * 60 / bpm;
      set(this.delay.delayTime, Math.min(5.9, dt));
      set(this.echoFb.gain, s.echoFeedback);
      set(this.echoFilter.frequency, Math.min(ctx.sampleRate * 0.49, s.echoTone));
      set(this.echoSend.gain, s.echoMix);
      // reverb
      set(this.revSend.gain, s.reverbMix);
      if (s.reverbMix > 0.001) {
        const key = s.reverbSize.toFixed(2) + '_' + s.reverbDamp.toFixed(2);
        if (key !== this.irKey) { this.irKey = key; this.convolver.buffer = impulse(ctx, s.reverbSize, s.reverbDamp); }
      }
    }

    dispose(delaySec) {
      const kill = () => { try { this.input.disconnect(); this.vol.disconnect(); this.echoFilter.disconnect(); this.revOut.disconnect(); this.echoFb.disconnect(); } catch (e) { } };
      if (delaySec) setTimeout(kill, delaySec * 1000); else kill();
    }
  }

  // ---------------- Voices ----------------
  function filterQ(type, reso) {
    if (type === 'lowpass' || type === 'highpass') return Math.min(26, 20 * Math.log10(Math.max(0.3, reso)) * 1.05);
    return Math.max(0.1, reso);
  }

  function playSynth(ctx, ch, s, midi, t, gate, vel) {
    const f = mtof(midi + s.transpose + s.fine / 100);
    const a = Math.max(0.001, s.attack), d = Math.max(0.005, s.decay), r = Math.max(0.01, s.release);
    const tOff = t + Math.max(gate, a + 0.002);
    const tEnd = tOff + r * 1.15 + 0.04;
    const nodes = [];

    const src = ctx.createGain(); src.gain.value = 0.42;
    const filter = ctx.createBiquadFilter();
    filter.type = s.filterType; filter.Q.value = filterQ(s.filterType, s.resonance);
    const amp = ctx.createGain();
    let chain = src;
    if (s.shape > 0.01) { const fold = ctx.createWaveShaper(); fold.curve = curve('fold', s.shape); src.connect(fold); chain = fold; }
    chain.connect(filter).connect(amp).connect(ch.input);

    // filter envelope
    const base = clampF(s.cutoff, ctx);
    const peak = clampF(s.cutoff * Math.pow(2, s.filterEnv), ctx);
    const sus = clampF(s.cutoff * Math.pow(2, s.filterEnv * s.sustain), ctx);
    filter.frequency.setValueAtTime(base, t);
    filter.frequency.exponentialRampToValueAtTime(peak, t + a);
    filter.frequency.setTargetAtTime(sus, t + a, d / 3);
    filter.frequency.setTargetAtTime(base, tOff, r / 4);

    // amp envelope
    const pk = Math.max(0.0001, vel);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(pk, t + a);
    amp.gain.setTargetAtTime(pk * s.sustain, t + a, d / 3);
    amp.gain.setTargetAtTime(0, tOff, r / 6);

    // shared modulators
    let vib = null, fm = null;
    if (s.vibDepth > 0.5) {
      const lfo = ctx.createOscillator(); lfo.frequency.value = s.vibRate;
      vib = ctx.createGain(); vib.gain.value = s.vibDepth;
      lfo.connect(vib); nodes.push(lfo);
    }
    if (s.fmAmt > 0.001) {
      const mod = ctx.createOscillator(); mod.frequency.value = f * s.fmRatio;
      fm = ctx.createGain();
      const depth = s.fmAmt * 7 * f * s.fmRatio;
      fm.gain.setValueAtTime(depth, t);
      fm.gain.setTargetAtTime(depth * (0.25 + 0.75 * s.sustain), t + a, d / 2);
      mod.connect(fm); nodes.push(mod);
    }

    const applyPitch = (osc, cents) => {
      if (Math.abs(s.pitchEnv) > 0.01) {
        osc.detune.setValueAtTime(cents + s.pitchEnv * 100, t);
        osc.detune.setTargetAtTime(cents, t, s.pitchEnvTime / 3);
      } else osc.detune.value = cents;
      if (vib) vib.connect(osc.detune);
    };

    // osc 1 (+ unison)
    const n = Math.max(1, Math.round(s.unison));
    const vg = 1 / Math.sqrt(n);
    for (let i = 0; i < n; i++) {
      const osc = ctx.createOscillator();
      setWave(ctx, osc, s.wave, s.harmonics);
      osc.frequency.value = f;
      const spread = n > 1 ? (i / (n - 1) - 0.5) * s.spread : 0;
      applyPitch(osc, spread);
      if (fm) fm.connect(osc.frequency);
      const og = ctx.createGain(); og.gain.value = vg;
      if (n > 1) { const p = ctx.createStereoPanner(); p.pan.value = (i / (n - 1) - 0.5) * 1.2; osc.connect(og).connect(p).connect(src); }
      else osc.connect(og).connect(src);
      nodes.push(osc);
    }
    // osc 2
    if (s.osc2Mix > 0.001) {
      const o2 = ctx.createOscillator();
      o2.type = s.osc2Wave;
      o2.frequency.value = f * Math.pow(2, s.osc2Oct + s.osc2Semi / 12);
      applyPitch(o2, s.osc2Detune);
      const g2 = ctx.createGain(); g2.gain.value = s.osc2Mix;
      o2.connect(g2).connect(src); nodes.push(o2);
    }
    // noise
    if (s.noise > 0.001) {
      const nz = ctx.createBufferSource(); nz.buffer = noiseBuffer(ctx); nz.loop = true;
      const ng = ctx.createGain(); ng.gain.value = s.noise * 0.8;
      nz.connect(ng).connect(src); nodes.push(nz);
    }

    for (const nd of nodes) {
      if (nd.buffer) nd.start(t, Math.random() * 1.5); else nd.start(t);
      nd.stop(tEnd);
    }
    nodes[nodes.length - 1].onended = () => { try { amp.disconnect(); } catch (e) { } };
  }

  // ---- drums ----
  function playDrum(ctx, ch, s, t, vel) {
    const tune = Math.pow(2, (s.transpose + s.fine / 100) / 12);
    const dec = s.drumDecay, tone = s.drumTone, snap = s.drumSnap;
    const out = ctx.createGain(); out.gain.value = vel;
    const filter = ctx.createBiquadFilter(); filter.type = s.filterType; filter.frequency.value = clampF(s.cutoff, ctx); filter.Q.value = filterQ(s.filterType, s.resonance);
    let head = out;
    if (s.shape > 0.01) { const fold = ctx.createWaveShaper(); fold.curve = curve('fold', s.shape); out.connect(fold); head = fold; }
    head.connect(filter).connect(ch.input);
    const end = t + dec * 1.3 + 0.08;
    const srcs = [];
    const pEnv = s.pitchEnv; // extra pitch envelope in semitones

    const osc = (type, freq) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; srcs.push(o); if (Math.abs(pEnv) > 0.01) { o.detune.setValueAtTime(pEnv * 100, t); o.detune.setTargetAtTime(0, t, s.pitchEnvTime / 3); } return o; };
    const noise = () => { const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx); n.loop = true; srcs.push(n); return n; };
    const env = (level, decay, attack) => {
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      if (attack) gn.gain.linearRampToValueAtTime(level, t + attack); else gn.gain.setValueAtTime(level, t);
      gn.gain.setTargetAtTime(0, t + (attack || 0), decay / 4.5);
      gn.connect(out);
      return gn;
    };
    const bp = (freq, q, type) => { const b = ctx.createBiquadFilter(); b.type = type || 'bandpass'; b.frequency.value = freq; b.Q.value = q; return b; };
    const metallic = (level, decay, base) => {
      const g = env(level, decay);
      const hp = bp(7000 + tone * 3000, 0.7, 'highpass');
      const bpf = bp(10000, 0.8);
      bpf.connect(hp).connect(g);
      [2, 3, 4.16, 5.43, 6.79, 8.21].forEach(r => { osc('square', base * r * tune).connect(bpf); });
      return g;
    };

    switch (s.drum) {
      case 'kick': {
        const f0 = (42 + tone * 40) * tune;
        const o = osc('sine', f0);
        o.frequency.setValueAtTime(f0 * (3 + snap * 6), t);
        o.frequency.exponentialRampToValueAtTime(f0, t + 0.02 + 0.07 * (1 - snap));
        o.connect(env(1.2, dec));
        const n = noise(); n.connect(bp(3000 + tone * 4000, 0.8)).connect(env(snap * 0.6, 0.012));
        break;
      }
      case 'kick808': {
        const f0 = (38 + tone * 22) * tune;
        const o = osc('sine', f0);
        o.frequency.setValueAtTime(f0 * (2 + snap * 3), t);
        o.frequency.exponentialRampToValueAtTime(f0, t + 0.06);
        o.connect(env(1.1, dec));
        break;
      }
      case 'snare': {
        const o = osc('triangle', 190 * tune);
        o.frequency.setValueAtTime(260 * tune, t); o.frequency.exponentialRampToValueAtTime(180 * tune, t + 0.04);
        o.connect(env(0.7 * (1.1 - snap * 0.5), dec * 0.55));
        const n = noise(); n.connect(bp(1200 + tone * 6000, 0.6, 'highpass')).connect(env(0.35 + snap * 0.7, dec));
        break;
      }
      case 'clap': {
        const n = noise();
        const f = bp(900 + tone * 1800, 1.4);
        n.connect(f);
        const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
        [0, 0.011, 0.023].forEach(o => { g.gain.setValueAtTime(0.9 + snap * 0.3, t + o); g.gain.setTargetAtTime(0.05, t + o + 0.001, 0.003); });
        g.gain.setValueAtTime(0.7, t + 0.034); g.gain.setTargetAtTime(0, t + 0.034, dec / 4.5);
        f.connect(g).connect(out);
        break;
      }
      case 'hatC': case 'hatO': {
        metallic(0.5, dec, 40);
        const n = noise(); n.connect(bp(8000 + tone * 4000, 0.7, 'highpass')).connect(env(0.2 + snap * 0.4, dec * 0.8));
        break;
      }
      case 'crash': {
        metallic(0.35, dec, 52);
        const n = noise(); n.connect(bp(5000 + tone * 4000, 0.5, 'highpass')).connect(env(0.45, dec, 0.003));
        break;
      }
      case 'tom': {
        const f0 = (80 + tone * 160) * tune;
        const o = osc('sine', f0);
        o.frequency.setValueAtTime(f0 * 1.7, t); o.frequency.exponentialRampToValueAtTime(f0, t + 0.06);
        o.connect(env(1, dec));
        const n = noise(); n.connect(bp(f0 * 4, 1)).connect(env(snap * 0.3, 0.03));
        break;
      }
      case 'rim': {
        const o = osc('triangle', 1700 * tune); o.connect(bp(1700 * tune, 3)).connect(env(1, dec));
        const o2 = osc('square', 480 * tune); o2.connect(bp(480 * tune, 2)).connect(env(0.4, dec * 0.6));
        const n = noise(); n.connect(bp(3000 + tone * 3000, 2)).connect(env(snap * 0.5, 0.01));
        break;
      }
      case 'cowbell': {
        const f = bp(2000 + tone * 1500, 1.2);
        osc('square', 540 * tune).connect(f); osc('square', 800 * tune).connect(f);
        const g = env(0.6, dec); f.connect(g);
        break;
      }
      case 'shaker': {
        const n = noise(); n.connect(bp(5000 + tone * 6000, 1.1)).connect(env(0.6 + snap * 0.3, dec, 0.012));
        break;
      }
      case 'perc': {
        const f0 = (300 + tone * 1500) * tune;
        const o = osc('sine', f0);
        o.frequency.setValueAtTime(f0 * (1 + snap * 1.5), t); o.frequency.exponentialRampToValueAtTime(f0, t + 0.015);
        o.connect(env(0.9, dec));
        break;
      }
      case 'zap': {
        const o = osc(tone > 0.5 ? 'sawtooth' : 'sine', 2400 * tune);
        o.frequency.setValueAtTime((800 + tone * 3000) * tune, t);
        o.frequency.exponentialRampToValueAtTime(Math.max(30, 50 * tune), t + Math.max(0.03, dec * (0.4 + snap * 0.6)));
        o.connect(env(0.7, dec));
        break;
      }
    }
    for (const n of srcs) { if (n.buffer) n.start(t, Math.random()); else n.start(t); n.stop(end); }
    if (srcs.length) srcs[0].onended = () => { try { out.disconnect(); } catch (e) { } };
  }

  function playSound(ctx, ch, s, midi, t, gateSec, vel) {
    if (!ch) return;
    if (s.kind === 'drum') playDrum(ctx, ch, s, t, vel);
    else playSynth(ctx, ch, s, midi, t, gateSec, vel);
  }

  function buildMaster(ctx, volume) {
    const input = ctx.createGain(); input.gain.value = volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -8; comp.knee.value = 6; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
    const lim = ctx.createWaveShaper(); lim.curve = curve('dist', 0.08); // gentle safety clip
    input.connect(comp).connect(lim);
    return { input, comp, out: lim };
  }

  // ---------------- Realtime engine ----------------
  class Engine {
    constructor() {
      this.ctx = null; this.channels = new Map(); this.playing = false; this.pattern = null;
      this.hits = []; this.masterVolume = 0.8; this.startTime = 0; this.nextT = 0; this.timer = null;
    }
    init() {
      if (this.ctx) return;
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      this.master = buildMaster(this.ctx, this.masterVolume);
      this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 2048;
      this.master.out.connect(this.analyser);
      this.master.out.connect(this.ctx.destination);
      if (this.pattern) this.syncChannels();
    }
    resume() { this.init(); if (this.ctx.state !== 'running') return this.ctx.resume(); return Promise.resolve(); }
    setMasterVolume(v) { this.masterVolume = v; if (this.master) this.master.input.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); }

    loopDur(p) { p = p || this.pattern; return p.bars * p.beatsPerBar * 60 / p.bpm; }

    setPattern(p) {
      const old = this.pattern;
      if (this.playing && old && (old.bpm !== p.bpm || old.bars !== p.bars)) {
        const now = this.ctx.currentTime;
        const oldL = this.loopDur(old), newL = this.loopDur(p);
        let phase = ((now - this.startTime) / oldL) % 1; if (phase < 0) phase += 1;
        this.startTime = now - phase * newL;
      }
      this.pattern = p;
      if (this.ctx) this.syncChannels();
    }

    syncChannels() {
      const p = this.pattern; if (!p || !this.ctx) return;
      for (const [key, s] of p.channels) {
        const ch = this.channels.get(key);
        if (ch) ch.update(s, p.bpm, false);
        else this.channels.set(key, new Channel(this.ctx, this.master.input, s, p.bpm));
      }
      for (const [key, ch] of this.channels) {
        if (!p.channels.has(key) && key !== '__audition') { ch.dispose(8); this.channels.delete(key); }
      }
    }

    updateChannel(key, s) {
      if (!this.ctx) return;
      const ch = this.channels.get(key);
      if (ch) ch.update(s, this.pattern ? this.pattern.bpm : 120, false);
    }

    start() {
      this.init();
      this.resume();
      if (this.playing) return;
      this.playing = true;
      this.startTime = this.ctx.currentTime + 0.06;
      this.nextT = this.startTime;
      this.hits = [];
      this.timer = setInterval(() => this.tick(), 20);
      this.tick();
    }
    stop() {
      this.playing = false;
      clearInterval(this.timer); this.timer = null;
    }
    tick() {
      if (!this.playing || !this.pattern) return;
      const ahead = this.ctx.currentTime + 0.14;
      if (this.nextT < this.ctx.currentTime) this.nextT = this.ctx.currentTime; // after a stall, don't burst
      if (this.nextT >= ahead) return;
      this.schedule(this.nextT, ahead);
      this.nextT = ahead;
      const cutoff = this.ctx.currentTime - 1;
      if (this.hits.length > 400) this.hits = this.hits.filter(h => h.time > cutoff);
    }
    schedule(a, b) {
      const p = this.pattern, L = this.loopDur();
      const k0 = Math.floor((a - this.startTime) / L), k1 = Math.floor((b - this.startTime) / L);
      for (let k = k0; k <= k1; k++) {
        for (const ev of p.events) {
          const t = this.startTime + (k + ev.t) * L;
          if (t >= a && t < b && t >= this.startTime) this.trigger(ev, t);
        }
      }
    }
    trigger(ev, t) {
      const ch = this.channels.get(ev.key);
      playSound(this.ctx, ch, ev.sound, ev.midi, t, ev.gate * 60 / this.pattern.bpm, ev.vel);
      this.hits.push({ id: ev.noteId, lane: ev.lane, time: t });
    }
    phase() {
      if (!this.playing || !this.ctx) return null;
      const t = this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0);
      if (t < this.startTime) return 0;
      return ((t - this.startTime) / this.loopDur()) % 1;
    }
    now() { return this.ctx ? this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0) : 0; }

    audition(key, sound, midi, vel) {
      this.resume();
      let ch = this.channels.get(key);
      if (!ch) {
        ch = this.channels.get('__audition');
        if (!ch) { ch = new Channel(this.ctx, this.master.input, sound, this.pattern ? this.pattern.bpm : 120); this.channels.set('__audition', ch); }
        else ch.update(sound, this.pattern ? this.pattern.bpm : 120, true);
      }
      const bpm = this.pattern ? this.pattern.bpm : 120;
      playSound(this.ctx, ch, sound, midi, this.ctx.currentTime + 0.01, sound.length * 60 / bpm, vel == null ? 0.9 : vel);
    }
  }

  // ---------------- Offline render (for export & drum previews) ----------------
  async function renderOffline(p, loops, tailSec, sampleRate, masterVolume) {
    sampleRate = sampleRate || 44100;
    const L = p.bars * p.beatsPerBar * 60 / p.bpm;
    const total = L * loops + tailSec;
    const octx = new OfflineAudioContext(2, Math.ceil(total * sampleRate), sampleRate);
    const master = buildMaster(octx, masterVolume == null ? 0.8 : masterVolume);
    master.out.connect(octx.destination);
    const chans = new Map();
    for (const [key, s] of p.channels) chans.set(key, new Channel(octx, master.input, s, p.bpm));
    for (let k = 0; k < loops; k++) {
      for (const ev of p.events) {
        const t = (k + ev.t) * L + 0.001;
        playSound(octx, chans.get(ev.key), ev.sound, ev.midi, t, ev.gate * 60 / p.bpm, ev.vel);
      }
    }
    return octx.startRendering();
  }

  async function renderHit(sound, midi, seconds, bpm) {
    const sr = 22050;
    const octx = new OfflineAudioContext(1, Math.ceil(seconds * sr), sr);
    const ch = new Channel(octx, octx.destination, Object.assign({}, sound, { echoMix: 0, reverbMix: 0, pan: 0 }), bpm || 120);
    playSound(octx, ch, sound, midi, 0.002, sound.length * 60 / (bpm || 120), 0.9);
    return octx.startRendering();
  }

  O.Engine = Engine;
  O.DSP = { renderOffline, renderHit, mtof };
})();
