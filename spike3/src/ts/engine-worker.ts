import { intBuffer, RGB888 } from '@thi.ng/pixel'
import type { QuantizeRequest, QuantizeResult, WorkerError } from './messages.ts'

declare const self: DedicatedWorkerGlobalScope

/** 16-color thread-like palette (RGB triplets). */
const PALETTE = new Uint8Array([
  0, 0, 0,
  84, 58, 46,
  139, 92, 61,
  195, 126, 72,
  238, 177, 84,
  250, 223, 120,
  136, 149, 88,
  74, 126, 72,
  35, 93, 84,
  53, 96, 145,
  48, 52, 112,
  91, 66, 137,
  137, 75, 132,
  179, 84, 111,
  224, 130, 105,
  245, 239, 226,
])

function packImageData(image: ImageData): Uint32Array {
  const packed = new Uint32Array(image.width * image.height)
  const data = image.data
  for (let i = 0, o = 0; i < packed.length; i++, o += 4) {
    packed[i] = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2]
  }
  return packed
}

function quantizeNearestRgb(packed: ArrayLike<number>, colors = 16): Uint8Array {
  const indices = new Uint8Array(packed.length)
  for (let i = 0; i < packed.length; i++) {
    const r = (packed[i] >>> 16) & 0xff
    const g = (packed[i] >>> 8) & 0xff
    const b = packed[i] & 0xff
    let best = 0
    let bestDistance = Infinity
    for (let c = 0, p = 0; c < colors; c++, p += 3) {
      const dr = r - PALETTE[p]
      const dg = g - PALETTE[p + 1]
      const db = b - PALETTE[p + 2]
      const distance = dr * dr + dg * dg + db * db
      if (distance < bestDistance) {
        bestDistance = distance
        best = c
        if (distance === 0) break
      }
    }
    indices[i] = best
  }
  return indices
}

async function quantizeFile(request: QuantizeRequest): Promise<QuantizeResult> {
  const workerStart = performance.now()
  const decodeStart = performance.now()
  const bitmap = await createImageBitmap(request.file)
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('2D OffscreenCanvas context unavailable')
    context.drawImage(bitmap, 0, 0)
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height)

    // Import into a thi.ng typed IntBuffer, then perform the filtered resize
    // with @thi.ng/pixel — the same engine boundary the production pipeline uses.
    const decoded = intBuffer(image.width, image.height, RGB888, packImageData(image))
    const decodeMs = performance.now() - decodeStart

    const resizeStart = performance.now()
    const resized = decoded.resize(request.width, request.height, 'linear')
    const resizeMs = performance.now() - resizeStart

    const quantizeStart = performance.now()
    const indices = quantizeNearestRgb(resized.data)
    const quantizeMs = performance.now() - quantizeStart

    return {
      type: 'quantized',
      jobId: request.jobId,
      engine: '@thi.ng/pixel',
      fileName: request.file.name,
      sourceWidth: image.width,
      sourceHeight: image.height,
      width: resized.width,
      height: resized.height,
      indices,
      palette: PALETTE.slice(),
      decodeMs,
      resizeMs,
      quantizeMs,
      workerMs: performance.now() - workerStart,
    }
  } finally {
    bitmap.close()
  }
}

self.onmessage = (event: MessageEvent<QuantizeRequest>) => {
  const request = event.data
  if (request.type !== 'quantize') return

  quantizeFile(request)
    .then((result) => {
      self.postMessage(result, [result.indices.buffer, result.palette.buffer])
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      const failure: WorkerError = { type: 'error', jobId: request.jobId, message }
      self.postMessage(failure)
    })
}
