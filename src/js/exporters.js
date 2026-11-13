// Orbit - MIDI / WAV / MP3 exporters
(function () {
  const O = (window.Orbit = window.Orbit || {});
  const S = O.Sound;

  // ---------- MIDI (Standard MIDI File, format 1) ----------
  function vlq(n) {
    n = Math.max(0, Math.round(n));
    const bytes = [n & 0x7f];
    while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
    return bytes;
  }
  function str(s) { return Array.from(new TextEncoder().encode(s)); }
  function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function u16(n) { return [(n >>> 8) & 255, n & 255]; }
  function chunk(type, data) { return [...str(type), ...u32(data.length), ...data]; }

  function trackFromEvents(name, evs) {
    // evs: [{tick, bytes}] (absolute ticks)
    evs.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const data = [0x00, 0xff, 0x03, ...vlq(str(name).length), ...str(name)];
    let last = 0;
    for (const e of evs) { data.push(...vlq(e.tick - last), ...e.bytes); last = e.tick; }
    data.push(0x00, 0xff, 0x2f, 0x00);
    return chunk('MTrk', data);
  }

  /**
   * pattern: compiled pattern (events with lane, midi, sound, gate, vel, t)
   * lanes: [{name}] ; loops: repeat count
   */
  function buildMidi(pattern, laneNames, loops) {
    const PPQ = 480;
    const loopBeats = pattern.bars * pattern.beatsPerBar;
    const tempo = Math.round(60000000 / pattern.bpm);
    const head = chunk('MThd', [...u16(1), ...u16(0), ...u16(PPQ)]);
    // tempo / meta track
    const meta = trackFromEvents('Orbit', [
      { tick: 0, order: 0, bytes: [0xff, 0x51, 0x03, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255] },
      { tick: 0, order: 1, bytes: [0xff, 0x58, 0x04, pattern.beatsPerBar, 2, 24, 8] },
      { tick: Math.round(loopBeats * loops * PPQ), order: 2, bytes: [0xff, 0x01, 0x03, ...str('End')] }
    ]);
    // group events by lane
    const byLane = new Map();
    for (const ev of pattern.events) {
      if (!byLane.has(ev.lane)) byLane.set(ev.lane, []);
      byLane.get(ev.lane).push(ev);
    }
    const tracks = [];
    const lanesSorted = [...byLane.keys()].sort((a, b) => a - b);
    for (const lane of lanesSorted) {
      const list = byLane.get(lane);
      const drumEvs = list.filter(e => e.sound.kind === 'drum');
      const synthEvs = list.filter(e => e.sound.kind !== 'drum');
      const mk = (evList, isDrum, chan, suffix) => {
        const out = [];
        if (!isDrum) out.push({ tick: 0, order: 0, bytes: [0xc0 | chan, 81] }); // program: lead saw-ish
        for (let k = 0; k < loops; k++) {
          for (const ev of evList) {
            const startBeat = (k + ev.t) * loopBeats;
            let note, durBeats;
            if (isDrum) {
              const d = S.DRUMS.find(x => x.id === ev.sound.drum);
              note = d ? d.gm : 36; durBeats = 0.25;
            } else {
              note = Math.round(ev.midi + ev.sound.transpose + ev.sound.fine / 100);
              durBeats = ev.gate;
            }
            note = Math.min(127, Math.max(0, note));
            const vel = Math.min(127, Math.max(1, Math.round(ev.vel * Math.min(1, ev.sound.volume / 0.8) * 112)));
            const on = Math.round(startBeat * PPQ), off = Math.round((startBeat + durBeats) * PPQ);
            out.push({ tick: on, order: 2, bytes: [0x90 | chan, note, vel] });
            out.push({ tick: Math.max(on + 1, off), order: 1, bytes: [0x80 | chan, note, 0] });
          }
        }
        tracks.push(trackFromEvents((laneNames[lane] || 'Lane ' + (lane + 1)) + suffix, out));
      };
      if (synthEvs.length) {
        const chan = lane < 9 ? lane : Math.min(15, lane + 1); // skip GM drum channel 10
        mk(synthEvs, false, chan, '');
      }
      if (drumEvs.length) mk(drumEvs, true, 9, synthEvs.length ? ' (drums)' : '');
    }
    const bytes = [...head, ...meta, ...tracks.flat()];
    // patch track count into header
    const ntrk = 1 + tracks.length;
    bytes[10] = (ntrk >> 8) & 255; bytes[11] = ntrk & 255;
    return new Uint8Array(bytes);
  }

  // ---------- WAV ----------
  function encodeWav(buffer) {
    const nCh = buffer.numberOfChannels, sr = buffer.sampleRate, len = buffer.length;
    const out = new DataView(new ArrayBuffer(44 + len * nCh * 2));
    const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); out.setUint32(4, 36 + len * nCh * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, nCh, true);
    out.setUint32(24, sr, true); out.setUint32(28, sr * nCh * 2, true); out.setUint16(32, nCh * 2, true); out.setUint16(34, 16, true);
    w(36, 'data'); out.setUint32(40, len * nCh * 2, true);
    const chans = []; for (let c = 0; c < nCh; c++) chans.push(buffer.getChannelData(c));
    let o = 44;
    for (let i = 0; i < len; i++) for (let c = 0; c < nCh; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2;
    }
    return new Uint8Array(out.buffer);
  }

  // ---------- MP3 (lamejs) ----------
  async function encodeMp3(buffer, kbps, onProgress) {
    if (!window.lamejs) throw new Error('MP3 encoder not loaded');
    const sr = buffer.sampleRate;
    const L = buffer.getChannelData(0), R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
    const enc = new lamejs.Mp3Encoder(2, sr, kbps || 192);
    const block = 1152, len = L.length;
    const l16 = new Int16Array(block), r16 = new Int16Array(block);
    const parts = [];
    let lastYield = performance.now();
    for (let i = 0; i < len; i += block) {
      const n = Math.min(block, len - i);
      for (let j = 0; j < n; j++) {
        const a = Math.max(-1, Math.min(1, L[i + j])), b = Math.max(-1, Math.min(1, R[i + j]));
        l16[j] = a < 0 ? a * 0x8000 : a * 0x7fff; r16[j] = b < 0 ? b * 0x8000 : b * 0x7fff;
      }
      const mp3 = enc.encodeBuffer(n === block ? l16 : l16.subarray(0, n), n === block ? r16 : r16.subarray(0, n));
      if (mp3.length) parts.push(new Uint8Array(mp3));
      if (performance.now() - lastYield > 30) {
        if (onProgress) onProgress(i / len);
        await new Promise(r => setTimeout(r, 0));
        lastYield = performance.now();
      }
    }
    const end = enc.flush(); if (end.length) parts.push(new Uint8Array(end));
    const total = parts.reduce((a, p) => a + p.length, 0);
    const outArr = new Uint8Array(total); let o = 0;
    for (const p of parts) { outArr.set(p, o); o += p.length; }
    if (onProgress) onProgress(1);
    return outArr;
  }

  // Trim trailing near-silence from rendered tails (keeps at least `minSec`)
  function trimTail(buffer, minSec, ctxFactory) {
    const thr = 0.0006, sr = buffer.sampleRate;
    let last = Math.floor(minSec * sr);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = d.length - 1; i > last; i--) if (Math.abs(d[i]) > thr) { last = i; break; }
    }
    const len = Math.min(buffer.length, last + Math.floor(sr * 0.05));
    if (len >= buffer.length) return buffer;
    const nb = new AudioBuffer({ length: len, numberOfChannels: buffer.numberOfChannels, sampleRate: sr });
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const src = buffer.getChannelData(c).subarray(0, len).slice();
      // short fade-out at the very end
      const f = Math.min(len, Math.floor(sr * 0.04));
      for (let i = 0; i < f; i++) src[len - f + i] *= 1 - i / f;
      nb.copyToChannel(src, c);
    }
    return nb;
  }

  O.Export = { buildMidi, encodeWav, encodeMp3, trimTail };
})();
