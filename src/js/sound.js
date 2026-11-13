// Orbit - sound parameter definitions, defaults and presets
(function () {
  const O = (window.Orbit = window.Orbit || {});

  const ECHO_DIVS = ['1/32', '1/16', '1/16d', '1/8t', '1/8', '1/8d', '1/4t', '1/4', '1/4d', '1/2', '1/1'];
  const ECHO_BEATS = { '1/32': 0.125, '1/16': 0.25, '1/16d': 0.375, '1/8t': 1 / 3, '1/8': 0.5, '1/8d': 0.75, '1/4t': 2 / 3, '1/4': 1, '1/4d': 1.5, '1/2': 2, '1/1': 4 };

  const DRUMS = [
    { id: 'kick', name: 'Kick', gm: 36 },
    { id: 'snare', name: 'Snare', gm: 38 },
    { id: 'clap', name: 'Clap', gm: 39 },
    { id: 'hatC', name: 'Closed Hat', gm: 42 },
    { id: 'hatO', name: 'Open Hat', gm: 46 },
    { id: 'tom', name: 'Tom', gm: 45 },
    { id: 'rim', name: 'Rimshot', gm: 37 },
    { id: 'cowbell', name: 'Cowbell', gm: 56 },
    { id: 'crash', name: 'Crash', gm: 49 },
    { id: 'shaker', name: 'Shaker', gm: 70 },
    { id: 'perc', name: 'Blip Perc', gm: 76 },
    { id: 'zap', name: 'Zap', gm: 81 },
    { id: 'kick808', name: '808 Boom', gm: 35 }
  ];

  const WAVES = ['sine', 'triangle', 'sawtooth', 'square', 'custom'];

  // Numeric parameter definitions -> knobs
  // curve: 'lin' | 'log' | 'pow' (pow = squared for finer low-end)
  const P = {
    // --- Oscillators ---
    unison: { label: 'Voices', min: 1, max: 7, def: 1, step: 1, fmt: v => String(Math.round(v)) },
    spread: { label: 'Spread', min: 0, max: 60, def: 12, unit: 'c', fmt: v => v.toFixed(0) + 'c' },
    osc2Mix: { label: 'Osc 2', min: 0, max: 1, def: 0, fmt: pct },
    osc2Oct: { label: 'Octave', min: -2, max: 2, def: 0, step: 1, fmt: v => (v > 0 ? '+' : '') + Math.round(v) },
    osc2Semi: { label: 'Semi', min: -12, max: 12, def: 7, step: 1, fmt: v => (v > 0 ? '+' : '') + Math.round(v) },
    osc2Detune: { label: 'Detune', min: -50, max: 50, def: 6, fmt: v => v.toFixed(0) + 'c' },
    noise: { label: 'Noise', min: 0, max: 1, def: 0, curve: 'pow', fmt: pct },
    fmAmt: { label: 'FM Amt', min: 0, max: 1, def: 0, curve: 'pow', fmt: pct },
    fmRatio: { label: 'FM Ratio', min: 0.25, max: 8, def: 2, step: 0.25, fmt: v => v.toFixed(2) + '×' },
    shape: { label: 'Fold', min: 0, max: 1, def: 0, fmt: pct },
    // --- Drum ---
    drumDecay: { label: 'Decay', min: 0.03, max: 2.5, def: 0.4, curve: 'log', fmt: sec },
    drumTone: { label: 'Tone', min: 0, max: 1, def: 0.5, fmt: pct },
    drumSnap: { label: 'Snap', min: 0, max: 1, def: 0.5, fmt: pct },
    // --- Pitch ---
    transpose: { label: 'Pitch', min: -36, max: 36, def: 0, step: 1, fmt: v => (v > 0 ? '+' : '') + Math.round(v) + 'st' },
    fine: { label: 'Fine', min: -100, max: 100, def: 0, fmt: v => (v > 0 ? '+' : '') + v.toFixed(0) + 'c' },
    pitchEnv: { label: 'P.Env', min: -24, max: 24, def: 0, fmt: v => (v > 0 ? '+' : '') + v.toFixed(1) + 'st' },
    pitchEnvTime: { label: 'P.Time', min: 0.005, max: 1, def: 0.08, curve: 'log', fmt: sec },
    vibRate: { label: 'Vib Rate', min: 0.1, max: 14, def: 5, curve: 'log', fmt: v => v.toFixed(1) + 'Hz' },
    vibDepth: { label: 'Vib Depth', min: 0, max: 100, def: 0, curve: 'pow', fmt: v => v.toFixed(0) + 'c' },
    // --- Envelope ---
    attack: { label: 'Attack', min: 0.001, max: 4, def: 0.005, curve: 'log', fmt: sec },
    decay: { label: 'Decay', min: 0.01, max: 4, def: 0.25, curve: 'log', fmt: sec },
    sustain: { label: 'Sustain', min: 0, max: 1, def: 0.4, fmt: pct },
    release: { label: 'Release', min: 0.01, max: 6, def: 0.25, curve: 'log', fmt: sec },
    length: { label: 'Length', min: 0.0625, max: 8, def: 0.5, curve: 'log', fmt: beats },
    // --- Filter ---
    cutoff: { label: 'Cutoff', min: 30, max: 20000, def: 6000, curve: 'log', fmt: hz },
    resonance: { label: 'Reso', min: 0.1, max: 24, def: 1, curve: 'log', fmt: v => v.toFixed(1) },
    filterEnv: { label: 'Env Amt', min: -5, max: 5, def: 1, fmt: v => (v > 0 ? '+' : '') + v.toFixed(1) + 'oct' },
    // --- Distortion ---
    drive: { label: 'Drive', min: 0, max: 1, def: 0, fmt: pct },
    distMix: { label: 'Mix', min: 0, max: 1, def: 1, fmt: pct },
    crush: { label: 'Crush', min: 0, max: 1, def: 0, fmt: pct },
    // --- EQ ---
    eqLow: { label: 'Low', min: -18, max: 18, def: 0, fmt: db },
    eqMid: { label: 'Mid', min: -18, max: 18, def: 0, fmt: db },
    eqMidFreq: { label: 'Mid Freq', min: 150, max: 8000, def: 1000, curve: 'log', fmt: hz },
    eqHigh: { label: 'High', min: -18, max: 18, def: 0, fmt: db },
    // --- Echo ---
    echoFeedback: { label: 'Feedback', min: 0, max: 0.92, def: 0.35, fmt: pct },
    echoMix: { label: 'Echo', min: 0, max: 1, def: 0, fmt: pct },
    echoTone: { label: 'Tone', min: 500, max: 16000, def: 5000, curve: 'log', fmt: hz },
    // --- Reverb ---
    reverbSize: { label: 'Size', min: 0.2, max: 8, def: 2, curve: 'log', fmt: sec },
    reverbMix: { label: 'Reverb', min: 0, max: 1, def: 0, fmt: pct },
    reverbDamp: { label: 'Damp', min: 0, max: 1, def: 0.4, fmt: pct },
    // --- Output ---
    pan: { label: 'Pan', min: -1, max: 1, def: 0, fmt: v => Math.abs(v) < 0.02 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100) },
    volume: { label: 'Volume', min: 0, max: 1.5, def: 0.8, fmt: v => v <= 0.0001 ? '-∞' : (20 * Math.log10(v)).toFixed(1) + 'dB' }
  };

  function pct(v) { return Math.round(v * 100) + '%'; }
  function sec(v) { return v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's'; }
  function hz(v) { return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 1 : 2) + 'k' : Math.round(v) + 'Hz'; }
  function db(v) { return (v > 0 ? '+' : '') + v.toFixed(1) + 'dB'; }
  function beats(v) {
    const map = [[0.0625, '1/64'], [0.125, '1/32'], [0.25, '1/16'], [1 / 3, '1/8t'], [0.375, '1/16d'], [0.5, '1/8'], [0.75, '1/8d'], [1, '1/4'], [1.5, '1/4d'], [2, '1/2'], [3, '1/2d'], [4, '1 bar'], [8, '2 bars']];
    for (const [b, n] of map) if (Math.abs(v - b) / b < 0.04) return n;
    return v.toFixed(2) + 'b';
  }

  // Non-numeric params
  const ENUMS = {
    kind: ['synth', 'drum'],
    wave: WAVES,
    osc2Wave: WAVES.filter(w => w !== 'custom'),
    filterType: ['lowpass', 'highpass', 'bandpass', 'notch'],
    drum: DRUMS.map(d => d.id),
    echoDiv: ECHO_DIVS
  };

  function defaultHarmonics(wave) {
    const h = new Array(16).fill(0);
    for (let n = 1; n <= 16; n++) {
      if (wave === 'sine') h[n - 1] = n === 1 ? 1 : 0;
      else if (wave === 'sawtooth') h[n - 1] = 1 / n;
      else if (wave === 'square') h[n - 1] = n % 2 ? 1 / n : 0;
      else if (wave === 'triangle') h[n - 1] = n % 2 ? 1 / (n * n) : 0;
      else h[n - 1] = 1 / n;
    }
    return h;
  }

  function baseSound() {
    const s = { kind: 'synth', wave: 'sawtooth', osc2Wave: 'square', filterType: 'lowpass', drum: 'kick', echoDiv: '1/8d', harmonics: defaultHarmonics('sawtooth') };
    for (const k in P) s[k] = P[k].def;
    return s;
  }

  function make(overrides) { return Object.assign(baseSound(), overrides || {}); }

  const PRESETS = [
    { group: 'Synth', name: 'Glass Pluck', s: { wave: 'sawtooth', cutoff: 2400, resonance: 4, filterEnv: 2.5, attack: 0.002, decay: 0.22, sustain: 0.15, release: 0.3, length: 0.25, reverbMix: 0.22, echoMix: 0.18, volume: 0.7 } },
    { group: 'Synth', name: 'Soft Pad', s: { wave: 'sawtooth', unison: 5, spread: 22, cutoff: 1800, resonance: 0.8, filterEnv: 0.6, attack: 0.6, decay: 1, sustain: 0.8, release: 1.8, length: 2, reverbMix: 0.45, reverbSize: 4, volume: 0.5 } },
    { group: 'Synth', name: 'Saw Lead', s: { wave: 'sawtooth', unison: 3, spread: 14, osc2Mix: 0.4, osc2Oct: 1, osc2Semi: 0, cutoff: 5000, resonance: 2, filterEnv: 1, attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.2, length: 0.5, vibDepth: 12, echoMix: 0.2, volume: 0.6 } },
    { group: 'Synth', name: 'Sub Bass', s: { wave: 'sine', osc2Wave: 'triangle', osc2Mix: 0.3, osc2Oct: 1, osc2Semi: 0, osc2Detune: 0, transpose: -24, cutoff: 900, filterEnv: 0.5, attack: 0.003, decay: 0.3, sustain: 0.7, release: 0.12, length: 0.5, drive: 0.2, volume: 0.85 } },
    { group: 'Synth', name: 'Acid Bass', s: { wave: 'sawtooth', transpose: -12, cutoff: 380, resonance: 14, filterEnv: 3.8, attack: 0.002, decay: 0.18, sustain: 0.2, release: 0.08, length: 0.25, drive: 0.45, distMix: 0.7, volume: 0.6 } },
    { group: 'Synth', name: 'FM Bell', s: { wave: 'sine', fmAmt: 0.45, fmRatio: 3.5, cutoff: 12000, filterEnv: 0, attack: 0.001, decay: 1.2, sustain: 0, release: 1.2, length: 1, reverbMix: 0.35, reverbSize: 3, transpose: 12, volume: 0.55 } },
    { group: 'Synth', name: 'Chip Square', s: { wave: 'square', cutoff: 14000, filterEnv: 0, attack: 0.001, decay: 0.1, sustain: 0.6, release: 0.05, length: 0.25, crush: 0.5, volume: 0.45, pitchEnv: 12, pitchEnvTime: 0.02 } },
    { group: 'Synth', name: 'Hollow Keys', s: { wave: 'triangle', osc2Wave: 'sine', osc2Mix: 0.5, osc2Oct: 1, osc2Semi: 0, cutoff: 4000, attack: 0.004, decay: 0.6, sustain: 0.3, release: 0.6, length: 0.5, reverbMix: 0.25, volume: 0.65 } },
    { group: 'Synth', name: 'Organ (custom wave)', s: { wave: 'custom', harmonics: [1, 0.8, 0, 0.6, 0, 0.3, 0, 0.5, 0, 0, 0, 0.2, 0, 0, 0, 0.15], cutoff: 9000, filterEnv: 0, attack: 0.01, decay: 0.1, sustain: 0.9, release: 0.15, length: 0.5, vibDepth: 10, vibRate: 6, volume: 0.45 } },
    { group: 'Synth', name: 'Dub Chord Stab', s: { wave: 'sawtooth', osc2Wave: 'sawtooth', osc2Mix: 0.8, osc2Semi: 7, osc2Oct: 0, osc2Detune: 4, cutoff: 1400, resonance: 3, filterEnv: 1.5, decay: 0.2, sustain: 0.1, release: 0.3, length: 0.25, echoMix: 0.45, echoFeedback: 0.6, echoDiv: '1/8d', reverbMix: 0.3, volume: 0.55 } },
    { group: 'Synth', name: 'Wobble Fold', s: { wave: 'sine', shape: 0.6, vibRate: 3, vibDepth: 0, transpose: -12, cutoff: 3000, filterEnv: 0, attack: 0.01, decay: 0.5, sustain: 0.8, release: 0.2, length: 1, drive: 0.3, volume: 0.6 } },
    { group: 'Drum', name: 'Kick', s: { kind: 'drum', drum: 'kick', drumDecay: 0.45, drumTone: 0.4, drumSnap: 0.4, cutoff: 20000, filterEnv: 0, volume: 1 } },
    { group: 'Drum', name: '808 Boom', s: { kind: 'drum', drum: 'kick808', drumDecay: 1.2, drumTone: 0.3, drumSnap: 0.2, cutoff: 20000, filterEnv: 0, drive: 0.15, volume: 0.9 } },
    { group: 'Drum', name: 'Snare', s: { kind: 'drum', drum: 'snare', drumDecay: 0.22, drumTone: 0.5, drumSnap: 0.6, cutoff: 20000, filterEnv: 0, reverbMix: 0.12, volume: 0.75 } },
    { group: 'Drum', name: 'Clap', s: { kind: 'drum', drum: 'clap', drumDecay: 0.3, drumTone: 0.5, drumSnap: 0.5, cutoff: 20000, filterEnv: 0, reverbMix: 0.2, volume: 0.75 } },
    { group: 'Drum', name: 'Closed Hat', s: { kind: 'drum', drum: 'hatC', drumDecay: 0.06, drumTone: 0.6, drumSnap: 0.5, cutoff: 20000, filterEnv: 0, volume: 0.45 } },
    { group: 'Drum', name: 'Open Hat', s: { kind: 'drum', drum: 'hatO', drumDecay: 0.4, drumTone: 0.6, drumSnap: 0.5, cutoff: 20000, filterEnv: 0, volume: 0.4 } },
    { group: 'Drum', name: 'Tom', s: { kind: 'drum', drum: 'tom', drumDecay: 0.35, drumTone: 0.5, drumSnap: 0.3, cutoff: 20000, filterEnv: 0, volume: 0.75 } },
    { group: 'Drum', name: 'Rimshot', s: { kind: 'drum', drum: 'rim', drumDecay: 0.06, drumTone: 0.5, drumSnap: 0.5, cutoff: 20000, filterEnv: 0, volume: 0.6 } },
    { group: 'Drum', name: 'Cowbell', s: { kind: 'drum', drum: 'cowbell', drumDecay: 0.3, drumTone: 0.5, drumSnap: 0.5, cutoff: 20000, filterEnv: 0, volume: 0.45 } },
    { group: 'Drum', name: 'Crash', s: { kind: 'drum', drum: 'crash', drumDecay: 1.6, drumTone: 0.6, drumSnap: 0.5, cutoff: 20000, filterEnv: 0, volume: 0.35 } },
    { group: 'Drum', name: 'Shaker', s: { kind: 'drum', drum: 'shaker', drumDecay: 0.08, drumTone: 0.7, drumSnap: 0.5, cutoff: 20000, filterEnv: 0, volume: 0.4 } },
    { group: 'Drum', name: 'Blip Perc', s: { kind: 'drum', drum: 'perc', drumDecay: 0.12, drumTone: 0.6, drumSnap: 0.3, cutoff: 20000, filterEnv: 0, echoMix: 0.25, volume: 0.5 } },
    { group: 'Drum', name: 'Zap', s: { kind: 'drum', drum: 'zap', drumDecay: 0.2, drumTone: 0.6, drumSnap: 0.5, cutoff: 20000, filterEnv: 0, volume: 0.5 } }
  ];

  function presetSound(name) {
    const p = PRESETS.find(x => x.name === name);
    const s = make(p ? p.s : {});
    if (p && p.s.harmonics) s.harmonics = p.s.harmonics.slice();
    else if (s.wave !== 'custom') s.harmonics = defaultHarmonics(s.wave);
    return s;
  }

  // Make a loaded/partial sound complete & valid
  function sanitize(s) {
    const out = baseSound();
    if (!s || typeof s !== 'object') return out;
    for (const k in P) {
      const v = Number(s[k]);
      if (Number.isFinite(v)) out[k] = Math.min(P[k].max, Math.max(P[k].min, v));
    }
    for (const k in ENUMS) if (ENUMS[k].includes(s[k])) out[k] = s[k];
    if (Array.isArray(s.harmonics)) out.harmonics = Array.from({ length: 16 }, (_, i) => Math.min(1, Math.max(0, Number(s.harmonics[i]) || 0)));
    return out;
  }

  function clone(s) { return JSON.parse(JSON.stringify(s)); }

  // Normalised 0..1 <-> value
  function toNorm(def, v) {
    const t = def.curve === 'log' ? Math.log(v / def.min) / Math.log(def.max / def.min)
      : def.curve === 'pow' ? Math.sqrt((v - def.min) / (def.max - def.min))
        : (v - def.min) / (def.max - def.min);
    return Math.min(1, Math.max(0, t));
  }
  function fromNorm(def, t) {
    t = Math.min(1, Math.max(0, t));
    let v = def.curve === 'log' ? def.min * Math.pow(def.max / def.min, t)
      : def.curve === 'pow' ? def.min + (def.max - def.min) * t * t
        : def.min + (def.max - def.min) * t;
    if (def.step) v = Math.round(v / def.step) * def.step;
    return Math.min(def.max, Math.max(def.min, v));
  }

  // Music helpers
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const SCALES = {
    'Minor Pentatonic': [0, 3, 5, 7, 10],
    'Major Pentatonic': [0, 2, 4, 7, 9],
    'Major': [0, 2, 4, 5, 7, 9, 11],
    'Natural Minor': [0, 2, 3, 5, 7, 8, 10],
    'Dorian': [0, 2, 3, 5, 7, 9, 10],
    'Phrygian': [0, 1, 3, 5, 7, 8, 10],
    'Lydian': [0, 2, 4, 6, 7, 9, 11],
    'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
    'Harmonic Minor': [0, 2, 3, 5, 7, 8, 11],
    'Blues': [0, 3, 5, 6, 7, 10],
    'Whole Tone': [0, 2, 4, 6, 8, 10],
    'Chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  };
  function noteName(m) { m = Math.round(m); return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }
  function scaleMidi(root, octave, scale, degree) {
    const sc = SCALES[scale] || SCALES['Minor Pentatonic'];
    const oct = Math.floor(degree / sc.length);
    const idx = ((degree % sc.length) + sc.length) % sc.length;
    return 12 * (octave + 1) + root + 12 * oct + sc[idx];
  }

  O.Sound = { P, ENUMS, DRUMS, WAVES, ECHO_DIVS, ECHO_BEATS, PRESETS, baseSound, make, presetSound, sanitize, clone, toNorm, fromNorm, defaultHarmonics, fmt: { pct, sec, hz, db, beats } };
  O.Music = { NOTE_NAMES, SCALES, noteName, scaleMidi };
})();
