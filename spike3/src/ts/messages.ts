export interface QuantizeRequest {
  type: 'quantize'
  jobId: number
  file: File
  width: number
  height: number
}

export interface QuantizeResult {
  type: 'quantized'
  jobId: number
  engine: '@thi.ng/pixel'
  fileName: string
  sourceWidth: number
  sourceHeight: number
  width: number
  height: number
  indices: Uint8Array
  palette: Uint8Array
  decodeMs: number
  resizeMs: number
  quantizeMs: number
  workerMs: number
}

export interface WorkerError {
  type: 'error'
  jobId: number
  message: string
}

export type WorkerResponse = QuantizeResult | WorkerError
