// Test helper: re-packs one of Arbor's zips (stored entries) with deflate compression,
// the way Word and PowerPoint write their files, so the importers' unzip path is exercised.
const zlib = require('zlib');

module.exports = function deflateZip(stored) {
  const b = Buffer.from(stored), entries = [];
  for (let i = 0; i + 4 <= b.length; i++) {
    if (b.readUInt32LE(i) !== 0x04034b50) continue;
    const size = b.readUInt32LE(i + 18), nl = b.readUInt16LE(i + 26), el = b.readUInt16LE(i + 28);
    const name = b.subarray(i + 30, i + 30 + nl), data = b.subarray(i + 30 + nl + el, i + 30 + nl + el + size);
    entries.push({ name, data, crc: b.readUInt32LE(i + 14) });
    i += 29 + nl + el + size;
  }
  const parts = [], central = []; let offset = 0;
  for (const e of entries) {
    const comp = zlib.deflateRawSync(e.data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(e.crc, 14); head.writeUInt32LE(comp.length, 18); head.writeUInt32LE(e.data.length, 22); head.writeUInt16LE(e.name.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(e.crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(e.data.length, 24); cd.writeUInt16LE(e.name.length, 28); cd.writeUInt32LE(offset, 42);
    parts.push(head, e.name, comp); central.push(cd, e.name);
    offset += 30 + e.name.length + comp.length;
  }
  const cdBuf = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
};
