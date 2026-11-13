// Orbit - sound panel (right side)
(function () {
  const O = (window.Orbit = window.Orbit || {});
  const S = O.Sound;
  const P = S.P;

  const WAVE_ICONS = {
    sine: 'M1 7 C 4 -1, 9 -1, 13 7 S 22 15, 25 7',
    triangle: 'M1 7 L7 1 L19 13 L25 7',
    sawtooth: 'M1 12 L13 2 L13 12 L25 2',
    square: 'M1 12 V2 H13 V12 H25 V2',
    custom: 'M1 7 L4 2 L7 10 L10 4 L13 12 L16 3 L19 9 L22 5 L25 7'
  };
  const WAVE_NAMES = { sine: 'Sine', triangle: 'Triangle', sawtooth: 'Saw', square: 'Square', custom: 'Custom (draw harmonics)' };

  let respCtx = null;
  function responseCtx() { if (!respCtx) respCtx = new OfflineAudioContext(1, 128, 44100); return respCtx; }

  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function waveSample(w, p, h) {
    p = p - Math.floor(p);
    switch (w) {
      case 'sine': return Math.sin(2 * Math.PI * p);
      case 'triangle': return 1 - 4 * Math.abs(Math.round(p - 0.25) - (p - 0.25));
      case 'sawtooth': return 2 * (p - Math.floor(p + 0.5));
      case 'square': return p < 0.5 ? 1 : -1;
      case 'custom': { let y = 0; for (let k = 0; k < h.length; k++) if (h[k]) y += h[k] * Math.sin(2 * Math.PI * (k + 1) * p); return y; }
    }
    return 0;
  }

  class Panel {
    constructor(root, app) {
      this.root = root; this.app = app;
      this.closed = { Pitch: false, Envelope: false, Filter: false, Distortion: true, EQ: true, Echo: false, Reverb: false, Output: false };
      this.knobs = []; this.vizzes = [];
    }

    // ---------------- build ----------------
    build() {
      const scroll = this.root.scrollTop;
      this.root.innerHTML = '';
      this.knobs = []; this.vizzes = [];
      const app = this.app;
      const T = app.editTarget();
      this.T = T;
      const s = T.sound;

      // header
      const head = el('div', 'p-head');
      const crumb = el('div', 'p-crumb');
      crumb.innerHTML = T.type === 'default' ? 'Editing · default sound' : `Editing · ${T.type === 'lane' ? 'ring' : T.type} <span style="flex:1"></span><a>← Default sound</a>`;
      const back = crumb.querySelector('a'); if (back) back.onclick = () => app.select({ type: 'default' });
      head.appendChild(crumb);
      const title = el('div', 'p-title');
      title.innerHTML = `<span class="dot" style="background:${T.color}"></span><span>${T.title}</span>`;
      head.appendChild(title);
      this.badge = el('span', 'p-badge' + (T.owned ? ' custom' : ''), T.badge);
      head.appendChild(this.badge);

      const actions = el('div', 'p-actions');
      const btn = (label, title, fn, cls) => { const b = el('button', cls || '', label); b.title = title; b.onclick = fn; actions.appendChild(b); return b; };
      btn('▶ Preview', 'Play this sound', () => app.auditionTarget(), 'toggle on');
      const presetSel = el('select');
      presetSel.title = 'Load a preset into this sound';
      presetSel.innerHTML = '<option value="">Presets…</option>' + ['Synth', 'Drum'].map(gname =>
        `<optgroup label="${gname}">` + S.PRESETS.filter(p => p.group === gname).map(p => `<option>${p.name}</option>`).join('') + '</optgroup>').join('');
      presetSel.onchange = () => { if (presetSel.value) app.applyPreset(presetSel.value); };
      actions.appendChild(presetSel);
      btn('Copy', 'Copy this sound (⌘⌥C)', () => app.copySound());
      btn('Paste', 'Paste a copied sound here (⌘⌥V)', () => app.pasteSound()).disabled = !app.clipboard;
      if (T.type === 'default') btn('Init', 'Reset the default sound to a basic synth', () => app.resetTarget());
      else if (T.owned) btn('Reset', 'Remove this custom sound and inherit again', () => app.resetTarget());
      if (T.type === 'note') btn('Delete', 'Delete note (⌫)', () => app.deleteNote(T.note.id), 'danger');
      head.appendChild(actions);

      // per-target extras
      if (T.type === 'note' || T.type === 'lane') {
        const extra = el('div', 'p-extra');
        if (T.type === 'note') {
          const k = new O.Knob({ def: { label: 'Velocity', min: 0.05, max: 1, def: 0.9, fmt: v => Math.round(v * 127) }, get: () => T.note.vel, set: v => app.setNoteVel(v), commit: () => app.commit('Velocity') });
          extra.appendChild(k.el); this.knobs.push({ k });
          extra.appendChild(el('div', '', `<div style="color:var(--dim);font-size:10.5px;line-height:1.5;padding-bottom:6px">Ring ${T.note.lane + 1} · ${app.laneLabel(T.note.lane)}<br>Step ${T.stepText}</div>`));
        } else {
          const lane = app.state.lanes[T.lane];
          const k = new O.Knob({ def: { label: 'Ring Note', min: -24, max: 24, def: 0, step: 1, fmt: v => O.Music.noteName(app.laneMidi(T.lane)) }, get: () => lane.pitchOffset || 0, set: v => app.setLanePitch(T.lane, v), commit: () => app.commit('Ring note') });
          if (s.kind !== 'drum') { extra.appendChild(k.el); this.knobs.push({ k }); }
          const m = el('button', 'toggle' + (lane.mute ? ' on' : ''), 'Mute'); m.onclick = () => app.toggleLane(T.lane, 'mute');
          const so = el('button', 'toggle' + (lane.solo ? ' on' : ''), 'Solo'); so.onclick = () => app.toggleLane(T.lane, 'solo');
          const clr = el('button', 'danger', 'Clear ring'); clr.onclick = () => app.clearLane(T.lane);
          [m, so, clr].forEach(b => { b.style.marginBottom = '8px'; extra.appendChild(b); });
        }
        head.appendChild(extra);
      }
      this.root.appendChild(head);

      // ---- Source ----
      const src = this.section('Source', null, true);
      src.appendChild(this.seg([{ v: 'synth', label: 'Synth' }, { v: 'drum', label: 'Drum' }], () => s.kind, v => app.setParam('kind', v, true)));
      if (s.kind === 'synth') {
        src.appendChild(this.waveSeg('wave', S.WAVES));
        const cv = el('canvas', 'viz'); src.appendChild(cv); this.vizzes.push(() => this.drawWave(cv));
        if (s.wave === 'custom') {
          src.appendChild(el('div', 'sub', 'Harmonics — drag to draw'));
          const hc = el('canvas', 'viz harm'); src.appendChild(hc); this.harmEditor(hc);
        }
        src.appendChild(this.row(['unison', 'spread', 'shape', 'noise']));
        src.appendChild(el('div', 'sub', 'Oscillator 2'));
        src.appendChild(this.waveSeg('osc2Wave', S.ENUMS.osc2Wave));
        src.appendChild(this.row(['osc2Mix', 'osc2Oct', 'osc2Semi', 'osc2Detune']));
        src.appendChild(el('div', 'sub', 'FM'));
        src.appendChild(this.row(['fmAmt', 'fmRatio']));
      } else {
        const grid = el('div', 'drumgrid');
        for (const d of S.DRUMS) {
          const b = el('button', s.drum === d.id ? 'on' : '', d.name);
          b.onclick = () => { app.setParam('drum', d.id, true); app.commit('Drum'); app.auditionTarget(); };
          grid.appendChild(b);
        }
        src.appendChild(grid);
        const cv = el('canvas', 'viz'); src.appendChild(cv); this.vizzes.push(() => this.drawHit(cv));
        src.appendChild(this.row(['drumDecay', 'drumTone', 'drumSnap', 'shape']));
      }

      // ---- Pitch ----
      const pit = this.section('Pitch');
      pit.appendChild(this.row(['transpose', 'fine', 'pitchEnv', 'pitchEnvTime']));
      if (s.kind === 'synth') pit.appendChild(this.row(['vibRate', 'vibDepth']));

      // ---- Envelope ----
      if (s.kind === 'synth') {
        const env = this.section('Envelope');
        const cv = el('canvas', 'viz small'); env.appendChild(cv); this.vizzes.push(() => this.drawEnv(cv));
        env.appendChild(this.row(['attack', 'decay', 'sustain', 'release']));
        env.appendChild(this.row(['length']));
      }

      // ---- Filter ----
      const fil = this.section('Filter', () => s.cutoff < 19000 || s.filterType !== 'lowpass');
      fil.appendChild(this.seg(S.ENUMS.filterType.map(v => ({ v, label: { lowpass: 'Low-pass', highpass: 'High-pass', bandpass: 'Band', notch: 'Notch' }[v] })), () => s.filterType, v => app.setParam('filterType', v)));
      const fcv = el('canvas', 'viz small'); fil.appendChild(fcv); this.vizzes.push(() => this.drawFilter(fcv));
      fil.appendChild(this.row(s.kind === 'synth' ? ['cutoff', 'resonance', 'filterEnv'] : ['cutoff', 'resonance']));

      // ---- Distortion ----
      const dist = this.section('Distortion', () => s.drive > 0.005 || s.crush > 0.01);
      dist.appendChild(this.row(['drive', 'distMix', 'crush']));

      // ---- EQ ----
      const eq = this.section('EQ', () => s.eqLow || s.eqMid || s.eqHigh);
      const ecv = el('canvas', 'viz small'); eq.appendChild(ecv); this.vizzes.push(() => this.drawEQ(ecv));
      eq.appendChild(this.row(['eqLow', 'eqMid', 'eqMidFreq', 'eqHigh']));

      // ---- Echo ----
      const echo = this.section('Echo', () => s.echoMix > 0.001);
      const divSel = el('select');
      divSel.innerHTML = S.ECHO_DIVS.map(d => `<option ${d === s.echoDiv ? 'selected' : ''}>${d}</option>`).join('');
      divSel.onchange = () => { app.setParam('echoDiv', divSel.value); app.commit('Echo time'); };
      const divWrap = el('div', 'knob'); divWrap.style.cursor = 'default'; divWrap.style.width = '64px';
      divWrap.append(el('div', 'k-label', 'Time'), divSel); divSel.style.marginTop = '8px'; divSel.style.width = '60px';
      const er = this.row(['echoFeedback', 'echoTone', 'echoMix']); er.prepend(divWrap);
      echo.appendChild(er);

      // ---- Reverb ----
      const rev = this.section('Reverb', () => s.reverbMix > 0.001);
      rev.appendChild(this.row(['reverbSize', 'reverbDamp', 'reverbMix']));

      // ---- Output ----
      const out = this.section('Output');
      out.appendChild(this.row(['volume', 'pan']));

      this.refreshInherited();
      this.drawAll();
      this.root.scrollTop = scroll;
    }

    section(name, ledFn, alwaysOpen) {
      const sec = el('div', 'sec' + (!alwaysOpen && this.closed[name] ? ' closed' : ''));
      const h = el('div', 'sec-h', `<span class="chev">▼</span><span>${name}</span>`);
      if (ledFn) { const led = el('span', 'led' + (ledFn() ? ' on' : '')); h.appendChild(led); this.vizzes.push(() => led.classList.toggle('on', !!ledFn())); }
      h.onclick = () => { if (alwaysOpen) return; this.closed[name] = !this.closed[name]; sec.classList.toggle('closed'); this.drawAll(); };
      const b = el('div', 'sec-b');
      sec.append(h, b);
      this.root.appendChild(sec);
      return b;
    }

    row(keys) {
      const r = el('div', 'row');
      const app = this.app;
      for (const key of keys) {
        const k = new O.Knob({
          def: P[key],
          get: () => this.T.sound[key],
          set: v => { app.setParam(key, v); this.afterChange(); },
          commit: () => app.commit(P[key].label)
        });
        r.appendChild(k.el);
        this.knobs.push({ k, key });
      }
      return r;
    }

    seg(opts, get, set) {
      const s = el('div', 'seg');
      for (const o of opts) {
        const b = el('button', get() === o.v ? 'on' : '', o.label);
        if (o.title) b.title = o.title;
        b.onclick = () => {
          set(o.v);
          [...s.children].forEach(c => c.classList.remove('on')); b.classList.add('on');
          this.app.commit('Change ' + o.v);
          this.afterChange();
        };
        s.appendChild(b);
      }
      return s;
    }

    waveSeg(key, list) {
      const opts = list.map(v => ({ v, label: `<svg viewBox="0 0 26 14"><path d="${WAVE_ICONS[v]}"/></svg>`, title: WAVE_NAMES[v] }));
      const sg = this.seg(opts, () => this.T.sound[key], v => {
        if (key === 'wave' && v === 'custom' && this.T.sound.wave !== 'custom') {
          this.app.setParam('harmonics', S.defaultHarmonics(this.T.sound.wave));
        }
        this.app.setParam(key, v, key === 'wave');
      });
      sg.classList.add('wave');
      return sg;
    }

    harmEditor(cv) {
      const app = this.app;
      const draw = () => {
        const { g, w, h } = this.prep(cv);
        const hs = this.T.sound.harmonics, n = hs.length, bw = w / n;
        for (let i = 0; i < n; i++) {
          const bh = hs[i] * (h - 14);
          g.fillStyle = 'rgba(60,240,180,0.12)'; g.fillRect(i * bw + 2, 4, bw - 4, h - 14);
          g.fillStyle = '#3cf0b4'; g.fillRect(i * bw + 2, h - 10 - bh, bw - 4, bh);
          g.fillStyle = '#4d6966'; g.font = '8px ui-monospace, monospace'; g.textAlign = 'center'; g.fillText(String(i + 1), i * bw + bw / 2, h - 2);
        }
      };
      this.vizzes.push(draw);
      let down = false;
      const setAt = e => {
        const r = cv.getBoundingClientRect();
        const i = Math.floor((e.clientX - r.left) / r.width * 16);
        if (i < 0 || i > 15) return;
        const v = Math.min(1, Math.max(0, 1 - (e.clientY - r.top - 4) / (r.height - 14)));
        const hs = this.T.sound.harmonics.slice(); hs[i] = Math.round(v * 100) / 100;
        app.setParam('harmonics', hs);
        this.afterChange();
      };
      cv.addEventListener('pointerdown', e => { down = true; cv.setPointerCapture(e.pointerId); setAt(e); });
      cv.addEventListener('pointermove', e => { if (down) setAt(e); });
      cv.addEventListener('pointerup', () => { if (down) { down = false; app.commit('Harmonics'); app.auditionTarget(); } });
    }

    afterChange() {
      for (const { k } of this.knobs) k.render();
      this.refreshInherited();
      this.drawAll();
    }

    retarget() {
      this.T = this.app.editTarget();
      if (this.badge) { this.badge.textContent = this.T.badge; this.badge.classList.toggle('custom', this.T.owned); }
    }

    refreshInherited() { for (const { k, key } of this.knobs) if (key) k.setInherited(!this.T.owned); }

    // refresh values without rebuilding (e.g. after undo where structure is unchanged)
    refresh() {
      const T = this.app.editTarget();
      if (!this.T || T.key !== this.T.key || T.sound.kind !== this.T.sound.kind || T.owned !== this.T.owned || (T.sound.wave === 'custom') !== (this.T.sound.wave === 'custom')) { this.build(); return; }
      this.T = T;
      this.afterChange();
    }

    // ---------------- visualisations ----------------
    prep(cv) {
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(60,240,180,0.07)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
      return { g, w, h };
    }

    drawAll() {
      cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(() => { for (const v of this.vizzes) try { v(); } catch (e) { console.warn(e); } });
    }

    drawWave(cv) {
      const s = this.T.sound;
      const { g, w, h } = this.prep(cv);
      const N = 400, cycles = 2, ys = new Float32Array(N);
      const r2 = Math.pow(2, s.osc2Oct + s.osc2Semi / 12 + s.osc2Detune / 1200);
      const I = s.fmAmt * 7;
      let mx = 0.0001;
      let seed = 3;
      for (let i = 0; i < N; i++) {
        const p = i / N * cycles;
        const pm = p + (I / (2 * Math.PI)) * Math.sin(2 * Math.PI * s.fmRatio * p);
        let y = waveSample(s.wave, pm, s.harmonics);
        if (s.osc2Mix > 0) y += s.osc2Mix * waveSample(s.osc2Wave, p * r2, s.harmonics);
        if (s.noise > 0) { seed = (seed * 16807) % 2147483647; y += s.noise * ((seed / 2147483647) * 2 - 1); }
        if (s.shape > 0.01) { const gg = 1 + s.shape * 6; y = Math.sin(Math.max(-1.5, Math.min(1.5, y * 0.6)) * gg * Math.PI / 2); }
        ys[i] = y; mx = Math.max(mx, Math.abs(y));
      }
      g.strokeStyle = '#3cf0b4'; g.lineWidth = 1.6; g.shadowColor = '#3cf0b4'; g.shadowBlur = 6;
      g.beginPath();
      for (let i = 0; i < N; i++) { const x = i / (N - 1) * w, y = h / 2 - ys[i] / mx * (h / 2 - 7); i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke(); g.shadowBlur = 0;
      g.fillStyle = '#4d6966'; g.font = '9px ui-monospace, monospace'; g.textAlign = 'left';
      g.fillText(WAVE_NAMES[s.wave].split(' ')[0].toUpperCase() + (s.osc2Mix > 0 ? ' + OSC2' : '') + (s.fmAmt > 0 ? ' + FM' : ''), 6, 11);
    }

    drawEnv(cv) {
      const s = this.T.sound;
      const { g, w, h } = this.prep(cv);
      const bpm = this.app.state.bpm;
      const gate = Math.max(s.length * 60 / bpm, s.attack);
      const total = gate + s.release * 1.1;
      const X = t => 6 + t / total * (w - 12), Y = v => h - 6 - v * (h - 14);
      g.beginPath(); g.moveTo(X(0), Y(0));
      const steps = 120;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps * total;
        let v;
        if (t < s.attack) v = t / s.attack;
        else if (t < gate) v = s.sustain + (1 - s.sustain) * Math.exp(-(t - s.attack) / (s.decay / 3));
        else {
          const tg = gate - s.attack;
          const vg = tg > 0 ? s.sustain + (1 - s.sustain) * Math.exp(-tg / (s.decay / 3)) : 1;
          v = vg * Math.exp(-(t - gate) / (s.release / 6));
        }
        g.lineTo(X(t), Y(v));
      }
      g.strokeStyle = '#49c6ff'; g.lineWidth = 1.6; g.stroke();
      g.lineTo(X(total), Y(0)); g.closePath(); g.fillStyle = 'rgba(73,198,255,0.1)'; g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.15)'; g.setLineDash([2, 3]);
      g.beginPath(); g.moveTo(X(gate), 4); g.lineTo(X(gate), h - 4); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#4d6966'; g.font = '9px ui-monospace, monospace'; g.textAlign = 'right'; g.fillText('note off', X(gate) - 4, 11);
    }

    drawResponse(cv, nodes, range, color, label) {
      const { g, w, h } = this.prep(cv);
      const N = 200, f = new Float32Array(N), mag = new Float32Array(N), ph = new Float32Array(N), tot = new Float32Array(N).fill(1);
      for (let i = 0; i < N; i++) f[i] = 20 * Math.pow(1000, i / (N - 1));
      for (const n of nodes) { n.getFrequencyResponse(f, mag, ph); for (let i = 0; i < N; i++) tot[i] *= mag[i]; }
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      [100, 1000, 10000].forEach(fr => { const x = Math.log(fr / 20) / Math.log(1000) * w; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); });
      g.beginPath();
      for (let i = 0; i < N; i++) {
        const db = 20 * Math.log10(Math.max(1e-5, tot[i]));
        const x = i / (N - 1) * w, y = h / 2 - Math.max(-range, Math.min(range, db)) / range * (h / 2 - 5);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.strokeStyle = color; g.lineWidth = 1.6; g.stroke();
      g.fillStyle = '#4d6966'; g.font = '9px ui-monospace, monospace'; g.textAlign = 'left'; g.fillText(label, 6, 11);
    }

    drawFilter(cv) {
      const s = this.T.sound, c = responseCtx();
      const b = c.createBiquadFilter(); b.type = s.filterType; b.frequency.value = s.cutoff;
      b.Q.value = (s.filterType === 'lowpass' || s.filterType === 'highpass') ? Math.min(26, 20 * Math.log10(Math.max(0.3, s.resonance)) * 1.05) : s.resonance;
      this.drawResponse(cv, [b], 30, '#ffcf4a', 'FILTER');
    }

    drawEQ(cv) {
      const s = this.T.sound, c = responseCtx();
      const lo = c.createBiquadFilter(); lo.type = 'lowshelf'; lo.frequency.value = 220; lo.gain.value = s.eqLow;
      const mi = c.createBiquadFilter(); mi.type = 'peaking'; mi.frequency.value = s.eqMidFreq; mi.Q.value = 0.9; mi.gain.value = s.eqMid;
      const hi = c.createBiquadFilter(); hi.type = 'highshelf'; hi.frequency.value = 4500; hi.gain.value = s.eqHigh;
      this.drawResponse(cv, [lo, mi, hi], 20, '#ff6fa8', 'EQ');
    }

    drawHit(cv) {
      const s = this.T.sound;
      const token = (this._hitToken = (this._hitToken || 0) + 1);
      clearTimeout(this._hitTimer);
      this._hitTimer = setTimeout(async () => {
        const dur = Math.min(2.5, Math.max(0.25, s.drumDecay * 1.4 + 0.05));
        let buf;
        try { buf = await O.DSP.renderHit(s, 60, dur, this.app.state.bpm); } catch (e) { return; }
        if (token !== this._hitToken) return;
        const { g, w, h } = this.prep(cv);
        const d = buf.getChannelData(0), per = d.length / w;
        let mx = 0.0001; for (let i = 0; i < d.length; i++) mx = Math.max(mx, Math.abs(d[i]));
        g.fillStyle = 'rgba(60,240,180,0.85)';
        for (let x = 0; x < w; x++) {
          let lo = 0, hi = 0;
          for (let i = Math.floor(x * per); i < Math.floor((x + 1) * per); i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
          const y0 = h / 2 - hi / mx * (h / 2 - 5), y1 = h / 2 - lo / mx * (h / 2 - 5);
          g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
        }
        g.fillStyle = '#4d6966'; g.font = '9px ui-monospace, monospace'; g.textAlign = 'left';
        g.fillText((S.DRUMS.find(x => x.id === s.drum) || {}).name.toUpperCase() + ' · ' + S.fmt.sec(dur), 6, 11);
      }, 60);
    }
  }

  O.Panel = Panel;
})();
