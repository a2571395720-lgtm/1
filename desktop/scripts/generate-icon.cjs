// Generate the native Windows app icon from our simple geometric J mark.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const size = 256;
const raw = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const radius = 52;
  const dx = Math.max(radius - x, x - (size - radius - 1), 0);
  const dy = Math.max(radius - y, y - (size - radius - 1), 0);
  const inside = dx * dx + dy * dy <= radius * radius;
  const color = [26, 62, 48, inside ? 255 : 0];
  const top = x >= 90 && x <= 170 && y >= 65 && y <= 91;
  const stem = x >= 141 && x <= 169 && y >= 89 && y <= 164;
  const bowl = ((x - 119) ** 2 + (y - 158) ** 2 <= 51 ** 2) && ((x - 119) ** 2 + (y - 158) ** 2 >= 24 ** 2) && y >= 154;
  const left = x >= 68 && x <= 96 && y >= 144 && y <= 160;
  if (top || stem || bowl || left) color.splice(0, 3, 224, 243, 164);
  if ((x - 197) ** 2 + (y - 55) ** 2 < 13 ** 2) color.splice(0, 3, 224, 243, 164);
  const index = y * (size * 4 + 1) + 1 + x * 4;
  raw.set(color, index);
}
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, contents) {
  const name = Buffer.from(type); const payload = Buffer.concat([name, contents]);
  const length = Buffer.alloc(4); length.writeUInt32BE(contents.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(payload));
  return Buffer.concat([length, payload, checksum]);
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
const icoHeader = Buffer.alloc(22); icoHeader.writeUInt16LE(1, 2); icoHeader.writeUInt16LE(1, 4); icoHeader.writeUInt16LE(1, 10); icoHeader.writeUInt16LE(32, 12); icoHeader.writeUInt32LE(png.length, 14); icoHeader.writeUInt32LE(22, 18);
const assets = path.join(__dirname, '../assets'); fs.mkdirSync(assets, { recursive: true });
fs.writeFileSync(path.join(assets, 'icon.png'), png);
fs.writeFileSync(path.join(assets, 'icon.ico'), Buffer.concat([icoHeader, png]));
