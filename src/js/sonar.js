// Orbit - sonar circle view (canvas) + interaction
(function () {
  const O = (window.Orbit = window.Orbit || {});
  const TAU = Math.PI * 2;

  const LANE_COLORS = ['#3cf0b4', '#49c6ff', '#ffcf4a', '#ff6fa8', '#a68bff', '#7dff6a', '#ff9b4a', '#4ae0ff', '#ff5d5d', '#d7ff4a', '#c58bff', '#4affc3'];
  O.LANE_COLORS = LANE_COLORS;

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  class SonarView {
    constructor(canvas, app) {
      this.c = canvas; this.app = app; this.g = canvas.getContext('2d');
      this.hover = null; this.drag = null; this.dpr = 1;
      this.resize();
      new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
      this.bind();
      const loop = () => { this.draw(); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }

    resize() {
      const r = this.c.parentElement.getBoundingClientRect();
      this.dpr = window.devicePixelRatio || 1;
      this.w = r.width; this.h = r.height;
      this.c.width = Math.round(r.width * this.dpr); this.c.height = Math.round(r.height * this.dpr);
    }

    geom() {
      const st = this.app.state;
      const cx = this.w / 2, cy = this.h / 2 - 8;
      const R = Math.max(80, Math.min(this.w, this.h - 30) / 2 - 52);
      const Rin = R * 0.17;
      const N = st.lanes.length;
      const sp = (R - Rin) / N;
      return { cx, cy, R, Rin, N, sp, laneR: i => Rin + (i + 1) * sp };
    }

    posToXY(pos, lane, G) {
      const a = pos * TAU - Math.PI / 2, r = G.laneR(lane);
      return [G.cx + r * Math.cos(a), G.cy + r * Math.sin(a)];
    }

    // pointer -> {lane, pos, inHub, outside}
    locate(x, y) {
      const G = this.geom();
      const dx = x - G.cx, dy = y - G.cy, d = Math.hypot(dx, dy);
      let pos = Math.atan2(dx, -dy) / TAU; if (pos < 0) pos += 1;
      const lane = Math.round((d - G.Rin) / G.sp) - 1;
      const res = { pos, d, G, lane: null, inHub: d < G.Rin + G.sp * 0.45, outside: d > G.R + G.sp * 0.55 };
      if (!res.inHub && !res.outside) res.lane = Math.max(0, Math.min(G.N - 1, lane));
      return res;
    }

    snapPos(pos) {
      const app = this.app;
      if (!app.state.snap) return pos;
      const steps = app.steps();
      return (Math.round(pos * steps) % steps) / steps;
    }

    noteAt(x, y) {
      const G = this.geom();
      let best = null, bd = Math.max(10, Math.min(16, G.sp * 0.42));
      for (const n of this.app.state.notes) {
        if (n.lane >= G.N) continue;
        const [nx, ny] = this.posToXY(n.pos, n.lane, G);
        const d = Math.hypot(nx - x, ny - y);
        if (d < bd) { bd = d; best = n; }
      }
      return best;
    }

    bind() {
      const c = this.c, app = this.app;
      const pt = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

      c.addEventListener('contextmenu', e => {
        e.preventDefault();
        const [x, y] = pt(e);
        const n = this.noteAt(x, y);
        if (n) app.deleteNote(n.id);
      });

      c.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        const [x, y] = pt(e);
        const hit = this.noteAt(x, y);
        if (hit) {
          if (e.altKey) { app.deleteNote(hit.id); return; }
          app.select({ type: 'note', id: hit.id });
          app.auditionNote(hit);
          this.drag = { id: hit.id, x, y, moved: false };
          c.setPointerCapture(e.pointerId);
          return;
        }
        const L = this.locate(x, y);
        if (L.inHub) { app.togglePlay(); return; }
        if (L.lane == null) { app.select({ type: 'default' }); return; }
        const pos = this.snapPos(L.pos);
        const n = app.addNote(L.lane, pos);
        if (n) {
          this.drag = { id: n.id, x, y, moved: false, created: true };
          c.setPointerCapture(e.pointerId);
        }
      });

      c.addEventListener('pointermove', e => {
        const [x, y] = pt(e);
        if (this.drag) {
          if (!this.drag.moved && Math.hypot(x - this.drag.x, y - this.drag.y) < 4) return;
          this.drag.moved = true;
          const L = this.locate(x, y);
          const lane = L.lane == null ? null : L.lane;
          if (lane != null) app.moveNote(this.drag.id, lane, this.snapPos(L.pos), false);
          return;
        }
        const n = this.noteAt(x, y);
        if (n) { this.hover = { note: n }; c.style.cursor = 'pointer'; return; }
        const L = this.locate(x, y);
        c.style.cursor = L.inHub ? 'pointer' : (L.lane == null ? 'default' : 'crosshair');
        this.hover = L.lane == null ? (L.inHub ? { hub: true } : null) : { lane: L.lane, pos: this.snapPos(L.pos) };
      });

      const up = () => {
        if (!this.drag) return;
        if (this.drag.moved) app.commit(this.drag.created ? 'Add note' : 'Move note');
        else if (this.drag.created) app.commit('Add note');
        this.drag = null;
      };
      c.addEventListener('pointerup', up);
      c.addEventListener('pointercancel', up);
      c.addEventListener('pointerleave', () => { if (!this.drag) this.hover = null; });
    }

    draw() {
      const g = this.g, app = this.app, st = app.state;
      if (!this.w) return;
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      g.clearRect(0, 0, this.w, this.h);
      const G = this.geom();
      const { cx, cy, R, Rin, N } = G;
      const steps = app.steps();
      const beatsPerLoop = st.bars * 4;
      const stepsPerBeat = steps / beatsPerLoop;
      const accent = '#3cf0b4';

      // glow backdrop
      const bgG = g.createRadialGradient(cx, cy, Rin, cx, cy, R + 40);
      bgG.addColorStop(0, 'rgba(20,60,55,0.35)'); bgG.addColorStop(1, 'rgba(5,12,14,0)');
      g.fillStyle = bgG; g.beginPath(); g.arc(cx, cy, R + 40, 0, TAU); g.fill();

      // bezel
      g.lineWidth = 1; g.strokeStyle = '#1d3a40';
      g.beginPath(); g.arc(cx, cy, R + 18, 0, TAU); g.stroke();
      g.beginPath(); g.arc(cx, cy, R + 34, 0, TAU); g.strokeStyle = '#122429'; g.stroke();

      // spokes + ticks
      for (let i = 0; i < steps; i++) {
        const a = i / steps * TAU - Math.PI / 2;
        const isBeat = Math.abs(i / stepsPerBeat - Math.round(i / stepsPerBeat)) < 1e-6;
        const beatIdx = Math.round(i / stepsPerBeat);
        const isBar = isBeat && beatIdx % 4 === 0;
        const cos = Math.cos(a), sin = Math.sin(a);
        g.strokeStyle = isBar ? 'rgba(60,240,180,0.30)' : isBeat ? 'rgba(60,240,180,0.15)' : 'rgba(60,240,180,0.06)';
        g.lineWidth = isBar ? 1.4 : 1;
        g.beginPath(); g.moveTo(cx + Rin * cos, cy + Rin * sin); g.lineTo(cx + R * cos, cy + R * sin); g.stroke();
        // tick on bezel
        const t0 = R + 18, t1 = R + 18 + (isBar ? 12 : isBeat ? 8 : 4);
        g.strokeStyle = isBeat ? 'rgba(60,240,180,0.55)' : 'rgba(60,240,180,0.22)';
        g.beginPath(); g.moveTo(cx + t0 * cos, cy + t0 * sin); g.lineTo(cx + t1 * cos, cy + t1 * sin); g.stroke();
        if (isBeat && (steps <= 128 || isBar)) {
          const label = st.bars > 1 ? `${Math.floor(beatIdx / 4) + 1}.${(beatIdx % 4) + 1}` : String(beatIdx + 1);
          const lr = R + 44;
          g.fillStyle = isBar ? 'rgba(60,240,180,0.8)' : 'rgba(124,154,150,0.75)';
          g.font = `${isBar ? 600 : 500} 10px ui-monospace, Menlo, monospace`;
          g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(label, cx + lr * cos, cy + lr * sin);
        }
      }

      // rings (lanes)
      const sel = app.selection;
      const solo = st.lanes.some(l => l.solo);
      for (let i = 0; i < N; i++) {
        const lane = st.lanes[i];
        const col = LANE_COLORS[i % LANE_COLORS.length];
        const muted = lane.mute || (solo && !lane.solo);
        const r = G.laneR(i);
        const isSel = sel.type === 'lane' && sel.lane === i;
        const isHover = this.hover && this.hover.lane === i;
        g.lineWidth = isSel ? 2.2 : 1.3;
        g.setLineDash(muted ? [3, 5] : []);
        g.strokeStyle = hexA(col, muted ? 0.15 : isSel ? 0.85 : isHover ? 0.55 : 0.3);
        if (isSel) { g.shadowColor = col; g.shadowBlur = 10; }
        g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke();
        g.shadowBlur = 0;
      }
      g.setLineDash([]);

      // sweep
      const phase = app.engine.phase();
      if (phase != null) {
        const a = phase * TAU - Math.PI / 2;
        const trail = 1.15;
        if (g.createConicGradient) {
          const cg = g.createConicGradient(a - trail, cx, cy);
          const f = trail / TAU;
          cg.addColorStop(0, 'rgba(60,240,180,0)');
          cg.addColorStop(f * 0.7, 'rgba(60,240,180,0.06)');
          cg.addColorStop(f, 'rgba(60,240,180,0.26)');
          cg.addColorStop(Math.min(1, f + 0.0005), 'rgba(60,240,180,0)');
          cg.addColorStop(1, 'rgba(60,240,180,0)');
          g.fillStyle = cg;
          g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R + 2, a - trail, a); g.closePath(); g.fill();
        }
        g.strokeStyle = 'rgba(170,255,225,0.95)'; g.lineWidth = 2; g.shadowColor = accent; g.shadowBlur = 14;
        g.beginPath(); g.moveTo(cx + Rin * Math.cos(a), cy + Rin * Math.sin(a)); g.lineTo(cx + (R + 18) * Math.cos(a), cy + (R + 18) * Math.sin(a)); g.stroke();
        g.shadowBlur = 0;
      }

      // hits map
      const now = app.engine.now();
      const hitAge = new Map();
      if (app.engine.playing) for (const h of app.engine.hits) {
        const age = now - h.time;
        if (age >= 0 && age < 0.6) { const prev = hitAge.get(h.id); if (prev == null || age < prev) hitAge.set(h.id, age); }
      }

      // notes
      const baseSize = Math.max(5, Math.min(9, G.sp * 0.27));
      for (const n of st.notes) {
        if (n.lane >= N) continue;
        const lane = st.lanes[n.lane];
        const col = LANE_COLORS[n.lane % LANE_COLORS.length];
        const muted = lane.mute || (solo && !lane.solo);
        const [x, y] = this.posToXY(n.pos, n.lane, G);
        const eff = app.effectiveSound(n);
        const isDrum = eff.sound.kind === 'drum';
        const size = baseSize * (0.75 + n.vel * 0.35);
        const age = hitAge.get(n.id);
        g.globalAlpha = muted ? 0.3 : 1;
        if (age != null) {
          const k = 1 - age / 0.6;
          g.strokeStyle = hexA(col, k * 0.9); g.lineWidth = 2;
          g.beginPath(); g.arc(x, y, size + 4 + (1 - k) * 22, 0, TAU); g.stroke();
          g.shadowColor = col; g.shadowBlur = 24 * k;
        } else { g.shadowColor = col; g.shadowBlur = 8; }
        g.fillStyle = age != null ? '#ffffff' : col;
        this.shape(g, x, y, size, isDrum);
        g.fill();
        g.shadowBlur = 0;
        if (age != null) { g.fillStyle = hexA(col, 1 - Math.min(1, age / 0.25)); this.shape(g, x, y, size, isDrum); g.fill(); }
        // custom sound marker
        if (n.sound) { g.fillStyle = '#05090c'; g.beginPath(); g.arc(x, y, size * 0.38, 0, TAU); g.fill(); }
        // selection
        if (sel.type === 'note' && sel.id === n.id) {
          g.strokeStyle = '#ffffff'; g.lineWidth = 1.5;
          g.setLineDash([3, 3]); g.lineDashOffset = -performance.now() / 60;
          g.beginPath(); g.arc(x, y, size + 6, 0, TAU); g.stroke();
          g.setLineDash([]);
        }
        g.globalAlpha = 1;
      }

      // ghost / hover
      if (this.hover && this.hover.lane != null && !this.drag) {
        const { lane, pos } = this.hover;
        const exists = st.notes.some(n => n.lane === lane && Math.abs(n.pos - pos) < 1e-6);
        if (!exists) {
          const [x, y] = this.posToXY(pos, lane, G);
          const col = LANE_COLORS[lane % LANE_COLORS.length];
          g.strokeStyle = hexA(col, 0.8); g.lineWidth = 1.5;
          g.beginPath(); g.arc(x, y, baseSize, 0, TAU); g.stroke();
          g.fillStyle = 'rgba(211,236,230,0.85)'; g.font = '500 10px ui-monospace, Menlo, monospace'; g.textAlign = 'left'; g.textBaseline = 'middle';
          g.fillText(app.laneLabel(lane), x + baseSize + 6, y - 1);
        }
      }
      if (this.hover && this.hover.note && !this.drag) {
        const n = this.hover.note;
        if (st.notes.includes(n)) {
          const [x, y] = this.posToXY(n.pos, n.lane, G);
          g.fillStyle = 'rgba(211,236,230,0.9)'; g.font = '500 10px ui-monospace, Menlo, monospace'; g.textAlign = 'left'; g.textBaseline = 'middle';
          g.fillText(app.noteLabel(n), x + baseSize + 7, y - 1);
        }
      }

      // hub
      const hubHover = this.hover && this.hover.hub;
      const hg = g.createRadialGradient(cx, cy, 0, cx, cy, Rin);
      hg.addColorStop(0, app.engine.playing ? '#0f3a30' : '#0b1e1f'); hg.addColorStop(1, '#061012');
      g.fillStyle = hg; g.beginPath(); g.arc(cx, cy, Rin - 4, 0, TAU); g.fill();
      g.strokeStyle = hubHover ? 'rgba(60,240,180,0.8)' : 'rgba(60,240,180,0.35)'; g.lineWidth = 1.5; g.stroke();
      g.textAlign = 'center'; g.textBaseline = 'middle';
      if (phase != null) {
        const beat = phase * beatsPerLoop;
        const bar = Math.floor(beat / 4) + 1, bt = Math.floor(beat % 4) + 1, six = Math.floor((beat % 1) * 4) + 1;
        g.fillStyle = accent; g.font = `700 ${Math.max(11, Rin * 0.26)}px ui-monospace, Menlo, monospace`;
        g.fillText(`${bar}.${bt}.${six}`, cx, cy - Rin * 0.12);
        g.fillStyle = '#7c9a96'; g.font = `500 ${Math.max(9, Rin * 0.14)}px ui-monospace, Menlo, monospace`;
        g.fillText(`${st.bpm} BPM`, cx, cy + Rin * 0.22);
      } else {
        g.fillStyle = hubHover ? accent : 'rgba(60,240,180,0.75)';
        const s = Rin * 0.28;
        g.beginPath(); g.moveTo(cx - s * 0.6, cy - s); g.lineTo(cx - s * 0.6, cy + s); g.lineTo(cx + s, cy); g.closePath(); g.fill();
      }
    }

    shape(g, x, y, s, diamond) {
      g.beginPath();
      if (diamond) { g.moveTo(x, y - s * 1.15); g.lineTo(x + s * 1.15, y); g.lineTo(x, y + s * 1.15); g.lineTo(x - s * 1.15, y); g.closePath(); }
      else g.arc(x, y, s, 0, TAU);
    }
  }

  O.SonarView = SonarView;
})();
