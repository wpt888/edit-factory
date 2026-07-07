// Generates icon.ico and icon.icns from blipost-icon.png (the real brand
// logo). Resizing/PNG encoding uses `sharp` (already installed under
// frontend/node_modules — no new dependency); the ICO/ICNS container bytes
// are hand-built, same approach the old procedural generators used.
//
// Usage: node electron/build/generate-icon-from-png.js

const fs = require('fs');
const path = require('path');
const sharp = require(path.join(__dirname, '..', '..', 'frontend', 'node_modules', 'sharp'));

const SRC = path.join(__dirname, 'blipost-icon.png');
const ICO_SIZES = [16, 32, 48, 256];
const ICNS_TYPES = [
  { osType: 'ic11', size: 32 },   // 16@2x
  { osType: 'ic12', size: 64 },   // 32@2x
  { osType: 'ic07', size: 128 },
  { osType: 'ic13', size: 256 },  // 128@2x
  { osType: 'ic08', size: 256 },
  { osType: 'ic14', size: 512 },  // 256@2x
  { osType: 'ic09', size: 512 },
  { osType: 'ic10', size: 1024 }, // 512@2x
];

function rgba(size) {
  return sharp(SRC).resize(size, size, { fit: 'cover' }).ensureAlpha().raw().toBuffer();
}
function pngAt(size) {
  return sharp(SRC).resize(size, size, { fit: 'cover' }).png().toBuffer();
}

// ---------- ICO ----------
function bitmapEntry(size, raw) {
  const pixelDataSize = size * size * 4;
  const maskRowBytes = (Math.ceil(size / 8) + 3) & ~3; // padded to 4 bytes
  const maskSize = maskRowBytes * size;
  const buf = Buffer.alloc(40 + pixelDataSize + maskSize);
  let o = 0;
  buf.writeUInt32LE(40, o); o += 4;              // BITMAPINFOHEADER size
  buf.writeInt32LE(size, o); o += 4;
  buf.writeInt32LE(size * 2, o); o += 4;          // height doubled (mask included)
  buf.writeUInt16LE(1, o); o += 2;                // planes
  buf.writeUInt16LE(32, o); o += 2;               // bpp
  buf.writeUInt32LE(0, o); o += 4;                // compression
  buf.writeUInt32LE(pixelDataSize + maskSize, o); o += 4;
  o += 16;                                        // xppm/yppm/colors/important — left 0

  // Pixel data: BGRA, bottom-up
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      buf.writeUInt8(raw[i + 2], o++); // B
      buf.writeUInt8(raw[i + 1], o++); // G
      buf.writeUInt8(raw[i], o++);     // R
      buf.writeUInt8(raw[i + 3], o++); // A
    }
  }
  // AND mask (1 = transparent), bottom-up, row-padded to 4 bytes
  for (let y = size - 1; y >= 0; y--) {
    let bit = 0, count = 0;
    for (let x = 0; x < size; x++) {
      const a = raw[(y * size + x) * 4 + 3];
      bit = (bit << 1) | (a === 0 ? 1 : 0);
      if (++count === 8) { buf.writeUInt8(bit, o++); bit = 0; count = 0; }
    }
    if (count > 0) buf.writeUInt8(bit << (8 - count), o++);
    for (let p = Math.ceil(size / 8); p < maskRowBytes; p++) buf.writeUInt8(0, o++);
  }
  return buf;
}

async function buildIco() {
  const images = [];
  for (const size of ICO_SIZES) images.push({ size, data: bitmapEntry(size, await rgba(size)) });

  const dirSize = 16 * images.length;
  let dataOffset = 6 + dirSize;
  const total = 6 + dirSize + images.reduce((s, i) => s + i.data.length, 0);
  const ico = Buffer.alloc(total);
  let o = 0;
  ico.writeUInt16LE(0, o); o += 2;               // reserved
  ico.writeUInt16LE(1, o); o += 2;               // type: ICO
  ico.writeUInt16LE(images.length, o); o += 2;
  for (const img of images) {
    ico.writeUInt8(img.size < 256 ? img.size : 0, o++);
    ico.writeUInt8(img.size < 256 ? img.size : 0, o++);
    o += 2; // palette, reserved
    ico.writeUInt16LE(1, o); o += 2;   // color planes
    ico.writeUInt16LE(32, o); o += 2;  // bpp
    ico.writeUInt32LE(img.data.length, o); o += 4;
    ico.writeUInt32LE(dataOffset, o); o += 4;
    dataOffset += img.data.length;
  }
  for (const img of images) { img.data.copy(ico, o); o += img.data.length; }
  return ico;
}

// ---------- ICNS ----------
async function buildIcns() {
  const cache = new Map();
  const entries = [];
  for (const { osType, size } of ICNS_TYPES) {
    let png = cache.get(size);
    if (!png) { png = await pngAt(size); cache.set(size, png); }
    const entry = Buffer.alloc(8 + png.length);
    entry.write(osType, 0, 4, 'ascii');
    entry.writeUInt32BE(entry.length, 4);
    png.copy(entry, 8);
    entries.push(entry);
  }
  const total = 8 + entries.reduce((s, e) => s + e.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(total, 4);
  return Buffer.concat([header, ...entries]);
}

(async () => {
  const ico = await buildIco();
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), ico);
  console.log(`icon.ico: ${ico.length} bytes (${ICO_SIZES.join(', ')}px)`);

  const icns = await buildIcns();
  fs.writeFileSync(path.join(__dirname, 'icon.icns'), icns);
  console.log(`icon.icns: ${icns.length} bytes (${ICNS_TYPES.length} entries)`);
})();
