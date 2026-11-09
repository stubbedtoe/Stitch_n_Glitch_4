/**
 * Profiles the CIEDE2000 hot-path options and verifies the inline version
 * against @thi.ng/color's distCIEDE2000. This documents the spike's central
 * engine finding (see src/lab.ts). Run: node scripts/profile-distance.ts
 */
import { convert, labD50 } from '@thi.ng/color'
import { distCIEDE2000 } from '@thi.ng/color/distance'
import { srgbToLab, srgbToLabBulk, dE00 } from '../src/lab.ts'

const N = 90000 // 300x300 stitch cells
const rnd = ((s) => () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)(42)

// random sRGB pairs in-gamut
const pairs: number[][] = []
for (let i = 0; i < 20000; i++) {
  pairs.push([rnd() * 255, rnd() * 255, rnd() * 255])
}

const toThingLab50 = (r: number, g: number, b: number) => {
  const l = labD50()
  convert(l, new Float32Array([r / 255, g / 255, b / 255, 1]), 'lab50', 'srgb')
  return l
}

// --- 1. formula agreement: inline dE00 vs thi.ng distCIEDE2000 on identical (thi.ng-computed) Lab D50 triples ---
const thingDist = distCIEDE2000()
let maxDiff = 0
let sumDiff = 0
for (let i = 0; i < pairs.length; i += 2) {
  const [r1, g1, b1] = pairs[i]
  const [r2, g2, b2] = pairs[i + 1]
  const lab1 = toThingLab50(r1, g1, b1)
  const lab2 = toThingLab50(r2, g2, b2)
  const dThing = thingDist(lab1, lab2)
  const dMine = dE00(lab1.l * 100, lab1.a * 100, lab1.b * 100, lab2.l * 100, lab2.a * 100, lab2.b * 100)
  const diff = Math.abs(dThing - dMine)
  if (diff > maxDiff) maxDiff = diff
  sumDiff += diff
}
console.log('=== formula agreement (inline dE00 vs thi.ng distCIEDE2000, identical Lab D50 inputs) ===')
console.log(`  pairs=${pairs.length / 2}  max |diff| = ${maxDiff.toExponential(3)}  mean |diff| = ${(sumDiff / (pairs.length / 2)).toExponential(3)}`)

// --- 2. end-to-end agreement: inline sRGB->Lab50 + dE00 vs thi.ng convert(lab50) + distCIEDE2000 ---
let maxE2e = 0
let sumE2e = 0
const mine1 = new Float32Array(3)
const mine2 = new Float32Array(3)
const E2E = 5000
for (let i = 0; i < E2E; i++) {
  const [r1, g1, b1] = pairs[i]
  const [r2, g2, b2] = pairs[(i * 7 + 1000) % pairs.length]
  const lab1 = toThingLab50(r1, g1, b1)
  const lab2 = toThingLab50(r2, g2, b2)
  srgbToLab(r1, g1, b1, mine1, 0)
  srgbToLab(r2, g2, b2, mine2, 0)
  const diff = Math.abs(
    thingDist(lab1, lab2) - dE00(mine1[0], mine1[1], mine1[2], mine2[0], mine2[1], mine2[2]),
  )
  if (diff > maxE2e) maxE2e = diff
  sumE2e += diff
}
console.log('=== end-to-end agreement (inline converter+dE00 vs thi.ng converter+distCIEDE2000) ===')
console.log(`  pairs=${E2E}  max |dE00 diff| = ${maxE2e.toExponential(3)}  mean = ${(sumE2e / E2E).toExponential(3)}`)

// --- 3. throughput comparison on the real workload shape (90k cells x palette) ---
const data = new Uint32Array(N)
for (let i = 0; i < N; i++) data[i] = ((i * 7) % 256 << 16) | ((i * 13) % 256 << 8) | ((i * 29) % 256)
const palThing = pairs.slice(0, 32).map(([r, g, b]) => toThingLab50(r, g, b))
const pixThing = toThingLab50(102, 128, 153)

let t0 = performance.now()
for (let i = 0; i < N; i++) {
  for (let k = 0; k < 32; k++) thingDist(pixThing, palThing[k])
}
console.log('=== throughput, 90k cells x 32 colors ===')
console.log(`  thi.ng distCIEDE2000 as-is : ${(performance.now() - t0).toFixed(0)} ms`)

const palMine = new Float32Array(32 * 3)
for (let k = 0; k < 32; k++) srgbToLab(pairs[k][0], pairs[k][1], pairs[k][2], palMine, k * 3)
const bulk = new Float32Array(N * 3)
t0 = performance.now()
srgbToLabBulk(data, bulk)
const bulkMs = performance.now() - t0
t0 = performance.now()
const pl = new Float32Array(3)
let acc = 0
for (let i = 0; i < N; i++) {
  srgbToLab((data[i] >>> 16) & 255, (data[i] >>> 8) & 255, data[i] & 255, pl, 0)
  for (let k = 0; k < 32; k++) acc += dE00(pl[0], pl[1], pl[2], palMine[k * 3], palMine[k * 3 + 1], palMine[k * 3 + 2])
}
console.log(`  inline converter+dE00      : ${(performance.now() - t0).toFixed(0)} ms  (bulk srgb->lab alone: ${bulkMs.toFixed(0)} ms)  acc=${acc.toFixed(0)}`)
