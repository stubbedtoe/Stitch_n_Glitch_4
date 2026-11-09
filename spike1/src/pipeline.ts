/**
 * Conversion pipeline — the NFR-P1 hot path, mirroring the PRD critical path:
 *   F-003 import/decode -> F-041 resize (filtered sampling) -> F-005 CIEDE2000
 *   thread-matched quantization (+ optional F-006 Floyd–Steinberg dithering).
 *
 * Built on thi.ng umbrella packages (@thi.ng/pixel for typed-array buffers and
 * filtered resizing, @thi.ng/pixel-dither for the Floyd–Steinberg kernel) with
 * the Lab conversion + CIEDE2000 inner loop specialized per the spike finding
 * documented in src/lab.ts (thi.ng's general-purpose distCIEDE2000 does a
 * whitepoint conversion per call and misses NFR-P1; the inline version is
 * formula-identical, verified to 1.4e-14).
 *
 * Pure functions over typed arrays — runnable in a Web Worker, in Node, or
 * on the main thread.
 */
import { intBuffer, type IntBuffer, RGB888 } from '@thi.ng/pixel'
import { FLOYD_STEINBERG } from '@thi.ng/pixel-dither/floyd-steinberg'
import { paletteSubset, type Rgb } from './palette.ts'
import { srgbToLab, srgbToLabBulk, dE00 } from './lab.ts'
import { SRC_W, SRC_H } from './image-gen.ts'

export const DST_W = 300
export const DST_H = 300

export type SamplerName = 'linear' | 'cubic'

export interface StageTimings {
  /** simulated decode: wrap a copy of the encoded source as a pixel buffer */
  decode: number
  /** F-041: filtered downscale 4000x3000 -> 300x300 */
  resize: number
  /** F-005: CIEDE2000 nearest-thread quantization */
  quantize: number
  /** F-006: Floyd–Steinberg error diffusion to palette (0 when disabled) */
  dither: number
}

// --- palette Lab cache (precomputation is per conversion settings, not per pixel) ---
const paletteLabCache = new Map<number, Float32Array>()
const paletteRgbCache = new Map<number, Rgb[]>()

export function paletteFor(colorCount: number): { rgb: Rgb[]; lab: Float32Array } {
  let rgb = paletteRgbCache.get(colorCount)
  let lab = paletteLabCache.get(colorCount)
  if (!rgb || !lab) {
    rgb = paletteSubset(colorCount)
    lab = new Float32Array(colorCount * 3)
    for (let i = 0; i < colorCount; i++) {
      srgbToLab(rgb[i].r, rgb[i].g, rgb[i].b, lab, i * 3)
    }
    paletteRgbCache.set(colorCount, rgb)
    paletteLabCache.set(colorCount, lab)
  }
  return { rgb, lab }
}

/** F-003 decode (simulated): copy source into a fresh IntBuffer, like a decode into a bitmap. */
export function decodeSource(source: Uint32Array): IntBuffer {
  return intBuffer(SRC_W, SRC_H, RGB888, new Uint32Array(source))
}

/** F-041 resize with filtered sampling. `linear` = bilinear, `cubic` = bicubic. */
export function resizeStage(buf: IntBuffer, sampler: SamplerName): IntBuffer {
  return buf.resize(DST_W, DST_H, sampler)
}

/** Nearest thread color by CIEDE2000 for one pixel's Lab. */
function nearestIndex(l: number, a: number, b: number, paletteLab: Float32Array, colorCount: number): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0, o = 0; i < colorCount; i++, o += 3) {
    const d = dE00(l, a, b, paletteLab[o], paletteLab[o + 1], paletteLab[o + 2])
    if (d < bestD) {
      bestD = d
      best = i
      if (d === 0) break
    }
  }
  return best
}

/** F-005 quantization: one bulk Lab conversion + one CIEDE2000 nearest-thread search per stitch cell. */
export function quantizeStage(img: IntBuffer, colorCount: number): Uint8Array {
  const { lab } = paletteFor(colorCount)
  const data = img.data
  const n = img.width * img.height
  const pixelsLab = new Float32Array(n * 3)
  srgbToLabBulk(data, pixelsLab)
  const indices = new Uint8Array(n)
  for (let i = 0, o = 0; i < n; i++, o += 3) {
    indices[i] = nearestIndex(pixelsLab[o], pixelsLab[o + 1], pixelsLab[o + 2], lab, colorCount)
  }
  return indices
}

/**
 * F-006 Floyd–Steinberg dithering to the thread palette: per-cell nearest
 * CIEDE2000 match, RGB error diffused to neighbours per the FLOYD_STEINBERG
 * kernel from @thi.ng/pixel-dither.
 */
export function ditherStage(img: IntBuffer, colorCount: number): Uint8Array {
  const K = FLOYD_STEINBERG
  const { rgb, lab } = paletteFor(colorCount)
  const w = img.width
  const h = img.height
  const data = img.data
  const n = w * h
  const indices = new Uint8Array(n)
  const err = new Float32Array(n * 3)
  const pixLab = new Float32Array(3)
  const taps = K.weights.length
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const p = data[i]
      let r = ((p >>> 16) & 0xff) + err[i * 3]
      let g = ((p >>> 8) & 0xff) + err[i * 3 + 1]
      let b = (p & 0xff) + err[i * 3 + 2]
      r = r < 0 ? 0 : r > 255 ? 255 : r
      g = g < 0 ? 0 : g > 255 ? 255 : g
      b = b < 0 ? 0 : b > 255 ? 255 : b
      srgbToLab(r, g, b, pixLab, 0)
      const best = nearestIndex(pixLab[0], pixLab[1], pixLab[2], lab, colorCount)
      indices[i] = best
      const pr = rgb[best]
      const er = r - pr.r
      const eg = g - pr.g
      const eb = b - pr.b
      for (let t = 0; t < taps; t++) {
        const nx = x + K.ox[t]
        const ny = y + K.oy[t]
        if (nx < 0 || nx >= w || ny >= h) continue
        const ni = (ny * w + nx) * 3
        const wt = K.weights[t] / (1 << K.shift)
        err[ni] += er * wt
        err[ni + 1] += eg * wt
        err[ni + 2] += eb * wt
      }
    }
  }
  return indices
}

export interface RunResult {
  timings: StageTimings
  total: number
  indices: Uint8Array
}

/** One full conversion pass, timed per stage. */
export function runOnce(
  source: Uint32Array,
  sampler: SamplerName,
  colorCount: number,
  useDither: boolean,
): RunResult {
  let t0 = performance.now()
  const decoded = decodeSource(source)
  const t1 = performance.now()
  const resized = resizeStage(decoded, sampler)
  const t2 = performance.now()
  const indices = useDither ? ditherStage(resized, colorCount) : quantizeStage(resized, colorCount)
  const t3 = performance.now()
  const timings: StageTimings = {
    decode: t1 - t0,
    resize: t2 - t1,
    quantize: useDither ? 0 : t3 - t2,
    dither: useDither ? t3 - t2 : 0,
  }
  const total = t3 - t0
  return { timings, total, indices }
}
