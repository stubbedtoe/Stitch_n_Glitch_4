#!/usr/bin/env node
/**
 * Headless-Chrome driver for the browser benchmark (zero dependencies —
 * uses Node's built-in fetch + WebSocket against the Chrome DevTools protocol).
 *
 * Prereqs: `npm run build && npm run preview` serving the app (default
 * http://localhost:4173), and Google Chrome installed.
 *
 *   node scripts/run-browser-bench.mjs [runs]
 *
 * Opens the app at /?auto=1&runs=N, waits for window.__BENCH_DONE__, saves
 * {results, fps} to results/browser-results.json, and exits non-zero on
 * page errors or timeout.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RUNS = process.argv[2] ?? process.env.RUNS ?? '15'
const WARMUP = process.env.WARMUP ?? '3'
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173'
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 30 * 60 * 1000)

if (!existsSync(CHROME)) {
  console.error(`Chrome not found at ${CHROME} — set CHROME_PATH`)
  process.exit(1)
}

const profile = mkdtempSync(join(tmpdir(), 'sng-spike1-'))
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

const cleanup = (code) => {
  try {
    chrome.kill('SIGKILL')
  } catch {}
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {}
  process.exit(code)
}
process.on('SIGINT', () => cleanup(2))

async function devtoolsPort() {
  const portFile = join(profile, 'DevToolsActivePort')
  for (let i = 0; i < 100; i++) {
    if (existsSync(portFile)) {
      const port = Number(readFileSync(portFile, 'utf8').split('\n')[0])
      if (port > 0) return port
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('DevToolsActivePort never appeared')
}

/** Minimal CDP client over the built-in WebSocket. */
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  const listeners = []
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    } else if (msg.method) {
      for (const l of listeners) l(msg)
    }
  }
  const ready = new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  return {
    ready,
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const msgId = ++id
        pending.set(msgId, { resolve, reject })
        ws.send(JSON.stringify({ id: msgId, method, params }))
      }),
    on: (l) => listeners.push(l),
    close: () => ws.close(),
  }
}

const main = async () => {
  const port = await devtoolsPort()
  // find the about:blank page target
  let target
  for (let i = 0; i < 50 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      target = list.find((t) => t.type === 'page')
    } catch {}
    if (!target) await new Promise((r) => setTimeout(r, 200))
  }
  if (!target) throw new Error('no page target found')

  const client = cdp(target.webSocketDebuggerUrl)
  await client.ready
  await client.send('Runtime.enable')
  await client.send('Page.enable')

  const pageErrors = []
  client.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push(msg.params.exceptionDetails?.exception?.description ?? 'unknown exception')
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      pageErrors.push(msg.params.args?.map((a) => a.value ?? a.description).join(' '))
    }
  })

  const url = `${BASE_URL}/?auto=1&runs=${RUNS}&warmup=${WARMUP}`
  console.log(`navigating: ${url}`)
  await client.send('Page.navigate', { url })

  const t0 = Date.now()
  let done = false
  while (!done && Date.now() - t0 < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 3000))
    const r = await client.send('Runtime.evaluate', {
      expression: 'window.__BENCH_DONE__ === true',
      returnByValue: true,
    })
    done = r.result.value === true
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0)
    const status = await client.send('Runtime.evaluate', {
      expression: 'document.getElementById("progress")?.textContent ?? ""',
      returnByValue: true,
    })
    process.stdout.write(`\r[${elapsed}s] ${status.result.value ?? ''}        `)
  }
  console.log('')
  if (!done) throw new Error(`timeout after ${TIMEOUT_MS / 60000} min`)

  const payload = await client.send('Runtime.evaluate', {
    expression: 'JSON.stringify({ results: window.__RESULTS__, fps: window.__FPS__ })',
    returnByValue: true,
  })
  const data = JSON.parse(payload.result.value)
  if (pageErrors.length) {
    console.error('page errors:', pageErrors)
    throw new Error('page reported errors')
  }

  mkdirSync(new URL('../results/', import.meta.url), { recursive: true })
  const out = new URL(`../results/browser-results.json`, import.meta.url)
  writeFileSync(out, JSON.stringify(data.results, null, 2))
  console.log(`fps: ${JSON.stringify(data.fps)}`)
  const h = data.results.cells.reduce((a, b) => (b.total.p95 > a.total.p95 ? b : a))
  console.log(`headline (worst cell ${h.label}): total P95 = ${h.total.p95.toFixed(0)} ms`)
  console.log(`wrote ${out.pathname}`)
  client.close()
  cleanup(0)
}

main().catch((err) => {
  console.error(err.message ?? err)
  cleanup(1)
})
