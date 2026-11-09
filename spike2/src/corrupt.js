// Databend modes (PRD F-030): seeded, byte-level corruption of the *encoded* file.
// Every mode is pure: (originalBytes, amount, seed) -> newBytes. The original is never
// mutated (AC-F030-03), and the same seed reproduces byte-identical output (AC-F030-02).

import { makeRng } from "./prng.js";
import { crc32, adler32, writeU32BE, readU32BE, readU32LE } from "./crc.js";

// ---------------------------------------------------------------- JPEG --------

// Walk the JPEG marker stream; return [entropyStart, entropyEnd) — the scan data
// between the SOS header and the final EOI. Byte swaps here are the classic
// mattdennewitz corrupt.py payload bend (PRD §11 reference technique).
export function findJpegEntropyRange(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("jpeg: no SOI");
  let pos = 2;
  while (pos < bytes.length - 1) {
    if (bytes[pos] !== 0xff) {
      pos++;
      continue;
    }
    const marker = bytes[pos + 1];
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      pos += 2; // stuffed byte / standalone marker
      continue;
    }
    const segLen = (bytes[pos + 2] << 8) | bytes[pos + 3];
    if (marker === 0xda) {
      // SOS: segment ends after its header; entropy-coded data follows to EOI
      const entropyStart = pos + 2 + segLen;
      let end = bytes.length - 2;
      while (end > entropyStart && !(bytes[end] === 0xff && bytes[end + 1] === 0xd9)) end--;
      if (end <= entropyStart) throw new Error("jpeg: EOI not found");
      return [entropyStart, end];
    }
    pos += 2 + segLen;
  }
  throw new Error("jpeg: SOS not found");
}

// Mode: jpeg-swap — `amount` seeded byte swaps inside the entropy-coded payload.
export function jpegSwap(bytes, amount, seed) {
  const rng = makeRng(seed);
  const out = bytes.slice();
  const [lo, hi] = findJpegEntropyRange(out);
  for (let i = 0; i < amount; i++) {
    const a = rng.int(lo, hi - 1);
    let b = rng.int(lo, hi - 1);
    if (a === b) b = (b + 1) % hi;
    const tmp = out[a];
    out[a] = out[b];
    out[b] = tmp;
  }
  return out;
}

// ---------------------------------------------------------------- PNG ---------

export function parsePngChunks(bytes) {
  if (
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  )
    throw new Error("png: bad signature");
  const chunks = [];
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const len = readU32BE(bytes, pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    chunks.push({ type, dataStart: pos + 8, dataEnd: pos + 8 + len, crcOffset: pos + 8 + len });
    pos += 12 + len;
    if (type === "IEND") break;
  }
  if (pos !== bytes.length) throw new Error("png: trailing bytes after IEND");
  return chunks;
}

// Rewrite the stored CRC of every listed chunk from its type+data.
function repairChunkCrcs(out, chunks) {
  for (const c of chunks) {
    const crc = crc32(out, c.dataStart - 4, c.dataEnd); // CRC covers type + data
    writeU32BE(out, c.crcOffset, crc);
  }
}

// Pick `flips` distinct positions within the concatenated IDAT data (never inside
// the final 4 bytes of the zlib stream — that is the Adler32 trailer; flipping it
// and re-deriving it would be a no-op corruption).
function pickIdatFlipPositions(idatChunks, flips, rng) {
  const total = idatChunks.reduce((n, c) => n + c.dataEnd - c.dataStart, 0);
  if (total < 8) throw new Error("png: IDAT too small");
  const usable = total - 4;
  const positions = new Set();
  let guard = 0;
  while (positions.size < flips && guard++ < 1000) {
    positions.add(rng.int(0, usable - 1));
  }
  // Map a flat offset into (chunk, offset) pairs.
  return [...positions].map((flat) => {
    let rest = flat;
    for (const c of idatChunks) {
      const n = c.dataEnd - c.dataStart;
      if (rest < n) return c.dataStart + rest;
      rest -= n;
    }
    throw new Error("png: flip position out of range");
  });
}

// Mode: png-idat-raw — flip bytes in IDAT, no repair. Decoders with CRC checking
// reject the file outright.
export function pngIdatRaw(bytes, flips, seed) {
  const rng = makeRng(seed);
  const out = bytes.slice();
  const idat = parsePngChunks(out).filter((c) => c.type === "IDAT");
  if (idat.length === 0) throw new Error("png: no IDAT");
  for (const p of pickIdatFlipPositions(idat, flips, rng)) out[p] ^= 0xff;
  return out;
}

// Mode: png-idat-crc — flip bytes in IDAT, recompute the chunk CRC32.
// This is exactly the PRD F-030 claim ("PNG IDAT corruption with CRC32 repair so
// decoders still accept the file"). S2 measures whether CRC repair alone is enough.
export function pngIdatCrc(bytes, flips, seed) {
  const rng = makeRng(seed);
  const out = bytes.slice();
  const chunks = parsePngChunks(out);
  const idat = chunks.filter((c) => c.type === "IDAT");
  if (idat.length === 0) throw new Error("png: no IDAT");
  for (const p of pickIdatFlipPositions(idat, flips, rng)) out[p] ^= 0xff;
  repairChunkCrcs(out, idat);
  return out;
}

// Mode: png-idat-zlib — flip bytes in IDAT, recompute CRC32 AND patch the zlib
// Adler32 trailer to match whatever the (desynchronized) deflate stream still
// inflates to. If the flip breaks inflate, this throws -> the retry loop re-rolls.
// Discovering whether this repair is *also* required is a core S2 question.
export async function pngIdatZlib(bytes, flips, seed) {
  const rng = makeRng(seed);
  const out = bytes.slice();
  const chunks = parsePngChunks(out);
  const idat = chunks.filter((c) => c.type === "IDAT");
  if (idat.length === 0) throw new Error("png: no IDAT");
  const positions = pickIdatFlipPositions(idat, flips, rng);
  for (const p of positions) out[p] ^= 0xff;

  const zlibLen = idat.reduce((n, c) => n + (c.dataEnd - c.dataStart), 0);
  const zlib = new Uint8Array(zlibLen);
  let z = 0;
  for (const c of idat) {
    zlib.set(out.subarray(c.dataStart, c.dataEnd), z);
    z += c.dataEnd - c.dataStart;
  }
  const ds = new DecompressionStream("deflate");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  // Swallow the reader-side rejection on corrupt input; the writer.await below is the
  // authoritative error path. Prevents unhandled-rejection noise in the console.
  const inflatedPromise = (async () => {
    try {
      const parts = [];
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        parts.push(value);
      }
      const total = parts.reduce((n, p) => n + p.length, 0);
      const all = new Uint8Array(total);
      let o = 0;
      for (const p of parts) {
        all.set(p, o);
        o += p.length;
      }
      return all;
    } catch {
      return null;
    }
  })();
  await writer.write(zlib); // throws if the flip broke the deflate stream
  await writer.close();
  const inflated = await inflatedPromise; // null => inflate failed mid-stream
  if (inflated === null) throw new Error("png: inflate failed after flip");

  const patched = adler32(inflated);
  writeU32BE(out, idat[idat.length - 1].dataEnd - 4, patched);
  repairChunkCrcs(out, idat);
  return out;
}

// ------------------------------------------------------- BMP / TGA (WordPad) --

// Mode: bmp-insert — the "WordPad effect": insert `amount` bytes at a random offset
// inside the pixel-data region, shifting everything after. Dimensions stay intact;
// decoders famously tolerate this.
export function bmpInsert(bytes, amount, seed) {
  const rng = makeRng(seed);
  const out = bytes.slice();
  const pixelOffset = readU32LE(out, 10);
  const insertAt = rng.int(pixelOffset, out.length);
  const junk = new Uint8Array(amount);
  for (let i = 0; i < amount; i++) junk[i] = rng.int(0, 255);
  const merged = new Uint8Array(out.length + amount);
  merged.set(out.subarray(0, insertAt), 0);
  merged.set(junk, insertAt);
  merged.set(out.subarray(insertAt), insertAt + amount);
  return merged;
}

// Mode: tga-insert — same WordPad insertion, decoded by the bundled strict decoder.
export function tgaInsert(bytes, amount, seed) {
  const rng = makeRng(seed);
  const out = bytes.slice();
  const idLen = out[0];
  const pixelStart = 18 + idLen;
  const insertAt = rng.int(pixelStart, out.length);
  const junk = new Uint8Array(amount);
  for (let i = 0; i < amount; i++) junk[i] = rng.int(0, 255);
  const merged = new Uint8Array(out.length + amount);
  merged.set(out.subarray(0, insertAt), 0);
  merged.set(junk, insertAt);
  merged.set(out.subarray(insertAt), insertAt + amount);
  return merged;
}

// ---------------------------------------------------------------- modes -------

export const MODES = {
  "jpeg-swap": {
    format: "jpeg",
    amounts: [2, 5, 10, 20],
    label: "JPEG payload byte swaps (entropy-coded region)",
    run: (bytes, amount, seed) => Promise.resolve(jpegSwap(bytes, amount, seed)),
  },
  "png-idat-raw": {
    format: "png",
    amounts: [1, 2, 4, 8],
    label: "PNG IDAT byte flips, no repair",
    run: (bytes, amount, seed) => Promise.resolve(pngIdatRaw(bytes, amount, seed)),
  },
  "png-idat-crc": {
    format: "png",
    amounts: [1, 2, 4, 8],
    label: "PNG IDAT byte flips + CRC32 repair (PRD F-030 claim)",
    run: (bytes, amount, seed) => Promise.resolve(pngIdatCrc(bytes, amount, seed)),
  },
  "png-idat-zlib": {
    format: "png",
    amounts: [1, 2, 4],
    label: "PNG IDAT byte flips + CRC32 + Adler32 repair",
    run: (bytes, amount, seed) => pngIdatZlib(bytes, amount, seed),
  },
  "bmp-insert": {
    format: "bmp",
    amounts: [1, 2, 4, 8],
    label: "BMP WordPad insertion (pixel-data region)",
    run: (bytes, amount, seed) => Promise.resolve(bmpInsert(bytes, amount, seed)),
  },
  "tga-insert": {
    format: "tga",
    amounts: [1, 2, 4, 8],
    label: "TGA WordPad insertion (pixel-data region)",
    run: (bytes, amount, seed) => Promise.resolve(tgaInsert(bytes, amount, seed)),
  },
};
