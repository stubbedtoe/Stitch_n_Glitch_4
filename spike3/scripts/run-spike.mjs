#!/usr/bin/env node
/**
 * Headless-Chrome driver for spike S3.
 *
 * Serves the production Vite build, creates a deterministic 1200×900 PNG,
 * injects it into the Lustre file input, waits for the Gleam → TypeScript
 * worker → WebGL2 round trip, and validates the S3 pass bar:
 *
 *   import → @thi.ng/pixel quantize in a Web Worker → WebGL2 render,
 *   with the UI thread at 60 fps and zero >50 ms frames.
 *
 * Usage:
 *   npm run build
 *   npm run spike
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { deflateSync } from 'node:zlib'

const ROOT = new URL('..', import.meta.url).pathname
const DIST = join(ROOT, 'dist')
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 60_000)

if (!existsSync(DIST)) {
  console.error('dist/ not found — run `npm run build` first')
  process.exit(1)
}
if (!existsSync(CHROME)) {
  console.error(`Chrome not found at ${CHROME} — set CHROME_PATH`)
  process.exit(1)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

function serveDist() {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1)
    const file = normalize(join(DIST, relative))
    if (!file.startsWith(DIST)) {
      response.writeHead(403).end('forbidden')
      return
    }

    try {
      const body = readFileSync(file)
      response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
      response.end(body)
    } catch {
      response.writeHead(404).end('not found')
    }
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, port: address.port })
    })
  })
}

// --- deterministic 1200×900 RGB PNG -----------------------------------------
const CRC_TABLE = new Int32Array(256).map((_, i) => {
  let c = i
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c | 0
})

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), 8 + data.length)
  return out
}

function samplePng(path) {
  const width = 1200
  const height = 900
  const raw = Buffer.alloc((width * 3 + 1) * height)
  let offset = 0
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0 // PNG filter: none
    for (let x = 0; x < width; x++) {
      raw[offset++] = Math.floor(127 + 96 * Math.sin(x / 73) + 32 * Math.sin(y / 41))
      raw[offset++] = Math.floor(127 + 90 * Math.sin((x + y) / 89) + 40 * Math.cos(x / 31))
      raw[offset++] = Math.floor(127 + 100 * Math.cos(y / 67) + 24 * Math.sin((x - y) / 53))
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolor RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 6 })),
    pngChunk('IEND'),
  ])
  writeFileSync(path, png)
  return { width, height, bytes: png.length }
}

// --- minimal CDP client ------------------------------------------------------
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  const listeners = []

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)
    } else if (message.method) {
      for (const listener of listeners) listener(message)
    }
  }

  return {
    ready: new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = reject
    }),
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const messageId = ++id
        pending.set(messageId, { resolve, reject })
        ws.send(JSON.stringify({ id: messageId, method, params }))
      }),
    on: (listener) => listeners.push(listener),
    close: () => ws.close(),
  }
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? 'evaluation failed')
  }
  return response.result.value
}

async function waitFor(client, expression, timeoutMs = TIMEOUT_MS) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await evaluate(client, expression)) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`timeout waiting for ${expression}`)
}

const { server, port } = await serveDist()
const samplePath = join(ROOT, 'results', 'sng-spike3-sample.png')
mkdirSync(join(ROOT, 'results'), { recursive: true })
const sample = samplePng(samplePath)

const profile = mkdtempSync(join(tmpdir(), 'sng-spike3-'))
const chrome = spawn(
  CHROME,
  [
    '--headless',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--window-size=1280,900',
    'about:blank',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)

async function devtoolsPort() {
  const portFile = join(profile, 'DevToolsActivePort')
  for (let i = 0; i < 100; i++) {
    if (existsSync(portFile)) {
      const value = Number(readFileSync(portFile, 'utf8').split('\n')[0])
      if (value > 0) return value
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('DevToolsActivePort never appeared')
}

const pageErrors = []

const cleanup = (code) => {
  try { chrome.kill('SIGKILL') } catch {}
  try { rmSync(profile, { recursive: true, force: true }) } catch {}
  server.close()
  process.exit(code)
}
process.on('SIGINT', () => cleanup(2))

try {
  const debugPort = await devtoolsPort()
  let target
  for (let i = 0; i < 50 && !target; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
      target = targets.find((item) => item.type === 'page')
    } catch {}
    if (!target) await new Promise((resolve) => setTimeout(resolve, 200))
  }
  if (!target) throw new Error('no page target found')

  const client = cdp(target.webSocketDebuggerUrl)
  await client.ready
  await client.send('Runtime.enable')
  await client.send('Page.enable')

  client.on((message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      pageErrors.push(message.params.exceptionDetails?.exception?.description ?? 'unknown exception')
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      pageErrors.push(message.params.args?.map((arg) => arg.value ?? arg.description).join(' '))
    }
  })

  const url = `http://127.0.0.1:${port}/`
  console.log(`serving dist on ${url}`)
  await client.send('Page.navigate', { url })
  await client.send('Page.bringToFront')
  await waitFor(client, `!!document.querySelector('#${'source-image'}')`)
  // Warm the compositor/worker startup path before measuring the demo flow.
  await new Promise((resolve) => setTimeout(resolve, 500))

  const document = await client.send('DOM.getDocument')
  const node = await client.send('DOM.querySelector', {
    nodeId: document.root.nodeId,
    selector: '#source-image',
  })
  await client.send('DOM.setFileInputFiles', { files: [samplePath], nodeId: node.nodeId })

  await waitFor(client, 'window.__SPIKE_DONE__ === true')
  const result = JSON.parse(await evaluate(client, 'JSON.stringify(window.__SPIKE_RESULT__)'))
  const environment = JSON.parse(
    await evaluate(
      client,
      `JSON.stringify({ userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency })`,
    ),
  )

  const checks = {
    lustre_round_trip: result.status === 'done',
    thi_ng_worker: result.worker === true && result.engine === '@thi.ng/pixel',
    imported_source: result.sourceWidth === sample.width && result.sourceHeight === sample.height,
    chart_shape: result.width === 300 && result.height === 300,
    webgl2_render: result.webgl2 === true && result.renderMs >= 0,
    canvas_readback: result.uniqueColors > 1 && result.uniqueColors <= 16 && result.checksum > 0,
    fps_60: result.fps >= 55 && result.jankFrames === 0,
  }
  const pass = Object.values(checks).every(Boolean)
  const output = {
    pass,
    checks,
    result,
    sample,
    environment,
    chrome: CHROME,
    node: process.version,
    ranAt: new Date().toISOString(),
  }

  writeFileSync(join(ROOT, 'results', 'spike3-browser-result.json'), JSON.stringify(output, null, 2))
  console.log(`sample: ${sample.width}×${sample.height} PNG (${sample.bytes} bytes)`)
  console.log(
    `decode=${result.decodeMs.toFixed(1)}ms resize=${result.resizeMs.toFixed(1)}ms ` +
      `quantize=${result.quantizeMs.toFixed(1)}ms render=${result.renderMs.toFixed(1)}ms ` +
      `measurement=${result.measurementMs.toFixed(1)}ms`,
  )
  console.log(`UI: ${result.fps.toFixed(1)} fps, jank frames=${result.jankFrames}`)
  console.log(`WebGL readback: ${result.uniqueColors} unique colors, checksum=${result.checksum}`)
  console.log(`checks: ${JSON.stringify(checks)}`)
  console.log(`${pass ? '✅ PASS' : '❌ FAIL'} — wrote results/spike3-browser-result.json`)

  if (pageErrors.length) {
    console.error('page errors:', pageErrors)
    cleanup(1)
  }
  cleanup(pass ? 0 : 1)
} catch (error) {
  if (pageErrors.length) console.error('page errors:', pageErrors)
  console.error(error.message ?? error)
  cleanup(1)
}
