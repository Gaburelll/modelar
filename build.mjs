// Desenha o ícone PNG (192x192) sem dependências externas: docs/icon-192.png
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function inRoundRect(px, py, size, r) {
  const x = Math.min(Math.max(px, r), size - r);
  const y = Math.min(Math.max(py, r), size - r);
  const dx = px - x, dy = py - y;
  return dx * dx + dy * dy <= r * r;
}
function inTriangle(x, y) {
  const ax = 0.38, ay = 0.28, bx = 0.38, by = 0.72, cx = 0.74, cy = 0.5;
  const s1 = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  const s2 = (cx - bx) * (y - by) - (cy - by) * (x - bx);
  const s3 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}
function makeIcon(size) {
  const S = 3;
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  const r = size * 0.22;
  const c1 = [139, 92, 246], c2 = [236, 72, 153];
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      let cover = 0, tri = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S, py = y + (sy + 0.5) / S;
          if (inRoundRect(px, py, size, r)) { cover++; if (inTriangle(px / size, py / size)) tri++; }
        }
      }
      const a = cover / (S * S), t = cover ? tri / cover : 0;
      const g = (x + y) / (2 * size);
      const o = y * stride + 1 + x * 4;
      for (let i = 0; i < 3; i++) {
        const base = c1[i] + (c2[i] - c1[i]) * g;
        raw[o + i] = Math.round(base * (1 - t) + 255 * t);
      }
      raw[o + 3] = Math.round(255 * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const png = makeIcon(192);
writeFileSync(join(root, "docs", "icon-192.png"), png);
console.log(`docs/icon-192.png gerado (${png.length} bytes)`);
