// Text to SRT: turn plain text into timed subtitle cues (the engine of
// https://burncaps.app/text-to-srt; used by subconv.js for text with no times).
//
// Nothing here hears anything: the times are ESTIMATED from reading speed
// (characters per second) or by spreading the text over a total length, and
// the page says so. Cues break at sentence ends first, then at phrase marks
// (commas, colons, semicolons, dashes), then between words; never inside a
// word. A blank line in the text always starts a new cue. Lengths count
// characters as people read them (code points), so accented, Devanagari,
// Arabic and Chinese text measure right; text is never reordered, so right to
// left text stays as typed.

export const DEFAULTS = Object.freeze({
  maxChars: 42,   // characters per line: the common broadcast and streaming limit
  maxLines: 2,    // lines per caption
  cps: 17,        // reading speed, characters per second (adult viewers)
  minDur: 1.2,    // shortest a caption stays up, seconds
  maxDur: 7,      // longest, seconds
  gap: 0.08,      // a short gap between captions, seconds (about two frames)
  start: 0,       // the first caption's start, seconds
  total: 0,       // when above 0, spread the text over this many seconds instead
});

const len = (s) => [...s].length;
// Scripts written without spaces between words: there a character is the
// smallest piece a line may break at.
const NO_SPACE = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯฀-๿຀-໿က-႟ក-៿]/;
export const SENTENCE_END = /[.!?…。！？؟।॥]["'”’)\]»]*$/;
export const PHRASE_END = /[,;:،؛、，；：\-–—]["'”’)\]»]*$/;

// Words (space-separated pieces), with scripts that use no spaces split into
// characters, each piece knowing whether a space follows it.
function tokens(text) {
  const out = [];
  for (const piece of text.split(/\s+/).filter(Boolean)) {
    if (NO_SPACE.test(piece) && len(piece) > 1) {
      // Break between characters, keeping punctuation with the character before it.
      const chars = [...piece];
      let cur = '';
      for (const ch of chars) {
        if (cur && !/[、。，．！？：；」』）)\]”’,.!?:;]/.test(ch)) { out.push({ t: cur, space: false }); cur = ''; }
        cur += ch;
      }
      if (cur) out.push({ t: cur, space: true });
    } else out.push({ t: piece, space: true });
  }
  return out;
}

const joinTokens = (ts) => ts.map((x, i) => x.t + (i < ts.length - 1 && x.space ? ' ' : '')).join('');

// Lay tokens into at most maxLines lines of at most maxChars, balanced so the
// lines are of similar length. -> array of lines, or null when they do not
// fit (a single word longer than a line still gets a line of its own).
export function layout(ts, maxChars, maxLines) {
  if (!ts.length) return [];
  // cum[k]: the length of the first k tokens joined, each with its space.
  const cum = [0];
  for (const x of ts) cum.push(cum[cum.length - 1] + len(x.t) + (x.space ? 1 : 0));
  const span = (a, b) => cum[b] - cum[a] - (ts[b - 1].space ? 1 : 0);
  if (span(0, ts.length) <= maxChars) return [joinTokens(ts)];
  if (maxLines < 2) return null;
  // Two lines (the usual case): try every break and keep the most even split
  // that fits, preferring a break after a phrase mark. More lines: fill greedily.
  if (maxLines === 2) {
    let best = null;
    for (let i = 1; i < ts.length; i++) {
      const la = span(0, i), lb = span(i, ts.length);
      if (la > maxChars || lb > maxChars) continue;
      const score = Math.abs(la - lb) - (PHRASE_END.test(ts[i - 1].t) || SENTENCE_END.test(ts[i - 1].t) ? 8 : 0);
      if (!best || score < best.score) best = { score, i };
    }
    return best ? [joinTokens(ts.slice(0, best.i)), joinTokens(ts.slice(best.i))] : null;
  }
  const lines = [];
  let a = 0;
  for (let b = 1; b <= ts.length; b++) {
    if (b - a > 1 && span(a, b) > maxChars) { lines.push([a, b - 1]); a = b - 1; }
  }
  lines.push([a, ts.length]);
  if (lines.length > maxLines || lines.some(([x, y]) => span(x, y) > maxChars)) return null;
  return lines.map(([x, y]) => joinTokens(ts.slice(x, y)));
}

// Split text into caption pieces (each an array of lines).
export function chunk(text, { maxChars = DEFAULTS.maxChars, maxLines = DEFAULTS.maxLines } = {}) {
  maxChars = Math.max(10, Math.min(200, Math.round(maxChars) || DEFAULTS.maxChars));
  maxLines = Math.max(1, Math.min(4, Math.round(maxLines) || DEFAULTS.maxLines));
  const cues = [];
  const paragraphs = String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  for (const para of paragraphs) {
    // Sentences: end at sentence punctuation; a single line break inside a
    // paragraph is read as a space.
    const ts = tokens(para.replace(/\n/g, ' '));
    const sentences = [];
    let cur = [];
    for (const tk of ts) {
      cur.push(tk);
      if (SENTENCE_END.test(tk.t)) { sentences.push(cur); cur = []; }
    }
    if (cur.length) sentences.push(cur);
    // Short sentences that fit on one line together share a caption
    // ("Third? Price.") rather than flashing past one by one.
    let prevWhole = false;
    for (const s of sentences) {
      const ps = pieces(s, maxChars, maxLines);
      const last = cues[cues.length - 1];
      // Scripts without spaces join without one.
      const sep = last && NO_SPACE.test([...last[0]].slice(-2).join('')) ? '' : ' ';
      if (prevWhole && ps.length === 1 && ps[0].length === 1 && last.length === 1 && len(last[0] + sep + ps[0][0]) <= maxChars) {
        last[0] = last[0] + sep + ps[0][0];
      } else cues.push(...ps);
      prevWhole = ps.length === 1;
    }
  }
  return cues;
}

// One sentence into as few captions as fit, each break at the best place:
// the last phrase mark in the second half of what fits, else the last word.
function pieces(ts, maxChars, maxLines) {
  const out = [];
  let i = 0;
  while (i < ts.length) {
    // The longest run from i that still lays out.
    let j = i + 1;
    let lines = layout(ts.slice(i, j), maxChars, maxLines);
    if (!lines) {
      // One word too long for a line on its own: it gets its own caption, whole.
      out.push([ts[i].t]);
      i += 1;
      continue;
    }
    while (j < ts.length) {
      const next = layout(ts.slice(i, j + 1), maxChars, maxLines);
      if (!next) break;
      j += 1;
      lines = next;
    }
    if (j < ts.length) {
      // Did not reach the sentence's end: prefer to stop after a phrase mark,
      // when one sits in the second half of what fits.
      const room = j - i;
      for (let k = j - 1; k > i + Math.floor(room / 2) - 1 && k > i; k--) {
        if (PHRASE_END.test(ts[k - 1].t)) { j = k; lines = layout(ts.slice(i, j), maxChars, maxLines); break; }
      }
      // Never leave a single short word to stand alone at the sentence's end.
      const rest = ts.slice(j);
      if (rest.length === 1 && len(rest[0].t) <= 4 && j - i > 2) {
        const moved = layout(ts.slice(j - 1), maxChars, maxLines);
        const kept = layout(ts.slice(i, j - 1), maxChars, maxLines);
        if (moved && kept) { j -= 1; lines = kept; }
      }
    }
    out.push(lines);
    i = j;
  }
  return out;
}

// Times for each caption, in seconds. By reading speed: each caption stays
// up for its characters / cps, within minDur and maxDur. By total: the total
// (less the gaps) is shared out by characters.
export function timeCues(pieces, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const cps = Math.max(5, Math.min(40, Number(o.cps) || DEFAULTS.cps));
  const gap = Math.max(0, Number(o.gap) || 0);
  let t = Math.max(0, Number(o.start) || 0);
  const chars = pieces.map(lines => Math.max(1, len(lines.join(' '))));
  let durs;
  if (Number(o.total) > 0) {
    const total = Number(o.total);
    const spare = Math.max(0.1 * total, total - gap * Math.max(0, pieces.length - 1));
    const sum = chars.reduce((a, b) => a + b, 0);
    durs = chars.map(c => (spare * c) / sum);
  } else {
    durs = chars.map(c => Math.min(o.maxDur, Math.max(o.minDur, c / cps)));
  }
  return pieces.map((lines, i) => {
    const start = t, end = t + durs[i];
    t = end + (Number(o.total) > 0 && i === pieces.length - 1 ? 0 : gap);
    return { start, end, lines };
  });
}

// 3723.5 -> "01:02:03,500"
export function timecode(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, r = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

// The SRT file: numbered cues, a blank line after each, Windows line ends
// (what SubRip wrote and every editor reads).
export function toSrt(cues, eol = '\r\n') {
  return cues.map((c, i) => [String(i + 1), `${timecode(c.start)} --> ${timecode(c.end)}`, ...c.lines].join(eol)).join(eol + eol) + (cues.length ? eol : '');
}

// The whole job: text and options in, { cues, srt, duration } out.
export function textToSrt(text, opts = {}) {
  const cues = timeCues(chunk(text, opts), opts);
  return { cues, srt: toSrt(cues), duration: cues.length ? cues[cues.length - 1].end : 0 };
}
