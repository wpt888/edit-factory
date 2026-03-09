// Generates a multi-resolution ICO file with Edit Factory brand icon.
// Sizes: 16x16, 32x32, 48x48, 256x256
// Brand colors: #6366f1 (indigo-500), #818cf8 (indigo-400), #1e1b4b (indigo-950)
// Design: Rounded video frame with play triangle accent
//
// Usage: node electron/build/generate-icon.js

const fs = require('fs');
const path = require('path');

// Brand colors (RGBA)
const INDIGO_500 = { r: 0x63, g: 0x66, b: 0xf1, a: 0xff }; // Primary frame
const INDIGO_400 = { r: 0x81, g: 0x8c, b: 0xf8, a: 0xff }; // Play triangle
const INDIGO_950 = { r: 0x1e, g: 0x1b, b: 0x4b, a: 0xff }; // Background
const TRANSPARENT = { r: 0x00, g: 0x00, b: 0x00, a: 0x00 };

// Draw a filled circle check (for rounded rectangle corners)
function dist(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

// Create pixel buffer for one icon size
function generatePixels(size) {
  const pixels = new Array(size * size);

  const margin = Math.max(1, Math.floor(size * 0.06));
  const cornerRadius = Math.max(2, Math.floor(size * 0.18));

  // Rounded rectangle bounds (the "video frame")
  const left = margin;
  const top = margin;
  const right = size - margin - 1;
  const bottom = size - margin - 1;

  // Helper: is point inside rounded rectangle?
  function inRoundedRect(x, y) {
    if (x < left || x > right || y < top || y > bottom) return false;

    // Check corners
    const corners = [
      { cx: left + cornerRadius, cy: top + cornerRadius },     // top-left
      { cx: right - cornerRadius, cy: top + cornerRadius },    // top-right
      { cx: left + cornerRadius, cy: bottom - cornerRadius },  // bottom-left
      { cx: right - cornerRadius, cy: bottom - cornerRadius }, // bottom-right
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

  // Helper: is point inside the play triangle?
  // Centered slightly right of center, equilateral-ish triangle
  function inPlayTriangle(x, y) {
    const cx = size * 0.54; // Slightly right of center (visual balance)
    const cy = size * 0.5;
    const triHeight = size * 0.36;
    const triWidth = triHeight * 0.866; // equilateral ratio

    // Triangle vertices (pointing right)
    const x1 = cx - triWidth * 0.35;
    const y1 = cy - triHeight / 2;
    const x2 = cx - triWidth * 0.35;
    const y2 = cy + triHeight / 2;
    const x3 = cx + triWidth * 0.65;
    const y3 = cy;

    // Barycentric test
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
          pixels[idx] = INDIGO_400; // Play button accent
        } else {
          pixels[idx] = INDIGO_950; // Dark background inside frame
        }
      } else {
        pixels[idx] = TRANSPARENT;
      }
    }
  }

  // Draw the frame border (2-3px depending on size)
  const borderWidth = Math.max(1, Math.floor(size * 0.06));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      if (pixels[idx] === TRANSPARENT) continue;

      // Check if this pixel is near the edge of the rounded rect
      let nearEdge = false;
      for (let dy = -borderWidth; dy <= borderWidth; dy++) {
        for (let dx = -borderWidth; dx <= borderWidth; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= size || ny < 0 || ny >= size) {
            nearEdge = true;
            break;
          }
          const nIdx = ny * size + nx;
          if (pixels[nIdx] === TRANSPARENT) {
            nearEdge = true;
            break;
          }
        }
        if (nearEdge) break;
      }

      if (nearEdge && !inPlayTriangle(x, y)) {
        pixels[idx] = INDIGO_500; // Indigo frame border
      }
    }
  }

  return pixels;
}

// Write BITMAPINFOHEADER + pixel data for one ICO entry
function createBitmapData(size, pixels) {
  const bpp = 32;
  const pixelDataSize = size * size * 4;
  const maskRowBytes = Math.ceil(size / 8);
  const maskRowPadded = (maskRowBytes + 3) & ~3; // Pad to 4-byte boundary
  const maskSize = maskRowPadded * size;
  const bmpHeaderSize = 40;
  const totalSize = bmpHeaderSize + pixelDataSize + maskSize;

  const buf = Buffer.alloc(totalSize);
  let offset = 0;

  // BITMAPINFOHEADER
  buf.writeUInt32LE(bmpHeaderSize, offset); offset += 4;
  buf.writeInt32LE(size, offset); offset += 4;
  buf.writeInt32LE(size * 2, offset); offset += 4; // Height doubled for ICO (includes mask)
  buf.writeUInt16LE(1, offset); offset += 2;        // Planes
  buf.writeUInt16LE(bpp, offset); offset += 2;
  buf.writeUInt32LE(0, offset); offset += 4;         // Compression
  buf.writeUInt32LE(pixelDataSize + maskSize, offset); offset += 4;
  buf.writeInt32LE(0, offset); offset += 4;           // X ppm
  buf.writeInt32LE(0, offset); offset += 4;           // Y ppm
  buf.writeUInt32LE(0, offset); offset += 4;          // Colors used
  buf.writeUInt32LE(0, offset); offset += 4;          // Important colors

  // Pixel data: BGRA, bottom-up
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      const px = pixels[y * size + x];
      buf.writeUInt8(px.b, offset); offset += 1;
      buf.writeUInt8(px.g, offset); offset += 1;
      buf.writeUInt8(px.r, offset); offset += 1;
      buf.writeUInt8(px.a, offset); offset += 1;
    }
  }

  // AND mask (1-bit transparency mask), bottom-up
  for (let y = size - 1; y >= 0; y--) {
    let maskByte = 0;
    let bitCount = 0;
    for (let x = 0; x < size; x++) {
      const px = pixels[y * size + x];
      // AND mask: 1 = transparent, 0 = opaque
      const transparent = px.a === 0 ? 1 : 0;
      maskByte = (maskByte << 1) | transparent;
      bitCount++;
      if (bitCount === 8) {
        buf.writeUInt8(maskByte, offset); offset += 1;
        maskByte = 0;
        bitCount = 0;
      }
    }
    // Flush remaining bits in the last byte of this row
    if (bitCount > 0) {
      maskByte <<= (8 - bitCount);
      buf.writeUInt8(maskByte, offset); offset += 1;
    }
    // Pad row to 4-byte boundary
    const written = Math.ceil(size / 8);
    for (let p = written; p < maskRowPadded; p++) {
      buf.writeUInt8(0, offset); offset += 1;
    }
  }

  return buf;
}

// Build ICO file from multiple sizes
function buildIco(sizes) {
  const images = sizes.map((size) => {
    const pixels = generatePixels(size);
    return { size, data: createBitmapData(size, pixels) };
  });

  const imageCount = images.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * imageCount;
  let dataOffset = headerSize + dirSize;

  // Calculate total buffer size
  let totalSize = headerSize + dirSize;
  for (const img of images) {
    totalSize += img.data.length;
  }

  const ico = Buffer.alloc(totalSize);
  let offset = 0;

  // ICO header
  ico.writeUInt16LE(0, offset); offset += 2;          // Reserved
  ico.writeUInt16LE(1, offset); offset += 2;          // Type: ICO
  ico.writeUInt16LE(imageCount, offset); offset += 2; // Image count

  // Directory entries
  for (const img of images) {
    ico.writeUInt8(img.size < 256 ? img.size : 0, offset); offset += 1; // Width (0 = 256)
    ico.writeUInt8(img.size < 256 ? img.size : 0, offset); offset += 1; // Height (0 = 256)
    ico.writeUInt8(0, offset); offset += 1;                               // Palette
    ico.writeUInt8(0, offset); offset += 1;                               // Reserved
    ico.writeUInt16LE(1, offset); offset += 2;                            // Color planes
    ico.writeUInt16LE(32, offset); offset += 2;                           // BPP
    ico.writeUInt32LE(img.data.length, offset); offset += 4;             // Data size
    ico.writeUInt32LE(dataOffset, offset); offset += 4;                   // Data offset
    dataOffset += img.data.length;
  }

  // Image data
  for (const img of images) {
    img.data.copy(ico, offset);
    offset += img.data.length;
  }

  return ico;
}

// Generate and write
const sizes = [16, 32, 48, 256];
const ico = buildIco(sizes);
const outPath = path.join(__dirname, 'icon.ico');
fs.writeFileSync(outPath, ico);
console.log(`Generated brand icon.ico (${sizes.join(', ')}px) at ${outPath}`);
console.log(`File size: ${ico.length} bytes, ${sizes.length} images`);
