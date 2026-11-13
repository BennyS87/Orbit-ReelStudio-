// Orbit - application controller
(function () {
  const O = window.Orbit;
  const S = O.Sound, M = O.Music;
  const native = window.orbitNative || null;
  const $ = id => document.getElementById(id);

  const GRIDS = [
    { id: '1/4', spb: 1 }, { id: '1/8', spb: 2 }, { id: '1/8T', spb: 3 },
    { id: '1/16', spb: 4 }, { id: '1/16T', spb: 6 }, { id: '1/32', spb: 8 }
  ];
  const MAX_RINGS = 12, MIN_RINGS = 3;

  const makeLane = () => ({ sound: null, mute: false, solo: false, pitchOffset: 0 });

  function freshState() {
    return {
      bpm: 120, bars: 1, grid: '1/16', snap: true, swing: 0,
      key: 9, scale: 'Minor Pentatonic', octave: 3, masterVol: 0.8,
      defaultSound: S.presetSound('Glass Pluck'),
      lanes: Array.from({ length: 8 }, makeLane),
      notes: [], nextId: 1
    };
  }

  function demoState() {
    const s = freshState();
    s.bpm = 112;
    s.lanes[0].sound = S.presetSound('Kick');
    s.lanes[1].sound = S.presetSound('Clap');
    s.lanes[2].sound = S.presetSound('Closed Hat');
    s.lanes[3].sound = S.presetSound('Sub Bass'); s.lanes[3].pitchOffset = 5;
    const add = (lane, steps, vel) => steps.forEach(st => s.notes.push({ id: s.nextId++, lane, pos: st / 16, vel: vel || 0.9, sound: null }));
    add(0, [0, 4, 8, 12]);
    add(1, [4, 12], 0.85);
    add(2, [2, 6, 10, 14], 0.8); add(2, [15], 0.45);
    add(3, [0, 3, 8, 11, 14], 0.85);
    add(5, [0, 10]); add(6, [3, 13], 0.8); add(7, [6], 0.75); add(4, [8, 14], 0.7);
    return s;
  }

  function sanitizeState(o) {
    const s = freshState();
    if (!o || typeof o !== 'object') return s;
    const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
    s.bpm = Math.round(num(o.bpm, 30, 300, 120));
    s.bars = [0.5, 1, 2, 4, 8].includes(Number(o.bars)) ? Number(o.bars) : 1;
    s.grid = GRIDS.some(g => g.id === o.grid) ? o.grid : '1/16';
    s.snap = o.snap !== false;
    s.swing = num(o.swing, 0, 1, 0);
    s.key = Math.round(num(o.key, 0, 11, 9));
    s.scale = M.SCALES[o.scale] ? o.scale : 'Minor Pentatonic';
    s.octave = Math.round(num(o.octave, 0, 7, 3));
    s.masterVol = num(o.masterVol, 0, 1.2, 0.8);
    s.defaultSound = S.sanitize(o.defaultSound);
    if (Array.isArray(o.lanes) && o.lanes.length) {
      s.lanes = o.lanes.slice(0, MAX_RINGS).map(l => ({
        sound: l && l.sound ? S.sanitize(l.sound) : null, mute: !!(l && l.mute), solo: !!(l && l.solo),
        pitchOffset: Math.round(num(l && l.pitchOffset, -24, 24, 0))
      }));
      while (s.lanes.length < MIN_RINGS) s.lanes.push(makeLane());
    }
    s.notes = [];
    let maxId = 0;
    if (Array.isArray(o.notes)) for (const n of o.notes) {
      if (!n) continue;
      const lane = Math.round(num(n.lane, 0, s.lanes.length - 1, -1));
      if (lane < 0) continue;
      const id = Math.round(num(n.id, 1, 1e9, 0)) || (maxId + 1);
      maxId = Math.max(maxId, id);
      s.notes.push({ id, lane, pos: num(n.pos, 0, 0.999999, 0), vel: num(n.vel, 0.05, 1, 0.9), sound: n.sound ? S.sanitize(n.sound) : null });
    }
    s.nextId = Math.max(maxId + 1, Math.round(num(o.nextId, 1, 1e9, 1)));
    return s;
  }

  class App {
    constructor() {
      this.engine = new O.Engine();
      this.state = demoState();
      this.selection = { type: 'default' };
      this.undoStack = []; this.redoStack = [];
      this.lastSnap = this.serialize();
      this.clipboard = null;
      this.currentPath = null; this.dirty = false;

      this.engine.masterVolume = this.state.masterVol;
      this.sonar = new O.SonarView($('sonar'), this);
      this.panel = new O.Panel($('panel'), this);
      this.setupTopbar();
      this.setupKeys();
      this.setupNative();
      this.recompile();
      this.syncTopbar();
      this.renderLanes();
      this.panel.build();
      this.updateTitle();
      this.scopeLoop();
      // unlock audio on first interaction
      const unlock = () => { this.engine.resume(); window.removeEventListener('pointerdown', unlock, true); window.removeEventListener('keydown', unlock, true); };
      window.addEventListener('pointerdown', unlock, true);
      window.addEventListener('keydown', unlock, true);
    }

    // ---------------- music helpers ----------------
    steps() { const g = GRIDS.find(x => x.id === this.state.grid) || GRIDS[3]; return Math.max(1, Math.round(this.state.bars * 4 * g.spb)); }
    laneMidi(i) { const l = this.state.lanes[i]; return M.scaleMidi(this.state.key, this.state.octave, this.state.scale, i) + ((l && l.pitchOffset) || 0); }
    laneSound(i) { const l = this.state.lanes[i]; return (l && l.sound) || this.state.defaultSound; }
    soundLabel(s, midi) {
      if (s.kind === 'drum') { const d = S.DRUMS.find(x => x.id === s.drum); return d ? d.name : 'Drum'; }
      return M.noteName(midi + s.transpose + s.fine / 100);
    }
    laneLabel(i) { return this.soundLabel(this.laneSound(i), this.laneMidi(i)); }
    stepText(pos) {
      const steps = this.steps(), x = pos * steps;
      return Math.abs(x - Math.round(x)) < 1e-6 ? `${Math.round(x) + 1}/${steps}` : `${(x + 1).toFixed(2)}/${steps}`;
    }
    noteLabel(n) { const e = this.effectiveSound(n); return this.soundLabel(e.sound, this.laneMidi(n.lane)) + ' · ' + this.stepText(n.pos); }

    effectiveSound(n) {
      if (n.sound) return { sound: n.sound, key: 'n' + n.id, owner: 'note' };
      const lane = this.state.lanes[n.lane];
      if (lane && lane.sound) return { sound: lane.sound, key: 'l' + n.lane, owner: 'lane' };
      return { sound: this.state.defaultSound, key: 'd', owner: 'default' };
    }

    // ---------------- compile pattern for the engine ----------------
    compile() {
      const st = this.state;
      const solo = st.lanes.some(l => l.solo);
      const channels = new Map();
      channels.set('d', st.defaultSound);
      st.lanes.forEach((l, i) => { if (l.sound) channels.set('l' + i, l.sound); });
      const events = [];
      const sixteenths = st.bars * 16;
      for (const n of st.notes) {
        const lane = st.lanes[n.lane];
        if (!lane) continue;
        const eff = this.effectiveSound(n);
        channels.set(eff.key, eff.sound);
        if (lane.mute || (solo && !lane.solo)) continue;
        let t = n.pos;
        const x = n.pos * sixteenths, r = Math.round(x);
        if (st.swing > 0 && Math.abs(x - r) < 1e-4 && r % 2 === 1) t += st.swing * 0.5 / sixteenths;
        t = t % 1;
        events.push({ t, key: eff.key, sound: eff.sound, midi: this.laneMidi(n.lane), gate: eff.sound.length, vel: n.vel, noteId: n.id, lane: n.lane });
      }
      events.sort((a, b) => a.t - b.t);
      return { bpm: st.bpm, bars: st.bars, beatsPerBar: 4, events, channels };
    }
    recompile() { this.pattern = this.compile(); this.engine.setPattern(this.pattern); }

    // ---------------- selection & edit target ----------------
    select(sel) {
      if (sel.type === 'note' && !this.state.notes.find(n => n.id === sel.id)) sel = { type: 'default' };
      if (sel.type === 'lane' && !this.state.lanes[sel.lane]) sel = { type: 'default' };
      const same = JSON.stringify(sel) === JSON.stringify(this.selection);
      this.selection = sel;
      if (!same) { this.panel.build(); this.renderLanes(); }
    }

    editTarget() {
      const st = this.state, sel = this.selection;
      if (sel.type === 'note') {
        const n = st.notes.find(x => x.id === sel.id);
        if (n) {
          const e = this.effectiveSound(n);
          return {
            type: 'note', note: n, key: e.key, sound: e.sound, owned: !!n.sound,
            color: O.LANE_COLORS[n.lane % O.LANE_COLORS.length],
            title: `Note · ${this.soundLabel(e.sound, this.laneMidi(n.lane))}`,
            badge: n.sound ? 'Custom note sound' : (e.owner === 'lane' ? `Inherits ring ${n.lane + 1} sound — edit to customise this note` : 'Inherits default sound — edit to customise this note'),
            stepText: this.stepText(n.pos)
          };
        }
      }
      if (sel.type === 'lane' && st.lanes[sel.lane]) {
        const i = sel.lane, l = st.lanes[i];
        return {
          type: 'lane', lane: i, key: l.sound ? 'l' + i : 'd', sound: l.sound || st.defaultSound, owned: !!l.sound,
          color: O.LANE_COLORS[i % O.LANE_COLORS.length],
          title: `Ring ${i + 1} · ${this.laneLabel(i)}`,
          badge: l.sound ? 'Custom ring sound (used by its notes)' : 'Inherits default sound — edit to give this ring its own sound'
        };
      }
      return { type: 'default', key: 'd', sound: st.defaultSound, owned: true, color: '#3cf0b4', title: 'Default Sound', badge: 'Used by every ring & note without its own sound' };
    }

    // make sure the current target owns a sound; returns that sound
    ownTarget() {
      const T = this.editTarget();
      if (T.owned) return T.sound;
      const copy = S.clone(T.sound);
      if (T.type === 'note') T.note.sound = copy;
      else if (T.type === 'lane') this.state.lanes[T.lane].sound = copy;
      return copy;
    }
    assignTargetSound(s) {
      const T = this.editTarget();
      if (T.type === 'note') T.note.sound = s;
      else if (T.type === 'lane') this.state.lanes[T.lane].sound = s;
      else this.state.defaultSound = s;
    }

    setParam(key, v, rebuild) {
      const s = this.ownTarget();
      if (key === 'kind' && v !== s.kind) {
        if (v === 'drum') Object.assign(s, { cutoff: 20000, resonance: 1, filterEnv: 0, filterType: 'lowpass' });
        else if (s.cutoff > 19000) Object.assign(s, { cutoff: 6000, filterEnv: 1 });
      }
      s[key] = Array.isArray(v) ? v.slice() : v;
      this.recompile();
      this.markDirty();
      if (['kind', 'drum', 'transpose', 'fine'].includes(key)) this.renderLanes();
      if (rebuild) this.panel.build(); else this.panel.retarget();
    }

    setNoteVel(v) { const T = this.editTarget(); if (T.note) { T.note.vel = v; this.recompile(); this.markDirty(); } }
    setLanePitch(i, v) { this.state.lanes[i].pitchOffset = Math.round(v); this.recompile(); this.markDirty(); this.renderLanes(); this.panel.retarget(); }
    toggleLane(i, which) {
      this.state.lanes[i][which] = !this.state.lanes[i][which];
      this.recompile(); this.renderLanes(); this.commit(which);
      if (this.selection.type === 'lane' && this.selection.lane === i) this.panel.build();
    }
    clearLane(i) { this.state.notes = this.state.notes.filter(n => n.lane !== i); this.recompile(); this.commit('Clear ring'); this.toast(`Cleared ring ${i + 1}`); }

    applyPreset(name) {
      const T = this.editTarget();
      const ps = S.presetSound(name);
      if (T.type === 'default' && ps.kind === 'drum') {
        // switching the default to a drum is allowed but tell the user
        this.toast('Default sound is now a drum — every ring without its own sound uses it');
      }
      this.assignTargetSound(ps);
      this.recompile(); this.commit('Preset'); this.renderLanes(); this.panel.build();
      this.auditionTarget();
    }
    resetTarget() {
      const T = this.editTarget();
      if (T.type === 'default') this.state.defaultSound = S.baseSound();
      else if (T.type === 'note') T.note.sound = null;
      else this.state.lanes[T.lane].sound = null;
      this.recompile(); this.commit('Reset sound'); this.renderLanes(); this.panel.build();
    }
    copySound() { this.clipboard = S.clone(this.editTarget().sound); this.toast('Sound copied'); this.panel.build(); }
    pasteSound() {
      if (!this.clipboard) return;
      this.assignTargetSound(S.clone(this.clipboard));
      this.recompile(); this.commit('Paste sound'); this.renderLanes(); this.panel.build(); this.toast('Sound pasted');
    }

    // ---------------- notes ----------------
    addNote(lane, pos) {
      const st = this.state;
      const existing = st.notes.find(n => n.lane === lane && Math.abs(n.pos - pos) < 1e-6);
      if (existing) { this.select({ type: 'note', id: existing.id }); return null; }
      const n = { id: st.nextId++, lane, pos, vel: 0.9, sound: null };
      st.notes.push(n);
      this.recompile(); this.markDirty();
      this.auditionNote(n);
      return n;
    }
    moveNote(id, lane, pos) {
      const n = this.state.notes.find(x => x.id === id);
      if (!n) return;
      if (n.lane === lane && Math.abs(n.pos - pos) < 1e-9) return;
      if (this.state.notes.some(x => x !== n && x.lane === lane && Math.abs(x.pos - pos) < 1e-6)) return;
      const laneChanged = n.lane !== lane;
      n.lane = lane; n.pos = pos;
      this.recompile(); this.markDirty();
      if (laneChanged) { this.auditionNote(n); if (this.selection.type === 'note' && this.selection.id === id) this.panel.build(); }
    }
    deleteNote(id) {
      const st = this.state;
      const before = st.notes.length;
      st.notes = st.notes.filter(n => n.id !== id);
      if (st.notes.length === before) return;
      if (this.selection.type === 'note' && this.selection.id === id) this.select({ type: 'default' });
      this.recompile(); this.commit('Delete note');
    }
    nudgeSelected(dStep, dLane) {
      const T = this.editTarget(); if (!T.note) return;
      const n = T.note, steps = this.steps();
      let pos = n.pos, lane = n.lane;
      if (dStep) pos = ((Math.round(n.pos * steps) + dStep) % steps + steps) % steps / steps;
      if (dLane) lane = Math.max(0, Math.min(this.state.lanes.length - 1, n.lane + dLane));
      this.moveNote(n.id, lane, pos);
      this.commit('Nudge'); this.panel.build();
    }

    auditionNote(n) { const e = this.effectiveSound(n); this.engine.audition(e.key, e.sound, this.laneMidi(n.lane), n.vel); }
    auditionTarget() {
      const T = this.editTarget();
      const midi = T.note ? this.laneMidi(T.note.lane) : T.type === 'lane' ? this.laneMidi(T.lane) : this.laneMidi(Math.floor(this.state.lanes.length / 2));
      this.engine.audition(T.key, T.sound, midi, T.note ? T.note.vel : 0.9);
    }

    // ---------------- undo / dirty ----------------
    serialize() { return JSON.stringify(this.state); }
    commit() {
      const snap = this.serialize();
      if (snap === this.lastSnap) return;
      this.undoStack.push(this.lastSnap);
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack = [];
      this.lastSnap = snap;
      this.markDirty();
    }
    undo() { if (!this.undoStack.length) return; this.redoStack.push(this.lastSnap); this.lastSnap = this.undoStack.pop(); this.restore(this.lastSnap); this.markDirty(); }
    redo() { if (!this.redoStack.length) return; this.undoStack.push(this.lastSnap); this.lastSnap = this.redoStack.pop(); this.restore(this.lastSnap); this.markDirty(); }
    restore(snap) {
      this.state = sanitizeState(JSON.parse(snap));
      this.afterLoad(true);
    }
    afterLoad(keepSelection) {
      if (!keepSelection) this.selection = { type: 'default' };
      this.engine.setMasterVolume(this.state.masterVol);
      this.recompile();
      this.syncTopbar();
      this.renderLanes();
      const sel = this.selection;
      this.selection = { type: '__' };
      this.select(sel);
    }
    markDirty() { if (!this.dirty) { this.dirty = true; this.updateTitle(); } }
    updateTitle() {
      const name = this.currentPath ? this.currentPath.split(/[\\/]/).pop().replace(/\.orbit$/i, '') : 'Untitled';
      const t = `${name}${this.dirty ? ' •' : ''} — Orbit`;
      document.title = t;
      if (native) { native.setTitle(t); native.setDirty(this.dirty); }
    }

    // ---------------- transport ----------------
    togglePlay() {
      if (this.engine.playing) this.engine.stop(); else this.engine.start();
      const on = this.engine.playing;
      $('playBtn').classList.toggle('on', on);
      $('playIcon').setAttribute('d', on ? 'M6 5h4v14H6zM14 5h4v14h-4z' : 'M7 4.5v15l13-7.5z');
    }

    // ---------------- top bar ----------------
    setupTopbar() {
      const st = () => this.state;
      $('playBtn').onclick = () => this.togglePlay();
      const bpm = $('bpm');
      const setBpm = v => { v = Math.round(Math.min(300, Math.max(30, Number(v) || 120))); st().bpm = v; bpm.value = v; this.recompile(); };
      bpm.addEventListener('change', () => { setBpm(bpm.value); this.commit('Tempo'); });
      bpm.addEventListener('wheel', e => { e.preventDefault(); setBpm(st().bpm - Math.sign(e.deltaY)); clearTimeout(this._bt); this._bt = setTimeout(() => this.commit('Tempo'), 400); }, { passive: false });
      // drag on BPM label
      let dragY = null, startB = 0;
      bpm.parentElement.querySelector('label').style.cursor = 'ns-resize';
      bpm.parentElement.querySelector('label').addEventListener('pointerdown', e => { dragY = e.clientY; startB = st().bpm; e.target.setPointerCapture(e.pointerId); });
      bpm.parentElement.querySelector('label').addEventListener('pointermove', e => { if (dragY != null) setBpm(startB + Math.round((dragY - e.clientY) / 3)); });
      bpm.parentElement.querySelector('label').addEventListener('pointerup', () => { if (dragY != null) { dragY = null; this.commit('Tempo'); } });

      $('bars').onchange = () => { st().bars = Number($('bars').value); this.recompile(); this.commit('Loop length'); };

      const grid = $('grid');
      for (const g of GRIDS) {
        const b = document.createElement('button'); b.textContent = g.id; b.dataset.g = g.id;
        b.title = `Grid / sweep step: ${g.id} notes`;
        b.onclick = () => { st().grid = g.id; this.syncTopbar(); this.commit('Grid'); };
        grid.appendChild(b);
      }
      $('snapBtn').onclick = () => { st().snap = !st().snap; this.syncTopbar(); this.commit('Snap'); };
      $('swing').oninput = () => { st().swing = Number($('swing').value); $('swingVal').textContent = Math.round(st().swing * 100) + '%'; this.recompile(); };
      $('swing').onchange = () => this.commit('Swing');

      const rings = $('rings');
      for (let i = MIN_RINGS; i <= MAX_RINGS; i++) rings.add(new Option(String(i), i));
      rings.onchange = () => this.setRings(Number(rings.value));
      const key = $('key'); M.NOTE_NAMES.forEach((n, i) => key.add(new Option(n, i)));
      key.onchange = () => { st().key = Number(key.value); this.afterMusicChange(); };
      const scale = $('scale'); Object.keys(M.SCALES).forEach(n => scale.add(new Option(n, n)));
      scale.onchange = () => { st().scale = scale.value; this.afterMusicChange(); };
      const oct = $('octave'); for (let i = 1; i <= 6; i++) oct.add(new Option(String(i), i));
      oct.onchange = () => { st().octave = Number(oct.value); this.afterMusicChange(); };

      $('master').oninput = () => { st().masterVol = Number($('master').value); this.engine.setMasterVolume(st().masterVol); };
      $('master').onchange = () => this.commit('Master');

      $('newBtn').onclick = () => this.newProject();
      $('openBtn').onclick = () => this.openProject();
      $('saveBtn').onclick = () => this.saveProject(false);
      $('exportBtn').onclick = () => this.showExport();
      $('fileInput').onchange = async () => {
        const f = $('fileInput').files[0]; if (!f) return;
        this.loadProjectText(await f.text(), f.name); $('fileInput').value = '';
      };
    }
    afterMusicChange() { this.recompile(); this.renderLanes(); this.panel.retarget(); this.panel.build(); this.commit('Key/scale'); }

    async setRings(n) {
      const st = this.state;
      n = Math.max(MIN_RINGS, Math.min(MAX_RINGS, n));
      if (n < st.lanes.length) {
        const lost = st.notes.filter(x => x.lane >= n).length;
        if (lost && !(await this.confirm(`Remove ${st.lanes.length - n} outer ring(s)?`, `${lost} note(s) on those rings will be deleted.`))) { this.syncTopbar(); return; }
        st.notes = st.notes.filter(x => x.lane < n);
        st.lanes.length = n;
      } else while (st.lanes.length < n) st.lanes.push(makeLane());
      if (this.selection.type === 'lane' && this.selection.lane >= n) this.select({ type: 'default' });
      this.recompile(); this.renderLanes(); this.commit('Rings'); this.syncTopbar();
    }

    syncTopbar() {
      const st = this.state;
      $('bpm').value = st.bpm;
      $('bars').value = String(st.bars);
      [...$('grid').children].forEach(b => b.classList.toggle('on', b.dataset.g === st.grid));
      $('snapBtn').classList.toggle('on', st.snap);
      $('swing').value = st.swing; $('swingVal').textContent = Math.round(st.swing * 100) + '%';
      $('rings').value = String(st.lanes.length);
      $('key').value = String(st.key); $('scale').value = st.scale; $('octave').value = String(st.octave);
      $('master').value = st.masterVol;
    }

    // ---------------- lanes list ----------------
    renderLanes() {
      const root = $('lanes'), st = this.state, sel = this.selection;
      root.innerHTML = '<h3>Rings</h3>';
      for (let i = st.lanes.length - 1; i >= 0; i--) {
        const l = st.lanes[i], s = this.laneSound(i);
        const row = document.createElement('div');
        const solo = st.lanes.some(x => x.solo);
        row.className = 'lane' + (sel.type === 'lane' && sel.lane === i ? ' sel' : '') + (l.mute || (solo && !l.solo) ? ' muted' : '');
        const col = O.LANE_COLORS[i % O.LANE_COLORS.length];
        const count = st.notes.filter(n => n.lane === i).length;
        row.innerHTML = `<span class="dot ${s.kind === 'drum' ? 'drum' : ''}" style="background:${col};box-shadow:0 0 6px ${col}"></span>
          <span class="nm">${this.laneLabel(i)}<small>ring ${i + 1} · ${count}♪${l.sound ? ' · <b>own</b>' : ''}</small></span>
          <span class="ms"><button class="m ${l.mute ? 'on' : ''}" title="Mute">M</button><button class="s ${l.solo ? 'on' : ''}" title="Solo">S</button></span>`;
        row.onclick = e => { if (e.target.closest('button')) return; this.select({ type: 'lane', lane: i }); this.engine.audition(l.sound ? 'l' + i : 'd', s, this.laneMidi(i), 0.85); };
        row.querySelector('.m').onclick = () => this.toggleLane(i, 'mute');
        row.querySelector('.s').onclick = () => this.toggleLane(i, 'solo');
        root.appendChild(row);
      }
      const def = document.createElement('div');
      def.className = 'lane default-row' + (sel.type === 'default' ? ' sel' : '');
      const ds = st.defaultSound;
      def.innerHTML = `<span class="dot ${ds.kind === 'drum' ? 'drum' : ''}" style="background:#d3ece6"></span><span class="nm">Default sound<small>${ds.kind === 'drum' ? 'drum' : ds.wave}</small></span>`;
      def.onclick = () => this.select({ type: 'default' });
      root.appendChild(def);
      const tip = document.createElement('div'); tip.className = 'lane-tip';
      tip.innerHTML = 'Inner rings are lower notes. Click a ring name to give the whole ring its own sound (e.g. a kick), or click a note to change just that note.';
      root.appendChild(tip);
    }

    // ---------------- keyboard ----------------
    setupKeys() {
      window.addEventListener('keydown', e => {
        const tag = (e.target.tagName || '').toLowerCase();
        const typing = tag === 'input' && e.target.type !== 'range' || tag === 'select' || tag === 'textarea';
        const mod = e.metaKey || e.ctrlKey;
        if (document.querySelector('.modal-back')) { if (e.key === 'Escape') this.closeModal(); return; }
        if (e.code === 'Space' && !typing) { e.preventDefault(); this.togglePlay(); return; }
        if (typing) return;
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection.type === 'note') { e.preventDefault(); this.deleteNote(this.selection.id); return; }
        if (e.key === 'Escape') { this.select({ type: 'default' }); return; }
        if (this.selection.type === 'note' && !mod) {
          if (e.key === 'ArrowLeft') { e.preventDefault(); this.nudgeSelected(-1, 0); return; }
          if (e.key === 'ArrowRight') { e.preventDefault(); this.nudgeSelected(1, 0); return; }
          if (e.key === 'ArrowUp') { e.preventDefault(); this.nudgeSelected(0, 1); return; }
          if (e.key === 'ArrowDown') { e.preventDefault(); this.nudgeSelected(0, -1); return; }
        }
        if (native) return; // the native menu handles the shortcuts below
        if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
        else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); }
        else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); this.saveProject(e.shiftKey); }
        else if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); this.openProject(); }
        else if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); this.showExport(e.shiftKey ? 'midi' : 'mp3'); }
        else if (mod && e.altKey && e.code === 'KeyC') { e.preventDefault(); this.copySound(); }
        else if (mod && e.altKey && e.code === 'KeyV') { e.preventDefault(); this.pasteSound(); }
      });
    }

    setupNative() {
      if (!native) return;
      native.onMenu(async cmd => {
        switch (cmd) {
          case 'new': return this.newProject();
          case 'open': return this.openProject();
          case 'save': return this.saveProject(false);
          case 'save-as': return this.saveProject(true);
          case 'export-mp3': return this.showExport('mp3');
          case 'export-wav': return this.showExport('wav');
          case 'export-midi': return this.showExport('midi');
          case 'undo': { const t = document.activeElement; if (t && t.tagName === 'INPUT' && t.type === 'number') return; return this.undo(); }
          case 'redo': return this.redo();
          case 'copy-sound': return this.copySound();
          case 'paste-sound': return this.pasteSound();
          case 'clear': return this.clearAll();
          case 'toggle-play': return this.togglePlay();
          case 'save-then-close': if (await this.saveProject(false)) native.closeNow(); return;
        }
      });
      native.onOpenProject(({ path, content }) => this.loadProjectText(content, path));
    }

    async clearAll() {
      if (!this.state.notes.length) return;
      if (!(await this.confirm('Clear all notes?', 'You can undo this.'))) return;
      this.state.notes = []; this.select({ type: 'default' }); this.recompile(); this.commit('Clear');
    }

    // ---------------- files ----------------
    async confirm(message, detail) {
      if (native) return (await native.confirm({ message, detail, buttons: ['OK', 'Cancel'] })) === 0;
      return window.confirm(message + (detail ? '\n\n' + detail : ''));
    }

    async newProject() {
      if (this.dirty && !(await this.confirm('Start a new project?', 'Unsaved changes will be lost.'))) return;
      this.engine.stop(); if (this.engine.playing === false) this.togglePlayUI(false);
      this.state = freshState(); this.currentPath = null;
      this.undoStack = []; this.redoStack = []; this.lastSnap = this.serialize();
      this.afterLoad(false); this.dirty = false; this.updateTitle();
    }
    togglePlayUI(on) { $('playBtn').classList.toggle('on', on); $('playIcon').setAttribute('d', on ? 'M6 5h4v14H6zM14 5h4v14h-4z' : 'M7 4.5v15l13-7.5z'); }

    projectJSON() { return JSON.stringify(Object.assign({ app: 'Orbit', format: 1, savedAt: new Date().toISOString() }, this.state), null, 1); }

    async saveProject(saveAs) {
      const data = this.projectJSON();
      const name = (this.currentPath ? this.currentPath.split(/[\\/]/).pop() : 'Untitled.orbit');
      if (native) {
        const p = await native.saveFile({ defaultPath: name, filters: [{ name: 'Orbit Project', extensions: ['orbit'] }], data, path: saveAs ? null : this.currentPath });
        if (!p) return false;
        this.currentPath = p;
      } else {
        this.download(new Blob([data], { type: 'application/json' }), name);
        this.currentPath = name;
      }
      this.dirty = false; this.updateTitle(); this.toast('Project saved');
      return true;
    }

    async openProject() {
      if (this.dirty && !(await this.confirm('Open another project?', 'Unsaved changes will be lost.'))) return;
      if (native) {
        const r = await native.openFile({ filters: [{ name: 'Orbit Project', extensions: ['orbit', 'json'] }] });
        if (r) this.loadProjectText(r.content, r.path);
      } else $('fileInput').click();
    }

    loadProjectText(text, path) {
      let obj;
      try { obj = JSON.parse(text); } catch (e) { this.toast('That file is not a valid Orbit project'); return; }
      this.state = sanitizeState(obj);
      this.currentPath = path || null;
      this.undoStack = []; this.redoStack = []; this.lastSnap = this.serialize();
      this.afterLoad(false);
      this.dirty = false; this.updateTitle();
      this.toast('Project loaded');
    }

    download(blob, name) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }

    async saveBinary(name, ext, label, bytes) {
      if (native) return native.saveFile({ defaultPath: name, filters: [{ name: label, extensions: [ext] }], data: bytes, encoding: 'binary' });
      this.download(new Blob([bytes]), name); return name;
    }

    // ---------------- export ----------------
    showExport(fmt) {
      fmt = fmt || 'mp3';
      const root = $('modalRoot');
      root.innerHTML = `<div class="modal-back"><div class="modal">
        <h2>Export loop</h2>
        <div class="mrow"><label>Format</label><div class="seg" id="exFmt"><button data-v="mp3">MP3</button><button data-v="wav">WAV</button><button data-v="midi">MIDI</button></div></div>
        <div class="mrow"><label>Repeat loop</label><select id="exLoops"><option>1</option><option>2</option><option selected>4</option><option>8</option><option>16</option></select></div>
        <div class="mrow audio-only"><label>Ending</label><select id="exTail">
          <option value="wrap">Seamless loop (tails wrap to start)</option>
          <option value="ring">Let echoes &amp; reverb ring out</option>
          <option value="cut">Cut exactly at loop end</option></select></div>
        <div class="mrow mp3-only"><label>MP3 quality</label><select id="exKbps"><option>128</option><option selected>192</option><option>256</option><option>320</option></select></div>
        <p class="note" id="exNote"></p>
        <div class="progress" id="exProg"><div></div></div>
        <div class="mfoot"><button id="exCancel" class="ghost">Cancel</button><button id="exGo" class="accent">Export</button></div>
      </div></div>`;
      let cur = fmt;
      const upd = () => {
        [...$('exFmt').children].forEach(b => b.classList.toggle('on', b.dataset.v === cur));
        root.querySelectorAll('.audio-only').forEach(e => e.style.display = cur === 'midi' ? 'none' : '');
        root.querySelectorAll('.mp3-only').forEach(e => e.style.display = cur === 'mp3' ? '' : 'none');
        const L = this.state.bars * 4 * 60 / this.state.bpm;
        $('exNote').textContent = cur === 'midi'
          ? 'MIDI contains one track per ring. Drum sounds go to channel 10 using General MIDI drum notes; synth notes use each ring\'s pitch.'
          : `One loop is ${L.toFixed(2)}s at ${this.state.bpm} BPM. Audio is rendered offline at 44.1kHz with every sound and effect.`;
      };
      [...$('exFmt').children].forEach(b => b.onclick = () => { cur = b.dataset.v; upd(); });
      upd();
      $('exCancel').onclick = () => this.closeModal();
      root.querySelector('.modal-back').addEventListener('pointerdown', e => { if (e.target.classList.contains('modal-back')) this.closeModal(); });
      $('exGo').onclick = async () => {
        $('exGo').disabled = true; $('exCancel').disabled = true;
        const prog = $('exProg'); prog.style.display = 'block';
        const bar = prog.firstElementChild;
        try {
          const path = await this.doExport(cur, Number($('exLoops').value), $('exTail').value, Number($('exKbps').value), p => { bar.style.width = Math.round(p * 100) + '%'; });
          this.closeModal();
          if (path) this.toast('Exported ' + String(path).split(/[\\/]/).pop());
        } catch (err) {
          console.error(err);
          $('exNote').textContent = 'Export failed: ' + err.message;
          $('exGo').disabled = false; $('exCancel').disabled = false;
        }
      };
    }
    closeModal() { $('modalRoot').innerHTML = ''; }

    baseName() { return this.currentPath ? this.currentPath.split(/[\\/]/).pop().replace(/\.orbit$/i, '') : 'Orbit Loop'; }

    async doExport(fmt, loops, tailMode, kbps, onProgress) {
      const p = this.compile();
      const name = this.baseName();
      if (fmt === 'midi') {
        const names = this.state.lanes.map((_, i) => `Ring ${i + 1} ${this.laneLabel(i)}`);
        const bytes = O.Export.buildMidi(p, names, loops);
        onProgress(1);
        return this.saveBinary(name + '.mid', 'mid', 'MIDI File', bytes);
      }
      onProgress(0.05);
      const buffer = await this.renderAudio(p, loops, tailMode);
      onProgress(0.3);
      if (fmt === 'wav') {
        const bytes = O.Export.encodeWav(buffer); onProgress(1);
        return this.saveBinary(name + '.wav', 'wav', 'WAV Audio', bytes);
      }
      const bytes = await O.Export.encodeMp3(buffer, kbps, f => onProgress(0.3 + f * 0.7));
      return this.saveBinary(name + '.mp3', 'mp3', 'MP3 Audio', bytes);
    }

    async renderAudio(p, loops, tailMode) {
      const sr = 44100;
      const L = p.bars * p.beatsPerBar * 60 / p.bpm;
      let maxTail = 0.3;
      for (const s of p.channels.values()) {
        maxTail = Math.max(maxTail, (s.kind === 'synth' ? s.release : s.drumDecay) + 0.2);
        if (s.reverbMix > 0.001) maxTail = Math.max(maxTail, s.reverbSize + 0.3);
        if (s.echoMix > 0.001) maxTail = Math.max(maxTail, Math.min(12, (S.ECHO_BEATS[s.echoDiv] || 0.5) * 60 / p.bpm * Math.log(0.001) / Math.log(Math.max(0.05, s.echoFeedback))));
      }
      maxTail = Math.min(maxTail, 14);
      const loopLen = Math.round(L * loops * sr);
      if (tailMode === 'cut') {
        const b = await O.DSP.renderOffline(p, loops, 0, sr, this.state.masterVol);
        return this.sliceBuffer(b, loopLen);
      }
      const b = await O.DSP.renderOffline(p, loops, maxTail, sr, this.state.masterVol);
      if (tailMode === 'ring') return O.Export.trimTail(b, L * loops);
      // wrap: fold everything after the loop end back onto the start
      const out = new AudioBuffer({ length: loopLen, numberOfChannels: 2, sampleRate: sr });
      for (let c = 0; c < 2; c++) {
        const src = b.getChannelData(c), dst = new Float32Array(loopLen);
        dst.set(src.subarray(0, loopLen));
        for (let i = loopLen; i < src.length; i++) dst[(i - loopLen) % loopLen] += src[i];
        out.copyToChannel(dst, c);
      }
      return out;
    }
    sliceBuffer(b, len) {
      len = Math.min(len, b.length);
      const out = new AudioBuffer({ length: len, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
      for (let c = 0; c < b.numberOfChannels; c++) out.copyToChannel(b.getChannelData(c).subarray(0, len).slice(), c);
      return out;
    }

    // ---------------- misc UI ----------------
    toast(msg) {
      const t = $('toast'); t.textContent = msg; t.classList.add('show');
      clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('show'), 2200);
    }

    scopeLoop() {
      const cv = $('scope'), g = cv.getContext('2d');
      let data = null, W = 0, H = 0;
      const draw = () => {
        const dpr = window.devicePixelRatio || 1;
        if (cv.clientWidth !== W || cv.clientHeight !== H) { W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; }
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, W, H);
        g.strokeStyle = 'rgba(60,240,180,0.1)'; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
        const an = this.engine.analyser;
        if (an) {
          if (!data) data = new Float32Array(an.fftSize);
          an.getFloatTimeDomainData(data);
          // find a rising zero-crossing for a stable display
          let start = 0;
          for (let i = 1; i < data.length / 2; i++) if (data[i - 1] < 0 && data[i] >= 0) { start = i; break; }
          g.strokeStyle = '#3cf0b4'; g.lineWidth = 1.2; g.beginPath();
          const n = 700;
          for (let i = 0; i < n; i++) { const v = data[start + i] || 0; const x = i / (n - 1) * W, y = H / 2 - Math.max(-1, Math.min(1, v)) * (H / 2 - 3); i ? g.lineTo(x, y) : g.moveTo(x, y); }
          g.stroke();
        }
        requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
    }
  }

  window.addEventListener('DOMContentLoaded', () => { window.app = new App(); });
  // keep Space for play/stop: don't leave buttons focused after clicking them
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('button'); if (b) b.blur(); }, true);
  O.sanitizeState = sanitizeState;
})();
