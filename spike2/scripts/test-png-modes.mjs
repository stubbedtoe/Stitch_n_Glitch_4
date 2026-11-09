// Node-side unit check of the PNG corruption modes against STRICT zlib (inflateSync).
// Answers: which single-byte IDAT flips keep a zlib stream fully inflatable, and do the
// CRC/Adler32-repaired files then decode strictly? Also sanity-checks the harness math
// that the browsers demonstrated (Chrome accepting adler-broken files must be leniency,
// not validity).

import { deflateSync, inflateSync } from "node:zlib";
import { pngIdatRaw, pngIdatCrc, pngIdatZlib, parsePngChunks } from "../src/corrupt.js";
import { crc32, adler32 } from "../src/crc.js";

// Minimal real PNG: 16x16 RGB, one IDAT, no interlace, filter 0 rows.
function makePng(w, h) {
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * (1 + w * 3) + 1 + x * 3;
      raw[o] = (x * 16) & 0xff;
      raw[o + 1] = (y * 16) & 0xff;
      raw[o + 2] = 128;
    }
  }
  const idat = deflateSync(raw, { level: 6 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type truecolor
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
    return out;
  };
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const png = makePng(16, 16);
const idat = parsePngChunks(png).find((c) => c.type === "IDAT");
const idatLen = idat.dataEnd - idat.dataStart;
console.log(`test PNG: ${png.length} bytes, IDAT data ${idatLen} bytes`);

// Strict reference: inflate the original
const origZlib = png.subarray(idat.dataStart, idat.dataEnd);
console.log("baseline strict inflate:", Buffer.compare(inflateSync(origZlib), inflateSync(origZlib)) === 0 ? "ok" : "FAIL");

// For EVERY usable flip position: flip, strict-inflate. Classify.
let survives = 0;
const surviving = [];
for (let p = idat.dataStart; p < idat.dataEnd - 4; p++) {
  const mutated = Buffer.from(origZlib);
  mutated[p - idat.dataStart] ^= 0xff;
  try {
    inflateSync(mutated);
    survives++;
    surviving.push(p - idat.dataStart);
  } catch {}
}
console.log(`strict-inflate-surviving single flips: ${survives}/${idatLen - 4} positions`);
if (surviving.length) console.log("surviving offsets:", surviving.join(","));

// CRC-only repair under strict zlib: should be 0% (adler mismatch or inflate error)
let crcOk = 0;
for (let seed = 0; seed < 50; seed++) {
  const f = pngIdatCrc(png, 1, seed);
  const c = parsePngChunks(f).find((x) => x.type === "IDAT");
  try {
    inflateSync(f.subarray(c.dataStart, c.dataEnd));
    crcOk++;
  } catch {}
}
console.log(`pngIdatCrc strict-decode rate: ${crcOk}/50`);

// Full zlib repair under strict zlib: patched adler should make every surviving flip decode
let zlibOk = 0, zlibInflateSurvived = 0;
for (let seed = 0; seed < 50; seed++) {
  try {
    const f = await pngIdatZlib(png, 1, seed);
    zlibInflateSurvived++;
    const c = parsePngChunks(f).find((x) => x.type === "IDAT");
    inflateSync(f.subarray(c.dataStart, c.dataEnd));
    zlibOk++;
  } catch {}
}
console.log(`pngIdatZlib: inflate survived ${zlibInflateSurvived}/50, strict-decode ${zlibOk}/50`);

// Determinism: same seed -> identical bytes
const a = pngIdatCrc(png, 2, 7);
const b = pngIdatCrc(png, 2, 7);
console.log("determinism:", Buffer.compare(a, b) === 0 ? "ok" : "FAIL");

// CRC repair correctness: recompute and compare
const fixed = pngIdatCrc(png, 1, 3);
const fc = parsePngChunks(fixed).find((x) => x.type === "IDAT");
const recomputed = crc32(fixed, fc.dataStart - 4, fc.dataEnd);
console.log("crc repair correct:", recomputed === fixed.readUInt32BE(fc.crcOffset) ? "ok" : "FAIL");
