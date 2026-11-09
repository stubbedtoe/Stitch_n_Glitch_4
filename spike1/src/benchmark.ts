/**
 * Benchmark runner: warmup + N timed runs per configuration cell, percentile
 * aggregation. Pure — drives pipeline.runOnce in whatever context it is called
 * (Web Worker in the browser harness, main thread in Node).
 */
import { runOnce, type SamplerName, type StageTimings } from './pipeline.ts'

export interface Stats {
  min: number
  max: number
  mean: number
  p50: number
  p95: number
  p99: number
}

export interface CellResult {
  label: string
  sampler: SamplerName
  colors: number
  dither: boolean
  runs: number
  total: Stats
  stages: Record<keyof StageTimings, Stats>
  totalsRaw: number[]
}

export interface BenchConfig {
  runs: number
  warmup: number
  samplers: SamplerName[]
  colorCounts: number[]
  dither: boolean[]
}

export const DEFAULT_CONFIG: BenchConfig = {
  runs: 15,
  warmup: 3,
  samplers: ['linear', 'cubic'],
  colorCounts: [16, 32, 64],
  dither: [false, true],
}

export const NFR_P1_BUDGET_MS = 5000
export const PASS_BAR_MS = 2500 // "met with margin" per Build Plan S1 (2x headroom)

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

export function stats(arr: number[]): Stats {
  const sorted = [...arr].sort((a, b) => a - b)
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  }
}

export interface CellSpec {
  sampler: SamplerName
  colors: number
  dither: boolean
}

export function cellLabel(c: CellSpec): string {
  return `${c.sampler}/${c.colors} colors/dither ${c.dither ? 'on' : 'off'}`
}

export function* iterCells(cfg: BenchConfig): Generator<CellSpec> {
  for (const sampler of cfg.samplers) {
    for (const colors of cfg.colorCounts) {
      for (const d of cfg.dither) {
        yield { sampler, colors, dither: d }
      }
    }
  }
}

export interface Progress {
  cellIndex: number
  totalCells: number
  cellLabel: string
  runIndex: number // -1 while warming up
  runs: number
  warmup: number
  lastTotalMs?: number
}

export function runCell(
  source: Uint32Array,
  cell: CellSpec,
  cfg: BenchConfig,
  onProgress?: (p: Progress) => void,
): CellResult {
  const totals: number[] = []
  const decode: number[] = []
  const resize: number[] = []
  const quantize: number[] = []
  const dither: number[] = []
  const totalCells = cfg.samplers.length * cfg.colorCounts.length * cfg.dither.length
  for (let w = 0; w < cfg.warmup; w++) {
    onProgress?.({ cellIndex: -1, totalCells, cellLabel: cellLabel(cell), runIndex: w - cfg.warmup, runs: cfg.runs, warmup: cfg.warmup })
    runOnce(source, cell.sampler, cell.colors, cell.dither)
  }
  for (let i = 0; i < cfg.runs; i++) {
    const r = runOnce(source, cell.sampler, cell.colors, cell.dither)
    totals.push(r.total)
    decode.push(r.timings.decode)
    resize.push(r.timings.resize)
    quantize.push(r.timings.quantize)
    dither.push(r.timings.dither)
    onProgress?.({ cellIndex: -1, totalCells, cellLabel: cellLabel(cell), runIndex: i + 1, runs: cfg.runs, warmup: cfg.warmup, lastTotalMs: r.total })
  }
  return {
    label: cellLabel(cell),
    sampler: cell.sampler,
    colors: cell.colors,
    dither: cell.dither,
    runs: cfg.runs,
    total: stats(totals),
    stages: { decode: stats(decode), resize: stats(resize), quantize: stats(quantize), dither: stats(dither) },
    totalsRaw: totals,
  }
}

export interface BenchMeta {
  date: string
  source: 'browser' | 'node'
  userAgent?: string
  hardwareConcurrency?: number
  deviceMemory?: number
  platform?: string
  cpuModel?: string
  totalMemoryGB?: number
  [k: string]: unknown
}

export interface BenchResults {
  meta: BenchMeta
  config: BenchConfig & { srcW: number; srcH: number; dstW: number; dstH: number; mp: number }
  cells: CellResult[]
}

export function runBenchmark(
  source: Uint32Array,
  cfg: BenchConfig,
  meta: BenchMeta,
  onProgress?: (p: Progress & { cellIndex: number }) => void,
): BenchResults {
  const cells: CellResult[] = []
  const all = [...iterCells(cfg)]
  all.forEach((cell, cellIndex) => {
    const result = runCell(source, cell, cfg, (p) => onProgress?.({ ...p, cellIndex }))
    cells.push(result)
  })
  return {
    meta,
    config: {
      ...cfg,
      srcW: 4000,
      srcH: 3000,
      dstW: 300,
      dstH: 300,
      mp: 12,
    },
    cells,
  }
}

/** Worst-case cell by total P95 — the headline NFR-P1 number. */
export function headline(results: BenchResults): { cell: CellResult; p95: number } {
  let worst = results.cells[0]
  for (const c of results.cells) {
    if (c.total.p95 > worst.total.p95) worst = c
  }
  return { cell: worst, p95: worst.total.p95 }
}

export function verdict(results: BenchResults): 'PASS' | 'FAIL' {
  return headline(results).p95 <= PASS_BAR_MS ? 'PASS' : 'FAIL'
}
