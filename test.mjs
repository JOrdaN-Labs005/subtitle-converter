// Tests for subconv.js, the subtitle converter.
// Run: node test.mjs   (exit code 1 on any failure)
// Every pair of formats is converted from real samples and compared with the
// file written by hand; then the mess real files carry (a byte order mark,
// Windows and old Mac line ends, missing blank lines and numbers, a full stop
// before SRT milliseconds, VTT headers, comments, styles, cue settings, voices
// and karaoke times, ASS override codes and drawings, empty captions, a caption
// that ends before it starts, captions out of order, other encodings).

import { convert, parse, write, detect, decodeBytes, toMs, srtTime, vttTime, sbvTime, OUTPUTS } from './subconv.js';

let passed = 0, failed = 0;
function check(name, ok, got) {
  if (ok) passed++;
  else { failed++; console.log('FAIL', name, got === undefined ? '' : JSON.stringify(got)); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- one set of captions, written by hand in every format ----
const CUES = [
  { start: 600, end: 4160, lines: ["Hi, I'm Siobhan, and this is Callum."] },
  { start: 4160, end: 6770, lines: ['We run a bakery in Leeds.'] },
  { start: 6770, end: 10880, lines: ["Today we'll show you how we make", 'our <i>famous</i> Bakewell tart.'] },
  { start: 10880, end: 16700, lines: ['[music]'] },
  { start: 3723000, end: 3725500, lines: ['Thanks for watching & see you <3'] },
];
const plainCues = CUES.map(c => ({ ...c, lines: c.lines.map(l => l.replace(/<\/?i>/g, '')) }));

const SRT = [
  '1', '00:00:00,600 --> 00:00:04,160', "Hi, I'm Siobhan, and this is Callum.", '',
  '2', '00:00:04,160 --> 00:00:06,770', 'We run a bakery in Leeds.', '',
  '3', '00:00:06,770 --> 00:00:10,880', "Today we'll show you how we make", 'our <i>famous</i> Bakewell tart.', '',
  '4', '00:00:10,880 --> 00:00:16,700', '[music]', '',
  '5', '01:02:03,000 --> 01:02:05,500', 'Thanks for watching & see you <3', '',
].join('\r\n');
const VTT = [
  'WEBVTT', '',
  '00:00:00.600 --> 00:00:04.160', "Hi, I'm Siobhan, and this is Callum.", '',
  '00:00:04.160 --> 00:00:06.770', 'We run a bakery in Leeds.', '',
  '00:00:06.770 --> 00:00:10.880', "Today we'll show you how we make", 'our <i>famous</i> Bakewell tart.', '',
  '00:00:10.880 --> 00:00:16.700', '[music]', '',
  '01:02:03.000 --> 01:02:05.500', 'Thanks for watching &amp; see you &lt;3', '',
].join('\n');
const SBV = [
  '0:00:00.600,0:00:04.160', "Hi, I'm Siobhan, and this is Callum.", '',
  '0:00:04.160,0:00:06.770', 'We run a bakery in Leeds.', '',
  '0:00:06.770,0:00:10.880', "Today we'll show you how we make", 'our famous Bakewell tart.', '',
  '0:00:10.880,0:00:16.700', '[music]', '',
  '1:02:03.000,1:02:05.500', 'Thanks for watching & see you <3', '',
].join('\n');
const TXT = [
  "Hi, I'm Siobhan, and this is Callum.",
  'We run a bakery in Leeds.',
  "Today we'll show you how we make our famous Bakewell tart.",
  '[music]',
  'Thanks for watching & see you <3', '',
].join('\n');
const TXT_TIMED = [
  "[00:00:00] Hi, I'm Siobhan, and this is Callum.",
  '[00:00:04] We run a bakery in Leeds.',
  "[00:00:06] Today we'll show you how we make our famous Bakewell tart.",
  '[00:00:10] [music]',
  '[01:02:03] Thanks for watching & see you <3', '',
].join('\n');
const ASS = [
  '[Script Info]', 'Title: Bakery', 'ScriptType: v4.00+', 'PlayResX: 1920', 'PlayResY: 1080', '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  "Dialogue: 0,0:00:00.60,0:00:04.16,Default,Siobhan,0,0,0,,Hi, I'm Siobhan, and this is Callum.",
  'Dialogue: 0,0:00:04.16,0:00:06.77,Default,,0,0,0,,{\\fad(200,200)}We run a bakery in Leeds.',
  "Dialogue: 0,0:00:06.77,0:00:10.88,Default,,0,0,0,,Today we'll show you how we make\\Nour {\\i1}famous{\\i0} Bakewell tart.",
  'Comment: 0,0:00:08.00,0:00:09.00,Default,,0,0,0,,a note for the typesetter',
  'Dialogue: 0,0:00:10.88,0:00:16.70,Default,,0,0,0,,{\\an8\\c&H00FFFF&}[music]',
  'Dialogue: 0,1:02:03.00,1:02:05.50,Default,,0,0,0,,Thanks for watching & see you <3',
  '',
].join('\n');

const FILES = { srt: SRT, vtt: VTT, sbv: SBV, txt: TXT };
check('the hand-written SRT is what the writer writes', write(CUES, 'srt') === SRT, write(CUES, 'srt'));
check('the hand-written VTT is what the writer writes', write(CUES, 'vtt') === VTT, write(CUES, 'vtt'));
check('the hand-written SBV is what the writer writes', write(CUES, 'sbv') === SBV, write(CUES, 'sbv'));
check('the hand-written text is what the writer writes', write(CUES, 'txt') === TXT, write(CUES, 'txt'));
check('the hand-written text with times is what the writer writes', write(CUES, 'txt', { times: true }) === TXT_TIMED, write(CUES, 'txt', { times: true }));

// ---- every pair ----
const SOURCES = { srt: [SRT, CUES], vtt: [VTT, CUES], sbv: [SBV, plainCues], ass: [ASS, CUES] };
for (const [from, [src, cues]] of Object.entries(SOURCES)) {
  check(`${from}: detected as ${from}`, detect(src) === from, detect(src));
  const r = parse(src);
  check(`${from}: read into the same five captions`, same(r.cues, cues), r.cues);
  for (const to of OUTPUTS) {
    const want = from === 'sbv' && (to === 'srt' || to === 'vtt') ? FILES[to].replace(/<\/?i>/g, '') : FILES[to];
    const got = convert(src, to).output;
    check(`${from} to ${to}: the file matches the one written by hand`, got === want, got);
  }
  check(`${from} to text with times`, convert(src, 'txt', { times: true }).output === TXT_TIMED);
}
// Text with times in: each caption lasts until the next one starts.
{
  const r = parse(TXT_TIMED);
  check('text with times: detected', r.format === 'txt', r.format);
  check('text with times: starts read to the second', same(r.cues.map(c => c.start), [0, 4000, 6000, 10000, 3723000]), r.cues.map(c => c.start));
  check('text with times: each caption ends where the next starts', same(r.cues.slice(0, 4).map(c => c.end), [4000, 6000, 10000, 3723000]), r.cues.map(c => c.end));
  check('text with times: the last caption lasts its reading time', r.cues[4].end - r.cues[4].start === Math.round(1000 * Math.min(7, Math.max(1.2, 32 / 17))), r.cues[4]);
  for (const to of OUTPUTS) check(`text with times to ${to}: every word kept`, convert(TXT_TIMED, to).output.includes('Bakewell tart.') && convert(TXT_TIMED, to).output.includes('Siobhan'));
  check('text with times to SRT: the SRT times', convert(TXT_TIMED, 'srt').output.startsWith('1\r\n00:00:00,000 --> 00:00:04,000\r\nHi, I'));
}
// Round trips: A to B and back to A keeps the captions (SBV and text keep no italics).
for (const a of ['srt', 'vtt', 'sbv']) {
  for (const b of ['srt', 'vtt', 'sbv']) {
    const back = convert(convert(FILES[a], b).output, a).output;
    const want = a !== 'sbv' && b === 'sbv' ? FILES[a].replace(/<\/?i>/g, '') : FILES[a];
    check(`round trip ${a} to ${b} to ${a}`, back === want, back);
  }
}
check('SBV and text out: the note says styling was left out', convert(SRT, 'sbv').notes.styles && convert(SRT, 'txt').notes.styles && !convert(SRT, 'vtt').notes.styles);

// ---- times ----
check('times: comma or full stop, hours left out, short fractions', toMs('01:02:03,004') === 3723004 && toMs('01:02:03.004') === 3723004 && toMs('02:03.5') === 123500 && toMs('0:00:01.25') === 1250 && toMs('00:00:01') === 1000);
check('times: written in each format', srtTime(3723004) === '01:02:03,004' && vttTime(3723004) === '01:02:03.004' && sbvTime(3723004) === '1:02:03.004' && srtTime(0) === '00:00:00,000' && srtTime(36000000) === '10:00:00,000');

// ---- the mess real files carry ----
{
  const r = convert('\uFEFF' + SRT, 'vtt');
  check('a byte order mark is read and not written', r.output === VTT && !r.output.includes('\uFEFF'), r.output.slice(0, 20));
  check('old Mac line ends (CR only)', convert(SRT.replace(/\r\n/g, '\r'), 'vtt').output === VTT);
  check('Unix line ends in an SRT', convert(SRT.replace(/\r\n/g, '\n'), 'vtt').output === VTT);
}
{
  const squashed = '1\n00:00:01,000 --> 00:00:02,000\nOne\n2\n00:00:02,500 --> 00:00:04,000\nTwo, on\ntwo lines\n3\n00:00:04,500 --> 00:00:05,000\nThree\n';
  const r = parse(squashed);
  check('no blank lines between captions: the numbers are not read as words', same(r.cues.map(c => c.lines), [['One'], ['Two, on', 'two lines'], ['Three']]), r.cues);
}
{
  const noNumbers = '00:00:01,000 --> 00:00:02,000\nOne\n\n00:00:02,500 --> 00:00:04,000\nTwo\n';
  check('no numbers: read, and numbered when written', convert(noNumbers, 'srt').output === '1\r\n00:00:01,000 --> 00:00:02,000\r\nOne\r\n\r\n2\r\n00:00:02,500 --> 00:00:04,000\r\nTwo\r\n');
}
{
  const dots = '1\n00:00:01.5 --> 00:00:02.25\nA full stop and short milliseconds\n';
  check('an SRT with full stops and short milliseconds', convert(dots, 'srt', { from: 'srt' }).output.includes('00:00:01,500 --> 00:00:02,250'));
  check('an SRT with full stops is still SRT by its name', detect(dots, 'film.srt') === 'srt');
  check('arrow times with full stops and no header read as VTT', detect(dots) === 'vtt');
}
{
  const gaps = '\n\n1\n00:00:01,000 --> 00:00:02,000   \n  One  \n\n\n\n2\n00:00:03,000 --> 00:00:04,000\nTwo\n\n\n';
  check('extra blank lines and spaces', same(parse(gaps).cues.map(c => c.lines), [['One'], ['Two']]), parse(gaps).cues);
}
{
  const inside = '1\n00:00:01,000 --> 00:00:03,000\nFirst line\n\nsecond line after a blank line\n\n2\n00:00:04,000 --> 00:00:05,000\nTwo\n';
  const r = parse(inside);
  check('text after a blank line inside a caption stays with it', same(r.cues.map(c => c.lines), [['First line', 'second line after a blank line'], ['Two']]) && r.notes.joined === 1, r.cues);
}
{
  const empty = '1\n00:00:01,000 --> 00:00:02,000\n\n2\n00:00:02,000 --> 00:00:03,000\n<i></i>\n\n3\n00:00:03,000 --> 00:00:04,000\nThree\n';
  const r = parse(empty);
  check('empty captions are left out and counted', r.cues.length === 1 && r.notes.empty === 2 && r.cues[0].lines[0] === 'Three', r);
}
{
  const backwards = '1\n00:00:05,000 --> 00:00:01,000\nEnds before it starts\n\n2\n00:00:06,000 --> 00:00:08,000\nNext\n';
  const r = parse(backwards);
  check('a caption that ends before it starts gets its reading time, never past the next', r.cues[0].end > 5000 && r.cues[0].end <= 6000 && r.notes.fixed === 1, r.cues[0]);
}
{
  const order = '1\n00:00:05,000 --> 00:00:06,000\nSecond\n\n2\n00:00:01,000 --> 00:00:02,000\nFirst\n';
  const r = parse(order);
  check('captions out of order are put in time order', r.cues[0].lines[0] === 'First' && r.notes.sorted, r.cues);
}
{
  const fancy = '1\n00:00:01,000 --> 00:00:02,000 X1:100 X2:600 Y1:50 Y2:80\n{\\an8}<font color="#ffff00">Top</font> <I>and</I> <b>bold\nacross</b> <u>lines</u>\n';
  const r = convert(fancy, 'srt');
  check('SRT: coordinates, {\\an8} and font colours go; italics, bold and underline stay', same(r.cues[0].lines, ['Top <i>and</i> <b>bold', 'across</b> <u>lines</u>']) && r.notes.styles, r.cues[0].lines);
  check('SRT to VTT: the kept tags are valid VTT', convert(fancy, 'vtt').output.includes('Top <i>and</i> <b>bold\nacross</b> <u>lines</u>'));
}
{
  const open = '1\n00:00:01,000 --> 00:00:02,000\n<i>never closed\n</b>stray close\n';
  check('an unclosed tag is closed and a stray close goes', same(parse(open).cues[0].lines, ['<i>never closed', 'stray close</i>']), parse(open).cues[0].lines);
  const spread = '1\n00:00:01,000 --> 00:00:02,000\n<i>\nItalic on its own line\n</i>\n';
  check('a tag alone on a line moves to the words', same(parse(spread).cues[0].lines, ['<i>Italic on its own line</i>']), parse(spread).cues[0].lines);
}

// ---- VTT ----
{
  const messy = [
    'WEBVTT - Bakery episode', 'Kind: captions', 'Language: en-GB', '',
    'NOTE', 'This file was made for the web.', 'It has two notes.', '',
    'STYLE', '::cue { color: yellow; }', '',
    'REGION', 'id:bottom', 'width:40%', '',
    'intro-1', '00:00.600 --> 00:04.160 align:start position:10% line:0',
    "<v Siobhan>Hi, I'm Siobhan, and this is Callum.</v>", '',
    'NOTE a note between captions', '',
    '2', '00:00:04.160 --> 00:00:06.770 region:bottom',
    '<c.yellow>We run</c> a <lang en-GB>bakery</lang> in Leeds.', '',
    '00:00:06.770 --> 00:00:10.880',
    "Today<00:00:07.500><c> we'll</c> show you how we make", 'our <i.loud>famous</i> Bakewell tart.', '',
    '00:00:10.880 --> 00:00:16.700', '&lt;music&gt; &amp; <ruby>漢<rt>kan</rt></ruby>&nbsp;tart', '',
  ].join('\n');
  const r = parse(messy);
  check('VTT: header lines, notes, a style and a region are left out', r.cues.length === 4 && r.notes.blocks === 4, r.notes);
  check('VTT: cue names and settings go, the words stay', r.cues[0].lines[0] === "Hi, I'm Siobhan, and this is Callum." && r.cues[0].start === 600 && r.notes.styles, r.cues[0]);
  check('VTT: class, language and voice tags go', r.cues[1].lines[0] === 'We run a bakery in Leeds.', r.cues[1]);
  check('VTT: karaoke times go, italics stay', same(r.cues[2].lines, ["Today we'll show you how we make", 'our <i>famous</i> Bakewell tart.']), r.cues[2]);
  check('VTT: entities read, ruby readings left out', r.cues[3].lines[0] === '<music> & 漢\u00A0tart', r.cues[3]);
  check('VTT to SRT: a clean SRT', convert(messy, 'srt').output.startsWith("1\r\n00:00:00,600 --> 00:00:04,160\r\nHi, I'm Siobhan, and this is Callum.\r\n\r\n2\r\n"));
  check('VTT out: "&", "<" and ">" escaped, so no caption holds "-->"', convert('1\n00:00:01,000 --> 00:00:02,000\nA --> B & 1 < 2\n', 'vtt').output === 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA --&gt; B &amp; 1 &lt; 2\n');
  const youtube = 'WEBVTT\nKind: captions\nLanguage: en\n\n00:00:00.000 --> 00:00:02.330 align:start position:0%\n \nhello<00:00:00.320><c> everyone</c>\n\n00:00:02.330 --> 00:00:04.000 align:start position:0%\nwelcome back\n';
  check('VTT from YouTube: a line holding one space does not lose the words after it', same(parse(youtube).cues.map(c => c.lines), [['hello everyone'], ['welcome back']]), parse(youtube).cues);
  check('WEBVTT straight above the first time', parse('WEBVTT\n00:00:01.000 --> 00:00:02.000\nNo blank line\n').cues[0].lines[0] === 'No blank line');
}

// ---- SBV ----
check('SBV: [br] is a line break', same(parse('0:00:01.000,0:00:02.000\nOne[br]two\n').cues[0].lines, ['One', 'two']));
check('SBV: detected without a name', detect(SBV) === 'sbv' && detect('0:00:01.000,0:00:02.000\nHi\n') === 'sbv');

// ---- ASS and SSA ----
{
  const r = parse(ASS);
  check('ASS: the comment line is left out', r.cues.length === 5 && !r.cues.some(c => c.lines.join(' ').includes('typesetter')));
  check('ASS: commas in the text are kept', r.cues[0].lines[0] === "Hi, I'm Siobhan, and this is Callum.", r.cues[0]);
  check('ASS: override codes go, \\i1 and \\i0 become italics, \\N a new line', same(r.cues[2].lines, ["Today we'll show you how we make", 'our <i>famous</i> Bakewell tart.']) && r.notes.styles, r.cues[2]);
  const draw = 'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100 0 100{\\p0}Sign\\hhere {\\b1}now{\\b0}\\nplease';
  check('ASS: a drawing goes whole, \\h is a no-break space, \\b1 is bold, \\n a space', parse(draw, { from: 'ass' }).cues[0].lines[0] === 'Sign\u00A0here <b>now</b> please', parse(draw, { from: 'ass' }).cues);
  const ssa = '[Script Info]\nScriptType: v4.00\n\n[Events]\nFormat: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: Marked=0,0:00:02.00,0:00:03.00,*Default,NTP,0000,0000,0000,!Effect,Second\nDialogue: Marked=0,0:00:01.00,0:00:02.00,*Default,NTP,0000,0000,0000,!Effect,First\n';
  const s = parse(ssa);
  check('SSA (v4): read, and put in time order', s.format === 'ass' && same(s.cues.map(c => c.lines[0]), ['First', 'Second']) && s.notes.sorted, s.cues);
  const order = '[Events]\nFormat: Start, End, Text, Style\nDialogue: 0:00:01.00,0:00:02.00,Text before the style,Default\n';
  check('ASS: a Format line in another order', parse(order, { from: 'ass' }).cues[0].lines[0] === 'Text before the style', parse(order, { from: 'ass' }).cues);
}

// ---- text with no times, and what is not read ----
{
  const r = convert('Hello and welcome to the show. Today we talk about subtitles.', 'srt');
  check('plain text: timed by reading speed, and the note says so', r.from === 'plain' && r.cues.length >= 1 && r.notes.estimated && r.output.startsWith('1\r\n00:00:00,000 --> '), r);
  check('text with one time at the start only is plain text', detect('10:30 is when we meet.\nBring the tart.') === 'plain');
  check('(1:05) and 00:01:05 - forms read as times', detect('(0:01) First\n(0:05) Second') === 'txt' && same(parse('00:00:01 - First\n00:00:05 - Second').cues.map(c => [c.start, c.lines[0]]), [[1000, 'First'], [5000, 'Second']]));
  check('MicroDVD (frame numbers) is named, not read', detect('{100}{200}Hello\n{250}{300}There') === 'microdvd' && parse('{100}{200}Hello').cues.length === 0);
  check('nothing in, nothing out', detect('  \n ') === '' && convert('', 'srt').output === '' && convert('', 'srt').cues.length === 0);
}

// ---- other scripts and encodings ----
{
  const ar = '1\n00:00:01,000 --> 00:00:02,000\nمرحبا بكم في المخبز\n\n2\n00:00:02,000 --> 00:00:03,000\nनमस्ते, यह बेकरी है।\n';
  const v = convert(ar, 'vtt').output;
  check('Arabic and Hindi come through as written', v.includes('مرحبا بكم في المخبز') && v.includes('नमस्ते, यह बेकरी है।'), v);
  const enc = new TextEncoder();
  check('bytes: UTF-8 with its mark', decodeBytes(enc.encode('\uFEFF1\nCafé')).encoding === 'UTF-8' && decodeBytes(enc.encode('\uFEFF1\nCafé')).text.replace(/^\uFEFF/, '') === '1\nCafé');
  const latin = new Uint8Array([0x43, 0x61, 0x66, 0xE9, 0x20, 0x92, 0x6E]); // "Café 'n" in Windows-1252
  check('bytes: an old Windows-1252 file', decodeBytes(latin).encoding === 'Windows-1252' && decodeBytes(latin).text === 'Café \u2019n', decodeBytes(latin));
  const u16 = new Uint8Array([0xFF, 0xFE, 0x48, 0x00, 0xE9, 0x00]); // "Hé" in UTF-16LE with its mark
  check('bytes: UTF-16 with its mark', decodeBytes(u16).encoding === 'UTF-16' && decodeBytes(u16).text === 'Hé', decodeBytes(u16));
}

// ---- a long film ----
// The budget catches a quadratic slip (20,000 cues would take minutes), not a slow
// machine.
{
  const BUDGET = 10000;
  const n = 20000;
  const big = Array.from({ length: n }, (_, i) => `${i + 1}\n${srtTime(i * 3000)} --> ${srtTime(i * 3000 + 2500)}\nLine ${i + 1}, said <i>clearly</i>\nand a second line\n`).join('\n');
  const t0 = Date.now();
  const r = convert(big, 'vtt');
  const ms = Date.now() - t0;
  check(`20,000 captions convert in under 10 s (${ms} ms)`, ms < BUDGET && r.cues.length === n && r.output.split('\n\n').length === n + 1, ms);
  const t1 = Date.now();
  const tt = convert(Array.from({ length: n }, (_, i) => `[${srtTime(i * 3000).slice(0, 8)}] Line ${i}`).join('\n'), 'srt');
  check(`20,000 lines of text with times in under 10 s (${Date.now() - t1} ms)`, Date.now() - t1 < BUDGET && tt.cues.length === n);
}

console.log(`subconv: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
