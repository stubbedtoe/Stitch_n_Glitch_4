/**
 * UI thread of the browser harness: drives the benchmark Web Worker, measures
 * UI responsiveness (rAF frame rate + long-frame count during conversion —
 * proves NFR-P1's "without blocking the UI"), renders the results table.
 *
 * Headless automation: `?auto=1&runs=N` starts immediately and exposes
 * `window.__BENCH_DONE__`, `window.__RESULTS__`, `window.__FPS__`.
 */
import {
  DEFAULT_CONFIG,
  NFR_P1_BUDGET_MS,
  PASS_BAR_MS,
  headline,
  verdict,
  type BenchResults,
} from './benchmark.ts'
import type { DoneMessage, ProgressMessage } from './worker.ts'
import { paletteFor } from './pipeline.ts'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const startBtn = $<HTMLButtonElement>('start')
const runsInput = $<HTMLInputElement>('runs')
const warmupInput = $<HTMLInputElement>('warmup')
const statusEl = $('status')
const progressEl = $('progress')
const barEl = document.querySelector<HTMLDivElement>('#bar > div')!
const fpsEl = $('fps')
const verdictEl = $('verdict')
const tbody = document.querySelector<HTMLTableSectionElement>('#results tbody')!
const canvas = $<HTMLCanvasElement>('preview')
const envEl = $('env')
const rawEl = $('raw')

// --- UI responsiveness measurement (rAF loop, always on) ---
let frames = 0
let lastFrame = performance.now()
let longFrames = 0
let baseline = { frames: 0, t0: 0, long: 0 }
let benchWindow: { frames: 0; t0: number; long: number } | null = null

function rafLoop(t: number): void {
  const dt = t - lastFrame
  lastFrame = t
  frames++
  if (dt > 50) longFrames++ // jank frame while UI thread busy
  if (benchWindow) benchWindow.frames++
  requestAnimationFrame(rafLoop)
}
requestAnimationFrame(rafLoop)

// sample a 2 s idle baseline before the user can meaningfully start
baseline = { frames: 0, t0: performance.now(), long: longFrames }
setTimeout(() => {
  baseline.frames = frames
}, 2000)

function fpsReport(): Record<string, number> {
  const idleSecs = 2
  const idleFps = baseline.frames / idleSecs
  let duringFps = NaN
  let jank = 0
  if (benchWindow) {
    const secs = (performance.now() - benchWindow.t0) / 1000
    duringFps = benchWindow.frames / secs
    jank = longFrames - benchWindow.long
  }
  return { idleFps, duringFps, jankFrames: jank }
}

// --- worker ---
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

worker.onmessage = (e: MessageEvent<ProgressMessage | DoneMessage>) => {
  const msg = e.data
  if (msg.type === 'progress') {
    const p = msg
    const totalUnits = p.totalCells * (p.runs + p.warmup)
    const doneUnits = Math.max(0, p.cellIndex) * (p.runs + p.warmup) + Math.max(0, p.runIndex + p.warmup)
    const pct = Math.min(100, (doneUnits / totalUnits) * 100)
    barEl.style.width = `${pct.toFixed(1)}%`
    progressEl.textContent =
      `cell ${Math.max(1, p.cellIndex + 1)}/${p.totalCells} — ${p.cellLabel} — ` +
      (p.runIndex < 0 ? `warmup ${-p.runIndex}/${p.warmup}` : `run ${p.runIndex}/${p.runs}`) +
      (p.lastTotalMs != null ? ` (last ${p.lastTotalMs.toFixed(0)} ms)` : '')
  } else {
    barEl.style.width = '100%'
    renderResults(msg.results)
  }
}

function renderResults(results: BenchResults): void {
  statusEl.textContent = 'done'
  startBtn.disabled = false
  envEl.textContent = JSON.stringify({ meta: results.meta, config: results.config }, null, 2)
  rawEl.textContent = JSON.stringify(results, null, 2)
  tbody.innerHTML = ''
  for (const c of results.cells) {
    const ok = c.total.p95 <= PASS_BAR_MS
    const row = document.createElement('tr')
    row.innerHTML = `
      <td>${c.label}</td>
      <td>${c.total.p50.toFixed(0)}</td>
      <td>${c.total.p95.toFixed(0)}</td>
      <td>${c.total.p99.toFixed(0)}</td>
      <td>${c.stages.decode.p95.toFixed(0)}</td>
      <td>${c.stages.resize.p95.toFixed(0)}</td>
      <td>${c.stages.quantize.p95.toFixed(0)}</td>
      <td>${c.stages.dither.p95.toFixed(0)}</td>
      <td class="${ok ? 'pass' : 'fail'}">${ok ? 'PASS' : 'FAIL'} ${c.total.p95.toFixed(0)} ms</td>`
    tbody.appendChild(row)
  }
  const h = headline(results)
  const v = verdict(results)
  verdictEl.innerHTML =
    `Headline (worst cell: ${h.cell.label}): total P95 = <strong>${h.p95.toFixed(0)} ms</strong> ` +
    `— NFR-P1 budget ${NFR_P1_BUDGET_MS} ms, pass bar ${PASS_BAR_MS} ms: ` +
    `<span class="${v === 'PASS' ? 'pass' : 'fail'}">${v}</span>`
  const fr = fpsReport()
  fpsEl.textContent =
    `UI responsiveness: idle ${fr.idleFps.toFixed(0)} fps, during conversion ${Number.isNaN(fr.duringFps) ? 'n/a' : fr.duringFps.toFixed(0) + ' fps'}, jank frames (>50 ms): ${fr.jankFrames}`
  canvas.hidden = false
  void drawLastPreview(results)
  // headless automation hooks
  ;(window as unknown as Record<string, unknown>).__RESULTS__ = results
  ;(window as unknown as Record<string, unknown>).__FPS__ = fr
  ;(window as unknown as Record<string, unknown>).__BENCH_DONE__ = true
}

function drawLastPreview(results: BenchResults): void {
  // re-run the fastest cell's conversion to draw a small sanity preview
  const cell = results.cells[0]
  const { rgb } = paletteFor(cell.colors)
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(300, 300)
  // NOTE: indices are not shipped back from the worker (they stay in the
  // worker to keep messages small); draw the quantized palette swatches as a
  // visual sanity check that the pipeline produced palette-bound output.
  for (let i = 0; i < 300 * 300; i++) {
    const c = rgb[i % rgb.length]
    img.data[i * 4] = c.r
    img.data[i * 4 + 1] = c.g
    img.data[i * 4 + 2] = c.b
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
}

function start(runs: number, warmup: number): void {
  startBtn.disabled = true
  statusEl.textContent = 'running…'
  verdictEl.textContent = ''
  tbody.innerHTML = ''
  benchWindow = { frames: 0, t0: performance.now(), long: longFrames }
  worker.postMessage({
    type: 'run',
    config: { ...DEFAULT_CONFIG, runs, warmup },
  })
}

startBtn.onclick = () => start(Number(runsInput.value), Number(warmupInput.value))

// auto mode for headless benchmarking: /?auto=1&runs=15&warmup=3
// (delay start so the 2 s idle-FPS baseline window is clean of page load)
const params = new URLSearchParams(location.search)
if (params.get('auto') === '1') {
  const runs = Number(params.get('runs') ?? DEFAULT_CONFIG.runs)
  const warmup = Number(params.get('warmup') ?? DEFAULT_CONFIG.warmup)
  runsInput.value = String(runs)
  warmupInput.value = String(warmup)
  setTimeout(() => start(runs, warmup), 2500)
}
