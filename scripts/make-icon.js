// Draws the app icon (assets/icon.png, 256x256): a rounded tile with outline bars.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 256;
const px = Buffer.alloc(S * S * 4);
const inRound = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.max(x0 + r, Math.min(x, x1 - r)), cy = Math.max(y0 + r, Math.min(y, y1 - r));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= x0 && x <= x1 && y >= y0 && y <= y1;
};
// [x0, y0, x1, y1] bars of an outline: a heading and indented rows
const bars = [[52, 62, 204, 86], [84, 106, 204, 126], [84, 144, 186, 164], [116, 182, 204, 202]];
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let rgba = [0, 0, 0, 0];
    // 4x supersampling for smooth edges
    let tile = 0, bar = 0;
    for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const fx = x + dx, fy = y + dy;
      if (inRound(fx, fy, 8, 8, 248, 248, 52)) tile++;
      if (bars.some(b => inRound(fx, fy, b[0], b[1], b[2], b[3], 10))) bar++;
    }
    if (tile) {
      const t = y / S; // green to teal gradient
      const base = [Math.round(47 + 10 * t), Math.round(125 - 20 * t), Math.round(98 + 40 * t)];
      const a = bar / 4;
      rgba = [...base.map(c => Math.round(c * (1 - a) + 255 * a)), Math.round(255 * tile / 4)];
    }
    px.set(rgba, (y * S + x) * 4);
  }
}
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon.png'), png);
console.log('assets/icon.png written');
