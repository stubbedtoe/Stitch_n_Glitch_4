/// <reference lib="webworker" />
/**
 * Web Worker entry point for the browser harness. Generates the 12 MP source
 * once, then runs the benchmark matrix, posting progress and the final
 * results (which cross the worker boundary as structured-clone-safe plain
 * objects — Uint8Array indices stay inside the worker).
 */
import { generateSource, SRC_W, SRC_H } from './image-gen.ts'
import { runBenchmark, type BenchConfig, type BenchResults } from './benchmark.ts'

interface RunMessage {
  type: 'run'
  config: BenchConfig
}

export interface ProgressMessage {
  type: 'progress'
  cellIndex: number
  totalCells: number
  cellLabel: string
  runIndex: number
  runs: number
  warmup: number
  lastTotalMs?: number
}

export interface DoneMessage {
  type: 'done'
  results: BenchResults
}

declare const self: DedicatedWorkerGlobalScope

let source: Uint32Array | null = null

self.onmessage = (e: MessageEvent<RunMessage>) => {
  const msg = e.data
  if (msg.type !== 'run') return
  if (!source) {
    source = generateSource(SRC_W, SRC_H)
  }
  const meta = {
    date: new Date().toISOString(),
    source: 'browser' as const,
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency ?? undefined,
    deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
  }
  const results = runBenchmark(source, msg.config, meta, (p) => {
    const m: ProgressMessage = { type: 'progress', ...p }
    self.postMessage(m)
  })
  const done: DoneMessage = { type: 'done', results }
  self.postMessage(done)
}
