/*
 * Rasterises the bar mark from favicon.svg into the PNGs the PWA needs:
 * launcher icons (192/512), a maskable variant and the iOS home-screen icon.
 *
 * The mark is defined once in a 512-unit design space and scaled per output,
 * so every size stays pixel-consistent instead of being resampled.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

/*
 * The mark is symmetrical: the two bars on the left are mirrored across the
 * centre bar, so the icon reads as one clean shape instead of a lopsided one.
 * The group spans 88..424, which centres it in the 512 design square.
 */
const BARS = [
  { x: 88, y: 208, w: 42, h: 96, a: 0.55 },
  { x: 162, y: 152, w: 42, h: 208, a: 0.8 },
  { x: 235, y: 104, w: 42, h: 304, a: 1 },
  { x: 308, y: 152, w: 42, h: 208, a: 0.8 },
  { x: 382, y: 208, w: 42, h: 96, a: 0.55 },
];

const DESIGN = 512;
const DESIGN_RADIUS = 144;

/*
 * Android masks maskable icons down to a circle, and the spec only guarantees
 * the central 80% survives. Shrinking the mark keeps every bar inside that
 * safe zone, while the background stays full-bleed so the mask never reveals
 * an empty corner.
 */
const MASKABLE_SAFE = 0.68;

const BG = [0x17, 0x17, 0x1b];

function crc32Table() {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
}
const CRC_TABLE = crc32Table();

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

/*
 * `radius` is in output pixels; 0 means a full-bleed square, which opaque
 * icons (iOS) and maskable icons need because the platform draws the shape.
 */
function renderPng(size, { radius = 0, maskable = false } = {}) {
  const scale = size / DESIGN;
  const markScale = scale * (maskable ? MASKABLE_SAFE : 1);
  // Scaling around the design centre keeps the mark optically centred.
  const offset = size / 2 - (DESIGN / 2) * markScale;
  const bars = BARS.map((b) => ({
    x: b.x * markScale + offset,
    y: b.y * markScale + offset,
    w: b.w * markScale,
    h: b.h * markScale,
    a: b.a,
  }));

  const inside = (x, y) => {
    if (radius <= 0) return true;
    const r = Math.min(radius, size / 2);
    const cx = Math.min(Math.max(x, r), size - r);
    const cy = Math.min(Math.max(y, r), size - r);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  };

  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(size * 4 + 1);
    row[0] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const o = 1 + x * 4;
      if (!inside(x + 0.5, y + 0.5)) {
        row[o] = 0;
        row[o + 1] = 0;
        row[o + 2] = 0;
        row[o + 3] = 0;
        continue;
      }
      let r = BG[0];
      let g = BG[1];
      let b = BG[2];
      for (const bar of bars) {
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

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/*
 * iOS composites the icon on white and applies its own corner mask, so the
 * touch icon must be opaque and square — any transparency shows as a white
 * halo around the logo.
 */
const TARGETS = [
  { file: 'web/public/icon-512.png', size: 512, radius: DESIGN_RADIUS },
  { file: 'web/public/icon-192.png', size: 192, radius: (DESIGN_RADIUS * 192) / DESIGN },
  { file: 'web/public/icon-maskable-512.png', size: 512, radius: 0, maskable: true },
  { file: 'web/public/apple-touch-icon.png', size: 180, radius: 0 },
];

for (const target of TARGETS) {
  const png = renderPng(target.size, { radius: target.radius, maskable: target.maskable });
  writeFileSync(target.file, png);
  console.log(`wrote ${target.file} ${target.size}x${target.size} ${png.length} bytes`);
}
