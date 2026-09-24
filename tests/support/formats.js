import crypto from "node:crypto";
import zlib from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// PNG chunks in file order. Each CRC is checked against Node's own CRC-32, independent of the app's.
export function pngChunks(bytes) {
  const buf = Buffer.from(bytes);
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("not a PNG");
  const chunks = [];
  for (let i = 8; i < buf.length;) {
    const length = buf.readUInt32BE(i);
    const type = buf.toString("latin1", i + 4, i + 8);
    const crcOk = zlib.crc32(buf.subarray(i + 4, i + 8 + length)) === buf.readUInt32BE(i + 8 + length);
    chunks.push({ type, data: buf.subarray(i + 8, i + 8 + length), crcOk });
    i += 12 + length;
  }
  return chunks;
}

// Pixel size from a JPEG's start-of-frame marker.
export function jpegSize(bytes) {
  const buf = Buffer.from(bytes);
  for (let i = 2; i < buf.length;) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error("no start-of-frame marker");
}

export const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
