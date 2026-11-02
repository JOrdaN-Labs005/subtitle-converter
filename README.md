# Subtitle converter

Convert subtitle files between SRT, VTT (WebVTT), SBV and text, and read ASS and SSA. Plain JavaScript with no dependencies: it runs entirely in the browser or in Node and makes no network requests.

Try it in the browser: https://burncaps.app/subtitle-converter

## What it reads and writes

| Format | Read | Written |
| --- | --- | --- |
| SRT (SubRip) | Yes | Yes |
| VTT (WebVTT) | Yes | Yes |
| SBV (SubViewer, as YouTube reads it) | Yes | Yes |
| Text, with a time at the start of each line or with none | Yes | Yes, with `[00:01:05]` start times or without |
| ASS and SSA | Yes | No |

The content decides the format; a file name only settles SRT against VTT when a file has arrow times and no `WEBVTT` line. A time at the start of a line of text can look like `[00:01:05]`, `(1:05)`, `00:01:05 -` or `1:05`, and each caption then lasts until the next one starts. Text with no times at all is timed by reading speed: 17 characters a second, each caption shown for 1.2 to 7 seconds, in lines of up to 42 characters and two lines a caption. A MicroDVD file (frame numbers) is recognised and named, but not read.

### What comes through

Every file is read into one list of captions, `{ start, end, lines }`, with times in whole milliseconds. Italics, bold and underline (`<i>`, `<b>`, `<u>`) are kept in SRT and VTT, balanced within each caption. What the target cannot hold is left out and reported in `notes`: VTT positions, classes, voices and comments, ASS override codes and drawings, SRT font colours and `{\an8}` positions. SBV and text keep no tags. In ASS, `\N` becomes a new line, `\h` a no-break space, and `\i1`, `\b1` and `\u1` become tags.

### Messy files

The reader copes with a byte order mark, Windows (CRLF) and old Mac (CR) line ends, no blank line between captions, no caption numbers, a comma or a full stop before the milliseconds with one to three digits of them, hours left out, coordinates after an SRT time, and text after a blank line inside a caption. Empty captions are left out and counted. A caption that ends before it starts is given its reading time, never running past the next one. Captions out of order are put in time order. VTT headers, `NOTE`, `STYLE` and `REGION` blocks, cue names and settings, karaoke times and ruby readings are left out, and entities such as `&amp;` are read.

### Encodings

`decodeBytes()` reads UTF-8 (with or without its byte order mark), UTF-16 (little or big endian, with its mark) and, when the bytes are not valid UTF-8, old Windows-1252 files. The output is a string meant to be saved as UTF-8; `MIME` holds the content type for each format, with `charset=utf-8`. SRT is written with Windows line ends, as SubRip wrote it; VTT, SBV and text with Unix line ends. VTT output escapes `&`, `<` and `>`, so no caption can hold `-->`.

## Usage

Copy `subconv.js` and `srt.js` into your project (the converter imports the second), or install it from GitHub:

```sh
npm install github:JOrdaN-Labs005/subtitle-converter
```

In Node:

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { convert, decodeBytes } from 'subtitle-converter'; // or './subconv.js'

const { text, encoding } = decodeBytes(readFileSync('talk.srt'));
const result = convert(text, 'vtt', { name: 'talk.srt' });

writeFileSync('talk.vtt', result.output);
console.log(result.from, encoding, result.cues.length); // srt UTF-8 2
```

In the browser, from a `File` (for example one picked with `<input type="file">`):

```js
import { convert, decodeBytes, MIME } from './subconv.js';

const { text } = decodeBytes(new Uint8Array(await file.arrayBuffer()));
const { output } = convert(text, 'srt', { name: file.name });
const blob = new Blob([output], { type: MIME.srt });
```

## API

- `convert(text, to, { from, name, times })` returns `{ from, to, cues, output, notes }`. `to` is one of `OUTPUTS`: `'srt'`, `'vtt'`, `'sbv'` or `'txt'`. `from` forces the input format, `name` (the file name) helps tell SRT from VTT, and `times: true` puts the start time before each line of text output.
- `parse(text, { from, name })` returns `{ format, cues, notes }`.
- `write(cues, to, { times })` returns the file's text.
- `detect(text, name)` returns `'srt'`, `'vtt'`, `'sbv'`, `'ass'`, `'txt'` (text with times), `'plain'`, `'microdvd'` or `''` (nothing in it).
- `decodeBytes(bytes)` returns `{ text, encoding }`, the encoding being `'UTF-8'`, `'UTF-16'` or `'Windows-1252'`.
- `toMs('01:02:03,500')` returns `3723500`; `srtTime`, `vttTime` and `sbvTime` write a time in milliseconds the way each format does.
- `notes` counts what was done: `empty` (empty captions left out), `fixed` (captions given a reading time), `sorted` (put in time order), `joined` (text after a blank line kept with its caption), `blocks` (VTT `NOTE`, `STYLE` and `REGION` blocks left out), `styles` (styling the target cannot hold was left out) and `estimated` (plain text timed by reading speed).
- `LABELS`, `NAMES`, `EXT` and `MIME` give each format's short label, its name in a sentence, its file extension and its content type.
- `srt.js` also exports `textToSrt(text, options)`, which turns plain text into timed SRT captions.

## Tests

```sh
node test.mjs
```

or `npm test`. The 99 checks convert every pair of formats and compare the result with files written by hand, run round trips, feed in the messy cases above, Arabic and Hindi text, UTF-8, UTF-16 and Windows-1252 bytes, and convert 20,000 captions inside a time limit. The exit code is 1 if any check fails.

## Licence

MIT, see [LICENSE](LICENSE).

Made by Burncaps (Jordan Labs Ltd), a browser tool for word-by-word captions: https://burncaps.app
