// Subtitle converter: read SRT, WebVTT, SBV (SubViewer, as YouTube reads it), ASS/SSA and
// text (with times at the start of each line, or none), and write SRT, VTT,
// SBV or text. The engine of https://burncaps.app/subtitle-converter;
// tested by test.mjs. Pure functions: no page, no network.
//
// Everything is read into one model, a list of captions
//   { start, end, lines }      start and end in whole milliseconds,
//                              lines = the caption's lines of text,
// where the text is plain characters plus only the three tags every SRT
// player and every VTT player understands: <i>, <b> and <u> (balanced within
// a caption). What the target cannot hold is left out and said in `notes`:
// VTT positions, classes, voices and comments, ASS override codes and
// drawings, SRT font colours and {\an8} positions; SBV and text keep no tags.
//
// Real files are messy, so the reader takes: a byte order mark, Windows (CRLF)
// and old Mac (CR) line ends, no blank line between captions, no numbers, a
// comma or a full stop before the milliseconds and one to three digits of
// them, hours left out, coordinates after an SRT time, text after a blank line
// inside a caption, empty captions, a caption that ends before it starts, and
// captions out of order. decodeBytes() reads UTF-8, UTF-16 (with its mark) and
// old Windows-1252 files; every file written is UTF-8.

import { textToSrt, DEFAULTS as SRT_DEFAULTS } from './srt.js';

export const OUTPUTS = Object.freeze(['srt', 'vtt', 'sbv', 'txt']);
export const LABELS = Object.freeze({
  srt: 'SRT', vtt: 'VTT', sbv: 'SBV', txt: 'TXT', ass: 'ASS', plain: 'TXT',
});
// What each format is called in a sentence ("Detected: ...").
export const NAMES = Object.freeze({
  srt: 'SRT (SubRip)', vtt: 'VTT (WebVTT)', sbv: 'SBV (SubViewer)', ass: 'ASS or SSA',
  txt: 'text with times', plain: 'plain text with no times', microdvd: 'MicroDVD',
});
export const EXT = Object.freeze({ srt: 'srt', vtt: 'vtt', sbv: 'sbv', txt: 'txt' });
export const MIME = Object.freeze({
  srt: 'application/x-subrip;charset=utf-8', vtt: 'text/vtt;charset=utf-8',
  sbv: 'text/plain;charset=utf-8', txt: 'text/plain;charset=utf-8',
});

// ---- times ----
const TIME = '(?:\\d+:)?\\d{1,2}:\\d{1,2}(?:[.,]\\d{1,3})?';
// SRT and VTT: "00:00:01,000 --> 00:00:03,500", anything after the end time
// (VTT cue settings, SRT coordinates) is kept apart.
const ARROW = new RegExp(`^\\s*(${TIME})\\s*-{1,2}>\\s*(${TIME})(?:[ \\t]+(.*?))?\\s*$`);
// SBV: "0:00:01.000,0:00:03.500".
const SBV_TIME = /^\s*(\d+:\d{1,2}:\d{1,2}[.,]\d{1,3})\s*,\s*(\d+:\d{1,2}:\d{1,2}[.,]\d{1,3})\s*$/;
// Text with times: a line that starts with "[00:01:05]", "(1:05)", "00:01:05 -" or "1:05".
const TXT_TIME = /^\s*[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)[\])]?(?:\s*[-–—:|]\s*|\s+|$)(.*)$/;
const MICRODVD = /^\s*\{\d+\}\s*\{\d*\}/;

// "01:02:03,5" -> 3723500. The fraction is a decimal fraction of a second
// ("5" and "500" are both half a second), hours may be left out.
export function toMs(stamp) {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(String(stamp).trim());
  if (!m) return NaN;
  const frac = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
  return ((Number(m[1] || 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + frac;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
function parts(ms) {
  ms = Math.max(0, Math.round(ms));
  return { h: Math.floor(ms / 3600000), m: Math.floor(ms / 60000) % 60, s: Math.floor(ms / 1000) % 60, r: ms % 1000 };
}
export const srtTime = (ms) => { const p = parts(ms); return `${pad(p.h)}:${pad(p.m)}:${pad(p.s)},${pad(p.r, 3)}`; };
export const vttTime = (ms) => { const p = parts(ms); return `${pad(p.h)}:${pad(p.m)}:${pad(p.s)}.${pad(p.r, 3)}`; };
export const sbvTime = (ms) => { const p = parts(ms); return `${p.h}:${pad(p.m)}:${pad(p.s)}.${pad(p.r, 3)}`; };
export const txtTime = (ms) => { const p = parts(ms); return `[${pad(p.h)}:${pad(p.m)}:${pad(p.s)}]`; };

// ---- the bytes of a file ----
// UTF-8 when it is valid UTF-8 (with or without its mark), UTF-16 when it
// starts with the UTF-16 mark, else Windows-1252 (old Western European SRT
// files). -> { text, encoding }
export function decodeBytes(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xFF && b[1] === 0xFE) return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'UTF-16' };
  if (b[0] === 0xFE && b[1] === 0xFF) return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), encoding: 'UTF-16' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), encoding: 'UTF-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(b), encoding: 'Windows-1252' };
  }
}

// A byte order mark, Windows and old Mac line ends, and NUL characters out.
export function normalise(text) {
  return String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
}

// ---- which format a text is ----
// -> 'srt' | 'vtt' | 'sbv' | 'ass' | 'txt' (text with times) | 'plain' |
//    'microdvd' (frame numbers: not read) | '' (nothing in it).
// The content decides; a file's extension only settles SRT against VTT when a
// file has arrow times and no WEBVTT line.
export function detect(text, name = '') {
  const t = normalise(text);
  if (!t.trim()) return '';
  const ext = ((/\.([a-z0-9]+)$/i.exec(name) || [])[1] || '').toLowerCase();
  if (/^\s*WEBVTT(?:[ \t]|$)/.test(t)) return 'vtt';
  const lines = t.split('\n');
  if (lines.some(l => /^\s*\[(?:Script Info|V4\+? Styles|Events)\]\s*$/i.test(l)) || lines.some(l => /^Dialogue:\s*[^,]*,\s*\d+:\d{1,2}:\d{1,2}/i.test(l))) return 'ass';
  let arrow = 0, comma = 0, sbv = 0, stamped = 0;
  for (const l of lines) {
    const m = ARROW.exec(l);
    if (m) { arrow++; if (m[1].includes(',')) comma++; continue; }
    if (SBV_TIME.test(l)) { sbv++; continue; }
    if (TXT_TIME.test(l)) stamped++;
  }
  if (arrow) {
    if (ext === 'srt' || ext === 'vtt') return ext;
    return comma * 2 >= arrow ? 'srt' : 'vtt';
  }
  if (sbv) return 'sbv';
  const first = lines.find(l => l.trim());
  if (MICRODVD.test(first)) return 'microdvd';
  if (stamped >= 2 && TXT_TIME.test(first)) return 'txt';
  return 'plain';
}

// ---- the text inside a caption ----
const KEEP = new Set(['i', 'b', 'u']);
// <i>, <B>, <i.class> -> <i>, <b>; every other tag (<font ...>, <c.yellow>,
// <v Name>, <lang en>, <ruby>) goes, its text stays. A "<" not followed by a
// letter or "/" (as in "a < b" or "<3") is text.
function basicTags(s, notes) {
  return s.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)(?:[.\s][^>]*)?>/g, (all, close, name) => {
    const n = name.toLowerCase();
    if (KEEP.has(n)) return `<${close}${n}>`;
    notes.styles = true;
    return '';
  });
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0', lrm: '\u200E', rlm: '\u200F' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    }
    const v = ENTITIES[e.toLowerCase()];
    return v === undefined ? all : v;
  });
}

function cleanSrtLine(s, notes) {
  // ASS-style codes some SRT files carry ({\an8} for the top of the frame, {\i1}).
  s = s.replace(/\{\\[^}]*\}/g, () => { notes.styles = true; return ''; });
  return basicTags(s, notes);
}

function cleanVttLine(s, notes) {
  // Ruby text (the small reading over a character) and karaoke times go;
  // the words stay.
  s = s.replace(/<rt(?:[.\s][^>]*)?>.*?(?:<\/rt>|(?=<\/ruby>)|$)/g, () => { notes.styles = true; return ''; });
  s = s.replace(/<(?:\d+:)?\d{1,2}:\d{2}\.\d{3}>/g, () => { notes.styles = true; return ''; });
  return decodeEntities(basicTags(s, notes));
}

// ASS/SSA Dialogue text: override blocks {...} go, except italic, bold and
// underline switches, which become tags; \N is a new line, \n a space unless
// the script asks otherwise (it rarely does), \h a no-break space; drawings
// ({\p1} ... {\p0}) are shapes, not words, and go whole.
function cleanAss(text, notes) {
  let out = '';
  let drawing = false;
  const on = { i: false, b: false, u: false };
  for (const m of text.matchAll(/\{([^}]*)\}|([^{]+)|\{/g)) {
    if (m[1] !== undefined) {
      notes.styles = notes.styles || /\\(?![ibu]\d*(?:\\|$))[a-z]/i.test(m[1]);
      for (const tag of m[1].split('\\').slice(1)) {
        const p = /^p(\d+)$/.exec(tag);
        if (p) { drawing = Number(p[1]) > 0; continue; }
        if (tag === 'r' || /^r[^a-z]/i.test(tag)) {
          for (const k of ['u', 'b', 'i']) if (on[k]) { out += `</${k}>`; on[k] = false; }
          continue;
        }
        const t = /^([ibu])(\d*)$/.exec(tag);
        if (!t) continue;
        const n = t[2] === '' ? 0 : Number(t[2]);
        const want = t[1] === 'b' ? (n === 1 || n >= 600) : n === 1;
        if (want !== on[t[1]]) { out += want ? `<${t[1]}>` : `</${t[1]}>`; on[t[1]] = want; }
      }
      continue;
    }
    if (drawing) { notes.styles = true; continue; }
    out += (m[2] !== undefined ? m[2] : '{').replace(/\\N/g, '\n').replace(/\\n/g, ' ').replace(/\\h/g, '\u00A0');
  }
  return out.split('\n');
}

export const stripTags = (s) => s.replace(/<\/?[ibu]>/g, '');

// A caption's lines tidied: lines with no words go (an opening tag on one
// moves to the next line, a closing tag to the line before), then the tags are
// balanced across the caption (a close with no open goes, an open left
// unclosed is closed at the end) and empty pairs go.
function balance(lines) {
  const words = [];
  let carry = '';
  for (const raw of lines) {
    const l = raw.trim();
    if (stripTags(l).trim()) { words.push(carry + l); carry = ''; continue; }
    for (const tag of l.match(/<\/?[ibu]>/g) || []) {
      if (tag[1] !== '/') { carry += tag; continue; }
      const open = `<${tag[2]}>`;
      const at = carry.lastIndexOf(open);
      if (at >= 0) carry = carry.slice(0, at) + carry.slice(at + open.length);
      else if (words.length) words[words.length - 1] += tag;
    }
  }
  const stack = [];
  const out = words.map(line => line.replace(/<(\/?)([ibu])>/g, (all, close, n) => {
    if (!close) { stack.push(n); return all; }
    const at = stack.lastIndexOf(n);
    if (at < 0) return '';
    let closing = '';
    for (const k of stack.splice(at).reverse()) closing += `</${k}>`;
    return closing;
  }));
  if (stack.length && out.length) out[out.length - 1] += stack.reverse().map(k => `</${k}>`).join('');
  let s = out.join('\n');
  for (let prev = ''; prev !== s;) { prev = s; s = s.replace(/<([ibu])>([ \t\u00A0]*)<\/\1>/g, '$2'); }
  return s.split('\n').map(l => l.trim()).filter(l => stripTags(l).trim());
}

// The first caption after index i that starts later than caption i, or null.
function nextLater(list, i) {
  for (let k = i + 1; k < list.length; k++) if (list[k].start > list[i].start) return list[k];
  return null;
}

// ---- reading ----
function readArrows(t, vtt, notes) {
  const lines = t.split('\n');
  const cues = [];
  let cur = null;
  let pending = [];
  const flush = () => {
    if (!pending.length) return;
    const first = pending[0].trim();
    if (/^(?:NOTE|STYLE|REGION)(?:[ \t]|$)/.test(first)) notes.blocks++;
    else if (/^WEBVTT/.test(first)) { /* the header and its lines */ }
    else if (pending.length === 1 && /^\d+$/.test(first)) { /* a number left alone */ }
    else if (cues.length) { cues[cues.length - 1].lines.push(...pending); notes.joined++; }
    pending = [];
  };
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    const m = ARROW.exec(line);
    if (m) {
      if (cur) cues.push(cur);
      // The line right above a time is the caption's number or name: it goes.
      // Anything above that since the last blank line is text that belonged
      // to the caption before (a blank line inside it).
      if (pending.length) {
        pending.pop();
        if (pending.length && !/^(?:WEBVTT|NOTE|STYLE|REGION)/.test(pending[0].trim()) && cues.length) { cues[cues.length - 1].lines.push(...pending); notes.joined++; }
        pending = [];
      }
      if (m[3] && vtt) notes.styles = true;
      cur = { start: toMs(m[1]), end: toMs(m[2]), lines: [] };
      continue;
    }
    if (!line.trim()) {
      if (cur) { cues.push(cur); cur = null; } else flush();
      continue;
    }
    if (cur) {
      // A number straight above the next time, with no blank line between:
      // the next caption's number, not this caption's text.
      if (/^\s*\d+\s*$/.test(line) && k + 1 < lines.length && ARROW.test(lines[k + 1])) { cues.push(cur); cur = null; pending = [line]; continue; }
      cur.lines.push(line);
    } else pending.push(line);
  }
  if (cur) cues.push(cur);
  flush();
  return cues.map(c => ({ ...c, lines: c.lines.map(l => vtt ? cleanVttLine(l, notes) : cleanSrtLine(l, notes)) }));
}

function readSbv(t, notes) {
  const cues = [];
  let cur = null;
  for (const line of t.split('\n')) {
    const m = SBV_TIME.exec(line);
    if (m) { if (cur) cues.push(cur); cur = { start: toMs(m[1]), end: toMs(m[2]), lines: [] }; continue; }
    if (!line.trim()) { if (cur) { cues.push(cur); cur = null; } continue; }
    // SubViewer's own line break, [br].
    const parts = line.split(/\[br\]/i);
    if (cur) cur.lines.push(...parts);
    else if (cues.length) { cues[cues.length - 1].lines.push(...parts); notes.joined++; }
  }
  if (cur) cues.push(cur);
  return cues.map(c => ({ ...c, lines: c.lines.map(l => cleanSrtLine(l, notes)) }));
}

const DEFAULT_ASS_FORMAT = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
function readAss(t, notes) {
  const cues = [];
  let section = '';
  let format = null;
  let order = 0;
  for (const raw of t.split('\n')) {
    const line = raw.trim();
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) { section = sec[1].trim().toLowerCase(); continue; }
    if (section && section !== 'events') continue;
    const f = /^Format:\s*(.*)$/i.exec(line);
    if (f) { format = f[1].split(',').map(x => x.trim().toLowerCase()); continue; }
    const d = /^Dialogue:\s*(.*)$/i.exec(line);
    if (!d) continue;
    const fmt = format && format.includes('text') ? format : DEFAULT_ASS_FORMAT;
    const fields = d[1].split(',');
    const head = fields.slice(0, fmt.length - 1);
    const text = fields.slice(fmt.length - 1).join(',');
    const at = (name) => (fmt.indexOf(name) >= 0 && fmt.indexOf(name) < head.length ? head[fmt.indexOf(name)] : '');
    const start = toMs(at('start')), end = toMs(at('end'));
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    cues.push({ start, end, lines: cleanAss(fmt.indexOf('text') === fmt.length - 1 ? text : at('text'), notes), order: order++ });
  }
  return cues;
}

function readTimedText(t) {
  const cues = [];
  for (const line of t.split('\n')) {
    const m = TXT_TIME.exec(line);
    if (m) { cues.push({ start: toMs(m[1]), end: NaN, lines: m[2].trim() ? [m[2]] : [] }); continue; }
    if (line.trim() && cues.length) cues[cues.length - 1].lines.push(line);
  }
  // Each caption lasts until the next one starts; the last for its reading time.
  return cues.map((c, i) => {
    const next = nextLater(cues, i);
    const read = readingMs(c.lines.join(' '));
    return { ...c, end: next ? next.start : c.start + read };
  });
}

function readingMs(text) {
  const n = [...String(text)].length;
  return Math.round(1000 * Math.min(SRT_DEFAULTS.maxDur, Math.max(SRT_DEFAULTS.minDur, n / SRT_DEFAULTS.cps)));
}

function emptyNotes() {
  return { empty: 0, fixed: 0, sorted: false, joined: 0, blocks: 0, styles: false, estimated: false };
}

// Read any text. -> { format, cues, notes }; format as detect() gives it.
// `from` forces a format (one of detect()'s answers).
export function parse(text, { from = '', name = '' } = {}) {
  const t = normalise(text);
  const format = from || detect(t, name);
  const notes = emptyNotes();
  let cues = [];
  if (format === 'srt') cues = readArrows(t, false, notes);
  else if (format === 'vtt') cues = readArrows(t, true, notes);
  else if (format === 'sbv') cues = readSbv(t, notes);
  else if (format === 'ass') cues = readAss(t, notes);
  else if (format === 'txt') cues = readTimedText(t);
  else if (format === 'plain') {
    // No times at all: each caption timed by reading speed (srt.js), with
    // its defaults.
    cues = textToSrt(t).cues.map(c => ({ start: Math.round(c.start * 1000), end: Math.round(c.end * 1000), lines: c.lines }));
    notes.estimated = cues.length > 0;
  }
  // Clean every caption: balanced tags, no empty lines, then no empty captions.
  const kept = [];
  for (const c of cues) {
    const lines = balance(c.lines);
    if (!lines.length) { notes.empty++; continue; }
    kept.push({ start: c.start, end: c.end, lines, order: kept.length });
  }
  // A caption that ends before it starts (or as it starts) is given its
  // reading time, never running into the next one.
  for (let i = 0; i < kept.length; i++) {
    const c = kept[i];
    if (Number.isNaN(c.end) || c.end <= c.start) {
      const next = nextLater(kept, i);
      const want = c.start + readingMs(stripTags(c.lines.join(' ')));
      c.end = next ? Math.min(want, next.start) : want;
      if (c.end <= c.start) c.end = c.start + 1000;
      notes.fixed++;
    }
  }
  // Time order (a stable sort: captions that start together keep their order).
  if (kept.some((c, i) => i && c.start < kept[i - 1].start)) {
    kept.sort((a, b) => a.start - b.start || a.order - b.order);
    notes.sorted = true;
  }
  return { format, cues: kept.map(({ start, end, lines }) => ({ start, end, lines })), notes };
}

// ---- writing ----
// VTT text: "&" and "<" (outside the three tags) escaped, ">" too, so no
// caption holds "-->" (the spec forbids it in a caption).
function vttText(line) {
  return line.split(/(<\/?[ibu]>)/).map((piece, i) => i % 2 ? piece : piece.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('');
}

// cues -> the file's text. opts.times (TXT only): the start time before each line.
export function write(cues, to, { times = false } = {}) {
  if (!cues.length) return '';
  if (to === 'srt') {
    // Windows line ends, as SubRip wrote them and as srt.js does.
    return cues.map((c, i) => [String(i + 1), `${srtTime(c.start)} --> ${srtTime(c.end)}`, ...c.lines].join('\r\n')).join('\r\n\r\n') + '\r\n';
  }
  if (to === 'vtt') {
    return 'WEBVTT\n\n' + cues.map(c => [`${vttTime(c.start)} --> ${vttTime(c.end)}`, ...c.lines.map(vttText)].join('\n')).join('\n\n') + '\n';
  }
  if (to === 'sbv') {
    return cues.map(c => [`${sbvTime(c.start)},${sbvTime(c.end)}`, ...c.lines.map(stripTags)].join('\n')).join('\n\n') + '\n';
  }
  if (to === 'txt') {
    return cues.map(c => {
      const words = c.lines.map(stripTags).join(' ').replace(/\s+/g, ' ').trim();
      return times ? `${txtTime(c.start)} ${words}` : words;
    }).join('\n') + '\n';
  }
  throw new Error(`unknown format: ${to}`);
}

// The whole job: text in, the new file out.
// -> { from, to, cues, output, notes } (notes.styles is set when the target
// is SBV or text and the captions had italics, bold or underline).
export function convert(text, to, { from = '', name = '', times = false } = {}) {
  const r = parse(text, { from, name });
  const notes = { ...r.notes };
  if ((to === 'sbv' || to === 'txt') && r.cues.some(c => c.lines.some(l => /<\/?[ibu]>/.test(l)))) notes.styles = true;
  return { from: r.format, to, cues: r.cues, output: write(r.cues, to, { times }), notes };
}
