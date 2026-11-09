#!/usr/bin/env node
/**
 * Headless gate for Spike S5.
 *
 * Builds the Gleam app, serves the production bundle, runs the confusability
 * analysis in headless Chrome (the Gleam app rasterizes the SVG symbol
 * library through the canvas FFI and computes everything else in Gleam),
 * then independently re-verifies the result JSON before writing the artifact.
 *
 * The app itself is Gleam; this file is only the local server/browser harness.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const DIST = join(ROOT, 'dist')
const APP_HOST = '127.0.0.1'
const APP_PORT = 4173
const APP_URL = `http://localhost:${APP_PORT}`
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 60_000)

if (!existsSync(CHROME)) {
  console.error(`Chrome not found at ${CHROME} — set CHROME_PATH`)
  process.exit(1)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.error) throw result.error
  return result
}

function serveDist() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', APP_URL)
    const pathname = decodeURIComponent(url.pathname)
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1)
    const file = normalize(join(DIST, relative))
    if (!file.startsWith(DIST)) {
      response.writeHead(403).end('forbidden')
      return
    }
    try {
      const body = readFileSync(file)
      const type = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
      }[extname(file)] ?? 'application/octet-stream'
      response.writeHead(200, { 'content-type': type })
      response.end(body)
    } catch {
      response.writeHead(404).end('not found')
    }
  })
  return new Promise((resolveServer) => server.listen(APP_PORT, APP_HOST, () => resolveServer(server)))
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  const listeners = []
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve: ok, reject } = pending.get(message.id)
      pending.delete(message.id)
      message.error ? reject(new Error(JSON.stringify(message.error))) : ok(message.result)
    } else if (message.method) {
      for (const listener of listeners) listener(message)
    }
  }
  return {
    ready: new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad }),
    send: (method, params = {}) => new Promise((ok, bad) => {
      const messageId = ++id
      pending.set(messageId, { resolve: ok, reject: bad })
      ws.send(JSON.stringify({ id: messageId, method, params }))
    }),
    on: (listener) => listeners.push(listener),
    close: () => ws.close(),
  }
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: false,
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
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`timeout waiting for ${expression}`)
}

async function chromePort(profile) {
  const portFile = join(profile, 'DevToolsActivePort')
  for (let i = 0; i < 200; i++) {
    if (existsSync(portFile)) {
      const port = Number(readFileSync(portFile, 'utf8').split('\n')[0])
      if (port > 0) return port
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('DevToolsActivePort never appeared')
}

// --- independent re-verification of the Gleam-produced report ---

function approx(a, b, epsilon = 1e-9) {
  return Math.abs(a - b) <= epsilon
}

function minOverrideDistance(overrides) {
  return overrides.reduce((acc, override) => Math.min(acc, override.distance), 1.0)
}

function verifySize(report, minMarginRatio, overrides) {
  const problems = []
  const matrix = report.matrix
  const n = matrix.length
  if (n === 0 || !matrix.every((row) => row.length === n)) {
    problems.push('matrix is not square')
    return problems
  }
  for (let i = 0; i < n; i++) {
    if (!approx(matrix[i][i], 0.0)) problems.push(`diagonal [${i}][${i}] != 0`)
    for (let j = 0; j < n; j++) {
      if (!approx(matrix[i][j], matrix[j][i])) problems.push(`asymmetric [${i}][${j}]`)
      if (matrix[i][j] < 0 || matrix[i][j] > 1) problems.push(`out of range [${i}][${j}]`)
    }
  }
  if (!(report.computedMinOffDiagonal > report.noiseFloor)) {
    problems.push('computedMinOffDiagonal not above alias floor')
  }
  if (report.marginRatio < minMarginRatio) {
    problems.push(`margin ratio below ${minMarginRatio}`)
  }
  for (const [name, value] of Object.entries(report.coverage)) {
    if (!(value > 0)) problems.push(`glyph ${name} did not render`)
  }
  const assignment = report.assignment
  const symbols = assignment.mapping.map((pair) => pair[1])
  if (new Set(symbols).size !== symbols.length) problems.push('assignment reuses a symbol')
  if (symbols.length !== assignment.colors) problems.push('assignment does not cover every color')
  // recompute min neighbor distance from the matrix + mapping on a path graph
  const at = (color) => assignment.mapping.find((pair) => pair[0] === color)[1]
  let recomputed = 1.0
  for (let color = 0; color < assignment.colors; color++) {
    for (const neighbor of [color - 1, color + 1]) {
      if (neighbor < 0 || neighbor >= assignment.colors) continue
      recomputed = Math.min(recomputed, matrix[at(color)][at(neighbor)])
    }
  }
  if (!approx(recomputed, assignment.minNeighborDistance, 1e-6)) {
    problems.push(`assignment minNeighborDistance ${assignment.minNeighborDistance} != recomputed ${recomputed}`)
  }
  if (!(assignment.minNeighborDistance >= minOverrideDistance(overrides) - 1e-9)) {
    problems.push('assignment min neighbor distance below strictest override')
  }
  return problems
}

const build = run('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
if (build.status !== 0) process.exit(1)

const server = await serveDist()
console.log(`serving Gleam app on ${APP_URL}`)

const profile = mkdtempSync(join(tmpdir(), 'sng-spike5-'))
const chrome = spawn(CHROME, [
  '--headless',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--window-size=1280,900',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })

const pageErrors = []
let mainClient = null

const cleanup = (code) => {
  try { chrome.kill('SIGKILL') } catch {}
  try { rmSync(profile, { recursive: true, force: true }) } catch {}
  server.close()
  process.exit(code)
}
process.on('SIGINT', () => cleanup(2))

try {
  const browserPort = await chromePort(profile)
  const targets = await (await fetch(`http://127.0.0.1:${browserPort}/json/list`)).json()
  const mainTarget = targets.find((t) => t.type === 'page')
  mainClient = cdp(mainTarget.webSocketDebuggerUrl)
  await mainClient.ready
  await mainClient.send('Runtime.enable')
  await mainClient.send('Page.enable')
  mainClient.on((message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      pageErrors.push(message.params.exceptionDetails?.exception?.description ?? 'unknown exception')
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      pageErrors.push(message.params.args?.map((a) => a.value ?? a.description).join(' '))
    }
  })

  await mainClient.send('Page.navigate', { url: APP_URL })
  await waitFor(
    mainClient,
    `!!document.querySelector('#s5-result') || !!document.querySelector('#s5-error')`,
  )

  const resultText = await evaluate(mainClient, `document.querySelector('#s5-result')?.textContent ?? ''`)
  const errorText = await evaluate(mainClient, `document.querySelector('#s5-error')?.textContent ?? ''`)
  if (errorText) throw new Error(errorText)
  if (!resultText) throw new Error('no result produced')

  const result = JSON.parse(resultText)
  const checks = { app_pass: result.pass === true }
  const problems = []

  // every size must produce a matrix artifact and a complete assignment
  for (const size of result.sizes) {
    if (!Array.isArray(size.matrix)) problems.push(`${size.cell}px: no matrix artifact`)
    if (size.assignment.mapping.length !== size.assignment.colors) {
      problems.push(`${size.cell}px: assignment does not cover every color`)
    }
  }

  // the minimum supported cell must exist and clear every gate
  const minReport = result.sizes.find((entry) => entry.cell === result.minSupportedCellPx)
  if (!minReport) {
    problems.push('no cell size passed the launch gates')
  } else {
    if (!minReport.pass) problems.push('min supported cell failed its own gates')
    problems.push(...verifySize(minReport, result.minMarginRatio, result.overrides).map((p) => `${minReport.cell}px: ${p}`))
  }

  checks.min_supported_cell = result.minSupportedCellPx
  checks.matrix_artifact = result.sizes.every((size) => Array.isArray(size.matrix))
  checks.toy_assignment_consumed_matrix = result.sizes.every(
    (size) => size.assignment.mapping.length === size.assignment.colors,
  )
  checks.independent_reverification = problems.length === 0
  checks.page_errors = pageErrors.length === 0

  // glyph contact-sheet artifact
  let sheetBytes = 0
  const sheetUrl = await evaluate(mainClient, `document.querySelector('#s5-sheet')?.src ?? ''`)
  if (sheetUrl.startsWith('data:image/png;base64,')) {
    const png = Buffer.from(sheetUrl.slice('data:image/png;base64,'.length), 'base64')
    mkdirSync(join(ROOT, 'results'), { recursive: true })
    writeFileSync(join(ROOT, 'results', 'spike5-glyph-sheet.png'), png)
    sheetBytes = png.length
  } else {
    problems.push('glyph sheet artifact missing')
  }

  const pass = Object.values(checks).every((value) => value !== false) && problems.length === 0
  mkdirSync(join(ROOT, 'results'), { recursive: true })
  writeFileSync(join(ROOT, 'results', 'spike5-browser-result.json'), JSON.stringify({
    pass,
    checks,
    problems,
    result,
    minReport,
    chrome: CHROME,
    node: process.version,
    ranAt: new Date().toISOString(),
  }, null, 2))

  console.log(`cells: ${result.sizes.map((s) => `${s.cell}px:${s.pass ? 'PASS' : 'fail'}`).join(' ')}`)
  console.log(`min supported cell: ${result.minSupportedCellPx} px (noise floor ${minReport?.noiseFloor})`)
  for (const size of result.sizes) {
    console.log(
      `  ${String(size.cell).padStart(2)}px  floor=${size.noiseFloor.toFixed(4)}`
        + `  min=${size.finalMinOffDiagonal.toFixed(4)}`
        + `  margin=${size.marginRatio.toFixed(1)}x`
        + `  assignment=${size.assignment.minNeighborDistance.toFixed(4)}`,
    )
  }
  console.log(`checks: ${JSON.stringify(checks)}`)
  if (problems.length) console.log('problems:', problems)
  if (sheetBytes) console.log(`glyph sheet: results/spike5-glyph-sheet.png (${sheetBytes} bytes)`)

  if (pageErrors.length) {
    console.error('page errors:', pageErrors)
    cleanup(1)
  }
  console.log(`${pass ? '✅ PASS' : '❌ FAIL'} — wrote results/spike5-browser-result.json`)
  cleanup(pass ? 0 : 1)
} catch (error) {
  if (mainClient) {
    try {
      const status = await evaluate(mainClient, `document.querySelector('#s5-status')?.textContent ?? ''`)
      const appError = await evaluate(mainClient, `document.querySelector('#s5-error')?.textContent ?? ''`)
      console.error(`main page status: ${status}${appError ? `\nmain page error: ${appError}` : ''}`)
    } catch {}
  }
  if (pageErrors.length) console.error('page errors:', pageErrors)
  console.error(error.message ?? error)
  cleanup(1)
}
