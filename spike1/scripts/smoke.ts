/**
 * Quick correctness smoke test (Node): verifies the pipeline produces valid,
 * deterministic output and prints rough per-stage timings. Run:
 *   npm run smoke
 */
import { generateSource, SRC_W, SRC_H } from '../src/image-gen.ts'
import { decodeSource, resizeStage, quantizeStage, ditherStage, runOnce } from '../src/pipeline.ts'
import { DMC_SAMPLE, paletteSubset } from '../src/palette.ts'

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`SMOKE FAIL: ${msg}`)
    process.exit(1)
  }
}

console.log(`palette sample size: ${DMC_SAMPLE.length} threads`)

let t0 = performance.now()
const source = generateSource()
console.log(`source generated: ${SRC_W}x${SRC_H} (${((SRC_W * SRC_H) / 1e6).toFixed(0)} MP) in ${(performance.now() - t0).toFixed(0)} ms`)

// palette subset sanity
const p16 = paletteSubset(16)
const p64 = paletteSubset(64)
assert(p16.length === 16 && p64.length === 64, 'palette subset sizes')
assert(
  new Set(p16.map((c) => `${c.r},${c.g},${c.b}`)).size === 16,
  'palette subset distinct',
)

// stage checks
const decoded = decodeSource(source)
assert(decoded.width === SRC_W && decoded.height === SRC_H, 'decode dims')
const resized = resizeStage(decoded, 'linear')
assert(resized.width === 300 && resized.height === 300, 'resize dims')

const q1 = quantizeStage(resized, 32)
assert(q1.length === 90000, 'quantize output size')
assert(q1.every((i) => i >= 0 && i < 32), 'quantize indices in palette range')

const q2 = quantizeStage(resized, 32)
assert(q1.every((v, i) => v === q2[i]), 'quantize deterministic')

const d1 = ditherStage(resized, 16)
assert(d1.length === 90000 && d1.every((i) => i >= 0 && i < 16), 'dither indices in palette range')
const d2 = ditherStage(resized, 16)
assert(d1.every((v, i) => v === d2[i]), 'dither deterministic')
assert(!q1.every((v, i) => v === d1[i % d1.length]), 'dither changes output vs plain quantize')

// full timed pass
const r = runOnce(source, 'cubic', 32, false)
console.log(
  `runOnce cubic/32/no-dither: total ${r.total.toFixed(0)} ms ` +
    `(decode ${r.timings.decode.toFixed(0)}, resize ${r.timings.resize.toFixed(0)}, quantize ${r.timings.quantize.toFixed(0)})`,
)
const rd = runOnce(source, 'linear', 32, true)
console.log(`runOnce linear/32/dither:   total ${rd.total.toFixed(0)} ms (dither ${rd.timings.dither.toFixed(0)})`)

console.log('SMOKE OK')
