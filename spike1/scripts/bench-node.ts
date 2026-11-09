/**
 * Full benchmark matrix in Node — the same code path the browser worker runs,
 * for cross-checking browser numbers without a browser.
 *   npm run bench:node -- [runs]
 * Writes results/node-results.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { generateSource } from '../src/image-gen.ts'
import {
  DEFAULT_CONFIG,
  NFR_P1_BUDGET_MS,
  PASS_BAR_MS,
  headline,
  runBenchmark,
  verdict,
  type BenchResults,
} from '../src/benchmark.ts'

const runs = Number(process.argv[2] ?? DEFAULT_CONFIG.runs)
const cfg = { ...DEFAULT_CONFIG, runs }

console.log(`generating 12 MP source…`)
const source = generateSource()

const meta = {
  date: new Date().toISOString(),
  source: 'node' as const,
  nodeVersion: process.version,
  platform: `${process.platform}/${process.arch}`,
  cpuModel: cpus()[0]?.model ?? 'unknown',
  cpuCores: cpus().length,
  totalMemoryGB: Math.round(totalmem() / 1024 ** 3),
}

console.log(`running matrix: ${cfg.samplers.length}x${cfg.colorCounts.length}x${cfg.dither.length} cells, ${runs} runs + ${cfg.warmup} warmup each…`)
let lastCell = ''
const t0 = performance.now()
const results: BenchResults = runBenchmark(source, cfg, meta, (p) => {
  if (p.cellLabel !== lastCell) {
    lastCell = p.cellLabel
    process.stdout.write(`\n  ${p.cellLabel}: `)
  }
  if (p.runIndex > 0 && p.runIndex % 5 === 0) process.stdout.write(`${p.runIndex} `)
})

console.log(`\n\ndone in ${((performance.now() - t0) / 1000).toFixed(0)} s\n`)
console.log('cell'.padEnd(36), 'P50', 'P95', 'P99', '  (ms, total;  resize/quantize/dither P95)')
for (const c of results.cells) {
  console.log(
    c.label.padEnd(36),
    c.total.p50.toFixed(0).padStart(5),
    c.total.p95.toFixed(0).padStart(5),
    c.total.p99.toFixed(0).padStart(5),
    `  (${c.stages.resize.p95.toFixed(0)}/${c.stages.quantize.p95.toFixed(0)}/${c.stages.dither.p95.toFixed(0)})`,
  )
}
const h = headline(results)
const v = verdict(results)
console.log(`\nheadline (worst cell ${h.cell.label}): P95 = ${h.p95.toFixed(0)} ms`)
console.log(`NFR-P1 budget ${NFR_P1_BUDGET_MS} ms, pass bar ${PASS_BAR_MS} ms -> ${v}`)

mkdirSync(new URL('../results/', import.meta.url), { recursive: true })
writeFileSync(new URL('../results/node-results.json', import.meta.url), JSON.stringify(results, null, 2))
console.log('wrote results/node-results.json')
