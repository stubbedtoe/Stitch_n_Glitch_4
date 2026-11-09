/**
 * Deterministic synthetic 12 MP "photo-like" source image.
 *
 * A procedural plasma (layered sinusoids with per-channel phase offsets) plus
 * mild noise gives a smooth, colorful image with broad color coverage —
 * exercising the quantizer realistically without committing a multi-MB binary
 * to the repo. Generation is deterministic (seeded PRNG + fixed formulas) so
 * benchmark runs are reproducible.
 */

export const SRC_W = 4000
export const SRC_H = 3000
export const SRC_PIXELS = SRC_W * SRC_H // 12,000,000 px = 12 MP

/** mulberry32 — small deterministic PRNG */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const LUT_SIZE = 2048
const SIN_LUT = new Float32Array(LUT_SIZE)
for (let i = 0; i < LUT_SIZE; i++) {
  SIN_LUT[i] = Math.sin((i / LUT_SIZE) * Math.PI * 2)
}

/** Fast periodic sine via lookup table. `arg` in table units (period = 2048). */
function fastSin(arg: number): number {
  return SIN_LUT[arg & (LUT_SIZE - 1)]
}

/**
 * Generate the packed RGB888 source (R<<16 | G<<8 | B per pixel, row-major).
 * ~2.5 s on a desktop core; called once per benchmark session, never per run.
 */
export function generateSource(w = SRC_W, h = SRC_H, seed = 0x5eed): Uint32Array {
  const rand = mulberry32(seed)
  const noiseAmp = 10
  // Per-channel plasma term frequencies (in LUT units per pixel) + phase offsets
  const f = [
    [0.9, 0.13, 0.05, 0.31],
    [0.7, 0.21, 0.11, 0.17],
    [1.1, 0.07, 0.23, 0.41],
  ]
  const ph = [
    [0, 512, 256, 1024],
    [300, 900, 128, 640],
    [700, 150, 896, 448],
  ]
  const out = new Uint32Array(w * h)
  let i = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      let r = 0
      let g = 0
      let b = 0
      for (let k = 0; k < 4; k++) {
        const s0 = fastSin(x * f[0][k] + y * f[1][k] + ph[0][k])
        const s1 = fastSin(x * f[2][k] - y * f[0][k] + ph[1][k])
        r += s0 * 70 + s1 * 45
        g += fastSin(x * f[1][k] + y * f[2][k] + ph[1][k]) * 70 + s0 * 45
        b += fastSin(x * f[2][k] + y * f[1][k] + ph[2][k]) * 70 + s1 * 45
      }
      const n = (rand() - 0.5) * 2 * noiseAmp
      r = 128 + r / 4 + n
      g = 128 + g / 4 + n
      b = 128 + b / 4 + n
      out[i] =
        ((r < 0 ? 0 : r > 255 ? 255 : r) << 16) |
        ((g < 0 ? 0 : g > 255 ? 255 : g) << 8) |
        (b < 0 ? 0 : b > 255 ? 255 : b)
    }
  }
  return out
}
