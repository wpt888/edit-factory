// Generates a minimal 16x16 ICO file as placeholder.
// Replace with real branding icon before release (Phase 52).
const fs = require('fs');
const path = require('path');

// Minimal 16x16 32-bit RGBA ICO: dark blue square (#1a1a2e)
// ICO header (6 bytes) + directory entry (16 bytes) + BMP header (40 bytes) + pixel data (16*16*4 = 1024 bytes)
const width = 16;
const height = 16;
const bpp = 32;
const pixelDataSize = width * height * (bpp / 8);
const bmpHeaderSize = 40;
const imageSize = bmpHeaderSize + pixelDataSize;

const buf = Buffer.alloc(6 + 16 + imageSize);
let offset = 0;

// ICO header
buf.writeUInt16LE(0, offset); offset += 2; // reserved
buf.writeUInt16LE(1, offset); offset += 2; // type: 1 = ICO
buf.writeUInt16LE(1, offset); offset += 2; // count: 1 image

// Directory entry
buf.writeUInt8(width, offset); offset += 1;
buf.writeUInt8(height, offset); offset += 1;
buf.writeUInt8(0, offset); offset += 1; // palette
buf.writeUInt8(0, offset); offset += 1; // reserved
buf.writeUInt16LE(1, offset); offset += 2; // color planes
buf.writeUInt16LE(bpp, offset); offset += 2; // bits per pixel
buf.writeUInt32LE(imageSize, offset); offset += 4; // image size
buf.writeUInt32LE(6 + 16, offset); offset += 4; // image offset

// BMP info header
buf.writeUInt32LE(bmpHeaderSize, offset); offset += 4;
buf.writeInt32LE(width, offset); offset += 4;
buf.writeInt32LE(height * 2, offset); offset += 4; // height doubled for ICO
buf.writeUInt16LE(1, offset); offset += 2; // planes
buf.writeUInt16LE(bpp, offset); offset += 2;
buf.writeUInt32LE(0, offset); offset += 4; // compression
buf.writeUInt32LE(pixelDataSize, offset); offset += 4;
buf.writeInt32LE(0, offset); offset += 4; // x ppm
buf.writeInt32LE(0, offset); offset += 4; // y ppm
buf.writeUInt32LE(0, offset); offset += 4; // colors used
buf.writeUInt32LE(0, offset); offset += 4; // important colors

// Pixel data: BGRA, bottom-up, dark blue #1a1a2e
for (let i = 0; i < width * height; i++) {
  buf.writeUInt8(0x2e, offset); offset += 1; // B
  buf.writeUInt8(0x1a, offset); offset += 1; // G
  buf.writeUInt8(0x1a, offset); offset += 1; // R
  buf.writeUInt8(0xff, offset); offset += 1; // A
}

fs.writeFileSync(path.join(__dirname, 'icon.ico'), buf);
console.log('Generated placeholder icon.ico');
