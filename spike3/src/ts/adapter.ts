import type { QuantizeResult, WorkerResponse } from './messages.ts'
import { renderChart } from './renderer.ts'

interface Measurement {
  frames: number
  longFrames: number
  startedAt: number
  baselineFrames: number
  baselineLongFrames: number
}

const rafState = {
  frames: 0,
  longFrames: 0,
  lastTime: performance.now(),
}

let activeMeasurement: Measurement | null = null
let worker: Worker | null = null
let nextJobId = 0
const pending = new Map<number, (result: QuantizeResult) => void>()

function rafLoop(time: number): void {
  const delta = time - rafState.lastTime
  rafState.lastTime = time
  rafState.frames += 1
  if (delta > 50) rafState.longFrames += 1
  requestAnimationFrame(rafLoop)
}
requestAnimationFrame(rafLoop)

function getWorker(): Worker {
  if (worker) return worker

  worker = new Worker(new URL('./engine-worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data
    if (response.type === 'error') {
      const callback = pending.get(response.jobId)
      pending.delete(response.jobId)
      throw new Error(`Quantize worker failed: ${response.message}`)
    }

    const callback = pending.get(response.jobId)
    pending.delete(response.jobId)
    callback?.(response)
  }
  worker.onerror = (event) => {
    throw new Error(`Quantize worker crashed: ${event.message}`)
  }
  return worker
}

export function prepare_worker(): void {
  getWorker()
}

export function attach_file_input(
  inputId: string,
  onFile: (file: File) => void,
): void {
  document.addEventListener('change', (event) => {
    const target = event.target
    if (!(target instanceof HTMLInputElement)) return
    if (target.id !== inputId) return
    const file = target.files?.[0]
    if (file) onFile(file)
  })
}

export function quantize_image(file: File, onResult: (result: QuantizeResult) => void): void {
  const jobId = ++nextJobId
  pending.set(jobId, onResult)

  activeMeasurement = {
    frames: 0,
    longFrames: 0,
    startedAt: performance.now(),
    baselineFrames: rafState.frames,
    baselineLongFrames: rafState.longFrames,
  }

  const win = window as unknown as Record<string, unknown>
  win.__SPIKE_DONE__ = false
  win.__SPIKE_RESULT__ = null

  getWorker().postMessage({
    type: 'quantize',
    jobId,
    file,
    width: 300,
    height: 300,
  })
}

export function render_chart(canvasId: string, chart: QuantizeResult) {
  return renderChart(canvasId, chart)
}

export function finish_result(
  chart: QuantizeResult,
  renderInfo: Record<string, unknown>,
  onSummary: (summary: Record<string, unknown>) => void,
): void {
  const measurement = activeMeasurement
  const elapsed = measurement ? performance.now() - measurement.startedAt : 0
  const remaining = Math.max(0, 1000 - elapsed)

  setTimeout(() => {
    const current = activeMeasurement
    activeMeasurement = null
    const elapsedMs = current ? performance.now() - current.startedAt : 0
    const frames = current ? rafState.frames - current.baselineFrames : 0
    const jankFrames = current ? rafState.longFrames - current.baselineLongFrames : 0

    const result = {
      status: 'done',
      engine: chart.engine,
      worker: true,
      fileName: chart.fileName,
      sourceWidth: chart.sourceWidth,
      sourceHeight: chart.sourceHeight,
      width: chart.width,
      height: chart.height,
      decodeMs: chart.decodeMs,
      resizeMs: chart.resizeMs,
      quantizeMs: chart.quantizeMs,
      workerMs: chart.workerMs,
      ...renderInfo,
      measurementMs: elapsedMs,
      fps: elapsedMs > 0 ? (frames / elapsedMs) * 1000 : 0,
      jankFrames,
    }

    const win = window as unknown as Record<string, unknown>
    win.__SPIKE_RESULT__ = result
    win.__SPIKE_DONE__ = true
    onSummary(result)
  }, remaining)
}
