/**
 * Inline Lab / CIEDE2000 hot-path math.
 *
 * SPIKE FINDING (measured in scripts/profile-distance.ts): thi.ng's
 * `distCIEDE2000()` performs a Lab D50 conversion of *both* operands on every
 * call (~800 ns/call), which puts a 300×300×64-color quantization at ~4.5 s —
 * over the NFR-P1 budget. The formula below is algebraically identical to
 * @thi.ng/color's implementation (verified: max abs difference 1.4e-14 ΔE on
 * identical Lab inputs) with the color-space conversion hoisted out of the
 * loop (~140 ns/call). This mirrors the PRD §8.3 mitigation path: the umbrella
 * package stays the reference; the innermost loop is specialized.
 *
 * Lab is CIE L*a*b* on the usual 0..100 / ±128 scale at the **D50**
 * whitepoint — the reference white of the CIEDE2000 definition and of thi.ng's
 * implementation. The sRGB→Lab50 constants below are thi.ng's exact values
 * (color/api/constants.js: RGB_XYZ_D50 direct matrix, D50 whitepoint), so
 * end-to-end results agree with @thi.ng/color to floating-point precision
 * (see scripts/profile-distance.ts).
 */

/** Bulk sRGB (packed R<<16|G<<8|B per entry) → Lab D50, writing 3 floats per pixel. */
export function srgbToLabBulk(packed: ArrayLike<number>, out: Float32Array): void {
  const n = packed.length
  for (let i = 0, o = 0; i < n; i++, o += 3) {
    srgbToLab((packed[i] >>> 16) & 0xff, (packed[i] >>> 8) & 0xff, packed[i] & 0xff, out, o)
  }
}

// thi.ng/color exact constants (api/constants.js): direct sRGB->XYZ D50
// matrix (row-major here) and D50 whitepoint.
const M_X = [0.4360747, 0.3850649, 0.1430804]
const M_Y = [0.2225045, 0.7168786, 0.0606169]
const M_Z = [0.0139322, 0.0971045, 0.7141733]
const W_X = 0.96422
const W_Z = 0.82521

/** One sRGB pixel (0..255) → Lab D50 (L 0..100, a/b ±~128) at out[o..o+2]. */
export function srgbToLab(r: number, g: number, b: number, out: Float32Array, o: number): void {
  r /= 255
  g /= 255
  b /= 255
  r = r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4)
  g = g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4)
  b = b <= 0.04045 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4)
  const fx = __f((M_X[0] * r + M_X[1] * g + M_X[2] * b) / W_X)
  const fy = __f(M_Y[0] * r + M_Y[1] * g + M_Y[2] * b)
  const fz = __f((M_Z[0] * r + M_Z[1] * g + M_Z[2] * b) / W_Z)
  out[o] = (1.16 * fy - 0.16) * 100
  out[o + 1] = 5 * (fx - fy) * 100
  out[o + 2] = 2 * (fy - fz) * 100
}

function __f(t: number): number {
  return t > 0.00885645 ? Math.cbrt(t) : 7.787037 * t + 16 / 116
}

const RAD = Math.PI / 180
const D25 = 6103515625 // 25^7

/**
 * CIEDE2000 color difference (weights 1,1,1), identical formula to
 * @thi.ng/color's `distCIEDE2000` minus the per-call whitepoint conversion.
 */
export function dE00(l1: number, a1: number, b1: number, l2: number, a2: number, b2: number): number {
  const c1 = Math.sqrt(a1 * a1 + b1 * b1)
  const c2 = Math.sqrt(a2 * a2 + b2 * b2)
  const cab = (c1 + c2) * 0.5
  const cab2 = cab * cab
  const c7 = cab2 * cab2 * cab2 * cab
  const g = 1 + 0.5 * (1 - Math.sqrt(c7 / (c7 + D25)))
  const ap1 = a1 * g
  const ap2 = a2 * g
  const cp1 = Math.sqrt(ap1 * ap1 + b1 * b1)
  const cp2 = Math.sqrt(ap2 * ap2 + b2 * b2)
  let h1 = Math.atan2(b1, ap1) / RAD
  if (h1 < 0) h1 += 360
  let h2 = Math.atan2(b2, ap2) / RAD
  if (h2 < 0) h2 += 360
  const dl = l2 - l1
  const dc = cp2 - cp1
  const cpProd = cp1 * cp2
  let dhv = 0
  if (cpProd !== 0) {
    let dh = h2 - h1
    if (dh > 180) dh -= 360
    else if (dh < -180) dh += 360
    dhv = 2 * Math.sqrt(cpProd) * Math.sin(dh * RAD * 0.5)
  }
  const lbar = (l1 + l2) * 0.5
  const cbar = (cp1 + cp2) * 0.5
  let hbar: number
  if (cpProd !== 0) {
    const s = h1 + h2
    hbar = Math.abs(h1 - h2) <= 180 ? s * 0.5 : s < 360 ? (s + 360) * 0.5 : (s - 360) * 0.5
  } else {
    hbar = h1 + h2
  }
  const hr = hbar * RAD
  const T =
    1 -
    0.17 * Math.cos(hr - RAD * 30) +
    0.24 * Math.cos(2 * hr) +
    0.32 * Math.cos(3 * hr + RAD * 6) -
    0.2 * Math.cos(4 * hr - RAD * 63)
  const dth = 30 * Math.exp(-((hbar - 275) * (hbar - 275)) / 625)
  const cb2 = cbar * cbar
  const cc7 = cb2 * cb2 * cb2 * cbar
  const rc = 2 * Math.sqrt(cc7 / (cc7 + D25))
  const l50 = lbar - 50
  const sl = 1 + (0.015 * l50 * l50) / Math.sqrt(20 + l50 * l50)
  const sc = 1 + 0.045 * cbar
  const sh = 1 + 0.015 * cbar * T
  const rt = -Math.sin(2 * dth * RAD) * rc
  const tl = dl / sl
  const tc = dc / sc
  const th = dhv / sh
  return Math.sqrt(tl * tl + tc * tc + th * th + rt * tc * th)
}
