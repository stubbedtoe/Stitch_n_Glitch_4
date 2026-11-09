// Test corpus: deterministic procedural images encoded as JPEG (canvas), PNG (canvas),
// 24-bit BMP and uncompressed TGA (hand-encoded — no dependencies).
// Databending corrupts *encoded* bytes, so the corpus must be real encoded files.

import { makeRng } from "./prng.js";
import { writeU32LE, writeU16LE, readU16LE, readU32LE } from "./crc.js";

const CORPUS_W = 192;
const CORPUS_H = 128;

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Deterministic "photo-like" source: gradient bands + blobs + seeded noise.
function drawProcedural(ctx, w, h) {
  const rng = makeRng(0x5eed);
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#3a6ea5");
  grad.addColorStop(0.5, "#c94f7c");
  grad.addColorStop(1, "#f0e68c");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 24; i++) {
    ctx.fillStyle = `hsla(${Math.floor(rng.next() * 360)}, 70%, 55%, 0.55)`;
    ctx.beginPath();
    ctx.arc(rng.next() * w, rng.next() * h, 6 + rng.next() * 26, 0, Math.PI * 2);
    ctx.fill();
  }
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.next() - 0.5) * 22;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

// --- BMP: 24-bit uncompressed, bottom-up (BI_RGB) ---
export function encodeBmp(imageData) {
  const { width: w, height: h, data } = imageData;
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const pixelBytes = rowSize * h;
  const out = new Uint8Array(54 + pixelBytes);
  out[0] = 0x42; // 'B'
  out[1] = 0x4d; // 'M'
  writeU32LE(out, 2, out.length);
  writeU32LE(out, 10, 54); // pixel data offset
  writeU32LE(out, 14, 40); // BITMAPINFOHEADER
  writeU32LE(out, 18, w);
  writeU32LE(out, 22, h); // positive = bottom-up
  writeU16LE(out, 26, 1); // planes
  writeU16LE(out, 28, 24); // bpp
  writeU32LE(out, 30, 0); // BI_RGB
  writeU32LE(out, 34, pixelBytes);
  let p = 54;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      out[p++] = data[s + 2]; // B
      out[p++] = data[s + 1]; // G
      out[p++] = data[s]; // R
    }
    p += rowSize - w * 3; // pad to 4-byte boundary
  }
  return out;
}

// --- TGA: type 2 uncompressed true-color, 24bpp, bottom-left origin ---
export function encodeTga(imageData) {
  const { width: w, height: h, data } = imageData;
  const out = new Uint8Array(18 + w * h * 3);
  out[2] = 2; // imageType: uncompressed true-color
  writeU16LE(out, 12, w);
  writeU16LE(out, 14, h);
  out[16] = 24; // pixel depth
  out[17] = 0; // descriptor: bottom-left origin
  let p = 18;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      out[p++] = data[s + 2];
      out[p++] = data[s + 1];
      out[p++] = data[s];
    }
  }
  return out;
}

// Strict, bounds-checked TGA decoder — stands in for the bundled production decoder
// (browsers cannot decode TGA natively; F-030 ships one). Throws on ANY inconsistency:
// header fields, pixel-data bounds. Tolerates nothing.
export function decodeTgaStrict(bytes) {
  if (bytes.length < 18) throw new Error("tga: too short for header");
  const idLen = bytes[0];
  const cmapType = bytes[1];
  const imgType = bytes[2];
  if (cmapType !== 0) throw new Error("tga: color-mapped images unsupported");
  if (imgType !== 2) throw new Error(`tga: unsupported image type ${imgType}`);
  const w = readU16LE(bytes, 12);
  const h = readU16LE(bytes, 14);
  const depth = bytes[16];
  if (w === 0 || h === 0) throw new Error("tga: zero dimension");
  if (depth !== 24 && depth !== 32) throw new Error(`tga: unsupported depth ${depth}`);
  const pixelBytes = w * h * (depth / 8);
  const start = 18 + idLen;
  if (start + pixelBytes > bytes.length) throw new Error("tga: pixel data truncated");
  return { width: w, height: h, depth };
}

// --- Corpus builder (browser only: needs canvas) ---
export function buildCorpus() {
  const canvas = document.createElement("canvas");
  canvas.width = CORPUS_W;
  canvas.height = CORPUS_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  drawProcedural(ctx, CORPUS_W, CORPUS_H);
  const imageData = ctx.getImageData(0, 0, CORPUS_W, CORPUS_H);

  const jpeg = base64ToBytes(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
  const png = base64ToBytes(canvas.toDataURL("image/png").split(",")[1]);
  const bmp = encodeBmp(imageData);
  const tga = encodeTga(imageData);

  return {
    width: CORPUS_W,
    height: CORPUS_H,
    files: {
      jpeg: { bytes: jpeg, mime: "image/jpeg" },
      png: { bytes: png, mime: "image/png" },
      bmp: { bytes: bmp, mime: "image/bmp" },
      tga: { bytes: tga, mime: "image/x-tga" }, // decoded via bundled JS decoder
    },
  };
}
