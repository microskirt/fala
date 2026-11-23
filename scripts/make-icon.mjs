/*
 * Builds web/public/icon-512.png: the same bar mark as favicon.svg, rasterised
 * so browsers have a square PNG for media controls and OS surfaces.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const SIZE = 512;

const BARS = [
  { x: 96, y: 208, w: 42, h: 96, a: 0.55 },
  { x: 170, y: 152, w: 42, h: 208, a: 0.8 },
  { x: 243, y: 104, w: 42, h: 304, a: 1 },
  { x: 317, y: 168, w: 42, h: 176, a: 0.8 },
  { x: 390, y: 224, w: 42, h: 64, a: 0.55 },
];

const RADIUS = 144;

function insideRounded(x, y) {
  const r = RADIUS;
  const cx = Math.min(Math.max(x, r), SIZE - r);
  const cy = Math.min(Math.max(y, r), SIZE - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

const rows = [];
for (let y = 0; y < SIZE; y++) {
  const row = Buffer.alloc(SIZE * 4 + 1);
  row[0] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const o = 1 + x * 4;
    if (!insideRounded(x + 0.5, y + 0.5)) {
      row[o] = 0;
      row[o + 1] = 0;
      row[o + 2] = 0;
      row[o + 3] = 0;
      continue;
    }
    let r = 0x17;
    let g = 0x17;
    let b = 0x1b;
    for (const bar of BARS) {
      if (x >= bar.x && x < bar.x + bar.w && y >= bar.y && y < bar.y + bar.h) {
        const a = bar.a;
        r = Math.round(0xff * a + r * (1 - a));
        g = Math.round(0xff * a + g * (1 - a));
        b = Math.round(0xff * a + b * (1 - a));
      }
    }
    row[o] = r;
    row[o + 1] = g;
    row[o + 2] = b;
    row[o + 3] = 255;
  }
  rows.push(row);
}

const raw = Buffer.concat(rows);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

writeFileSync('web/public/icon-512.png', png);
console.log('wrote web/public/icon-512.png', png.length, 'bytes');
