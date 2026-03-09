// Generates a macOS ICNS file with Edit Factory brand icon.
// Reuses brand design (rounded video frame + play triangle) from generate-icon.js.
// All icon entries use embedded PNG format (modern ICNS standard).
// No external dependencies — uses Node.js built-in zlib for PNG compression.
//
// Usage: node electron/build/generate-icns.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Brand colors (RGBA) — same as generate-icon.js
const INDIGO_500 = { r: 0x63, g: 0x66, b: 0xf1, a: 0xff }; // Primary frame
const INDIGO_400 = { r: 0x81, g: 0x8c, b: 0xf8, a: 0xff }; // Play triangle
const INDIGO_950 = { r: 0x1e, g: 0x1b, b: 0x4b, a: 0xff }; // Background
const TRANSPARENT = { r: 0x00, g: 0x00, b: 0x00, a: 0x00 };

function dist(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

// Create pixel buffer for one icon size — identical to generate-icon.js
function generatePixels(size) {
  const pixels = new Array(size * size);

  const margin = Math.max(1, Math.floor(size * 0.06));
  const cornerRadius = Math.max(2, Math.floor(size * 0.18));

  const left = margin;
  const top = margin;
  const right = size - margin - 1;
  const bottom = size - margin - 1;

  function inRoundedRect(x, y) {
    if (x < left || x > right || y < top || y > bottom) return false;
    const corners = [
      { cx: left + cornerRadius, cy: top + cornerRadius },
      { cx: right - cornerRadius, cy: top + cornerRadius },
      { cx: left + cornerRadius, cy: bottom - cornerRadius },
      { cx: right - cornerRadius, cy: bottom - cornerRadius },
    ];
    for (const c of corners) {
      const inCornerRegion =
        (x < left + cornerRadius && y < top + cornerRadius && x - left < cornerRadius && y - top < cornerRadius) ||
        (x > right - cornerRadius && y < top + cornerRadius && right - x < cornerRadius && y - top < cornerRadius) ||
        (x < left + cornerRadius && y > bottom - cornerRadius && x - left < cornerRadius && bottom - y < cornerRadius) ||
        (x > right - cornerRadius && y > bottom - cornerRadius && right - x < cornerRadius && bottom - y < cornerRadius);
      if (inCornerRegion) {
        if (dist(x, y, c.cx, c.cy) > cornerRadius) return false;
      }
    }
    return true;
  }

  function inPlayTriangle(x, y) {
    const cx = size * 0.54;
    const cy = size * 0.5;
    const triHeight = size * 0.36;
    const triWidth = triHeight * 0.866;
    const x1 = cx - triWidth * 0.35;
    const y1 = cy - triHeight / 2;
    const x2 = cx - triWidth * 0.35;
    const y2 = cy + triHeight / 2;
    const x3 = cx + triWidth * 0.65;
    const y3 = cy;
    const denom = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
    if (Math.abs(denom) < 0.001) return false;
    const a = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / denom;
    const b = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / denom;
    const c = 1 - a - b;
    return a >= 0 && b >= 0 && c >= 0;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      if (inRoundedRect(x, y)) {
        if (inPlayTriangle(x, y)) {
          pixels[idx] = INDIGO_400;
        } else {
          pixels[idx] = INDIGO_950;
        }
      } else {
        pixels[idx] = TRANSPARENT;
      }
    }
  }

  const borderWidth = Math.max(1, Math.floor(size * 0.06));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      if (pixels[idx] === TRANSPARENT) continue;
      let nearEdge = false;
      for (let dy = -borderWidth; dy <= borderWidth; dy++) {
        for (let dx = -borderWidth; dx <= borderWidth; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= size || ny < 0 || ny >= size) { nearEdge = true; break; }
          if (pixels[ny * size + nx] === TRANSPARENT) { nearEdge = true; break; }
        }
        if (nearEdge) break;
      }
      if (nearEdge && !inPlayTriangle(x, y)) {
        pixels[idx] = INDIGO_500;
      }
    }
  }

  return pixels;
}

// ── PNG encoder (minimal, pure JS) ──────────────────────────────────────

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function encodePNG(pixels, size) {
  // IHDR: width, height, bit depth 8, color type 6 (RGBA), compression 0, filter 0, interlace 0
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData.writeUInt8(8, 8);   // bit depth
  ihdrData.writeUInt8(6, 9);   // color type RGBA
  ihdrData.writeUInt8(0, 10);  // compression
  ihdrData.writeUInt8(0, 11);  // filter
  ihdrData.writeUInt8(0, 12);  // interlace

  // Raw image data: filter byte (0 = None) + RGBA pixels per row
  const rowBytes = 1 + size * 4;
  const rawData = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y++) {
    const rowOffset = y * rowBytes;
    rawData[rowOffset] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const px = pixels[y * size + x];
      const pxOffset = rowOffset + 1 + x * 4;
      rawData[pxOffset] = px.r;
      rawData[pxOffset + 1] = px.g;
      rawData[pxOffset + 2] = px.b;
      rawData[pxOffset + 3] = px.a;
    }
  }

  const compressed = zlib.deflateSync(rawData, { level: 9 });

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = pngChunk('IHDR', ihdrData);
  const idat = pngChunk('IDAT', compressed);
  const iend = pngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

// ── ICNS builder ────────────────────────────────────────────────────────

// Modern ICNS OSType codes (all use embedded PNG data)
const ICNS_TYPES = [
  { osType: 'ic11', size: 32 },    // 16@2x retina
  { osType: 'ic12', size: 64 },    // 32@2x retina
  { osType: 'ic07', size: 128 },   // 128x128
  { osType: 'ic13', size: 256 },   // 128@2x retina
  { osType: 'ic08', size: 256 },   // 256x256
  { osType: 'ic14', size: 512 },   // 256@2x retina
  { osType: 'ic09', size: 512 },   // 512x512
  { osType: 'ic10', size: 1024 },  // 512@2x retina
];

function buildIcns() {
  const entries = [];
  const pngCache = new Map(); // Cache PNG data by size to avoid regenerating

  for (const { osType, size } of ICNS_TYPES) {
    let pngData = pngCache.get(size);
    if (!pngData) {
      console.log(`  Generating ${size}x${size} pixels...`);
      const pixels = generatePixels(size);
      pngData = encodePNG(pixels, size);
      pngCache.set(size, pngData);
    }

    // ICNS entry: OSType (4 bytes) + entry size (4 bytes) + PNG data
    const entrySize = 8 + pngData.length;
    const entry = Buffer.alloc(entrySize);
    entry.write(osType, 0, 4, 'ascii');
    entry.writeUInt32BE(entrySize, 4);
    pngData.copy(entry, 8);
    entries.push(entry);

    console.log(`  ${osType}: ${size}x${size} (${pngData.length} bytes PNG)`);
  }

  // ICNS header: magic 'icns' (4 bytes) + total file size (4 bytes)
  const dataSize = entries.reduce((sum, e) => sum + e.length, 0);
  const totalSize = 8 + dataSize;
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(totalSize, 4);

  return Buffer.concat([header, ...entries]);
}

// ── Validation ──────────────────────────────────────────────────────────

function validateIcns(filePath) {
  const buf = fs.readFileSync(filePath);
  const magic = buf.slice(0, 4).toString('ascii');
  const fileSize = buf.readUInt32BE(4);

  console.log('\n--- ICNS Validation ---');
  console.log(`Magic: ${magic} (expected: icns)`);
  console.log(`Header size: ${fileSize} bytes`);
  console.log(`Actual size: ${buf.length} bytes`);

  if (magic !== 'icns') {
    console.error('FAIL: Invalid magic bytes');
    process.exit(1);
  }
  if (fileSize !== buf.length) {
    console.error('FAIL: File size mismatch');
    process.exit(1);
  }

  // Walk entries
  let offset = 8;
  let entryCount = 0;
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  while (offset < buf.length) {
    const osType = buf.slice(offset, offset + 4).toString('ascii');
    const entrySize = buf.readUInt32BE(offset + 4);
    const dataStart = offset + 8;
    const isPng = buf.slice(dataStart, dataStart + 4).equals(PNG_MAGIC);

    console.log(`  Entry: ${osType}, size: ${entrySize} bytes, PNG: ${isPng ? 'YES' : 'NO'}`);

    if (!isPng) {
      console.error(`FAIL: Entry ${osType} does not contain valid PNG data`);
      process.exit(1);
    }

    entryCount++;
    offset += entrySize;
  }

  console.log(`\nTotal entries: ${entryCount}`);
  console.log('Validation: PASSED');
  return true;
}

// ── Main ────────────────────────────────────────────────────────────────

console.log('Generating macOS icon.icns...');
const icns = buildIcns();
const outPath = path.join(__dirname, 'icon.icns');
fs.writeFileSync(outPath, icns);
console.log(`\nGenerated icon.icns at ${outPath}`);
console.log(`File size: ${icns.length} bytes, ${ICNS_TYPES.length} icon entries`);

validateIcns(outPath);
