#!/usr/bin/env node
/**
 * Headless gate for Spike S4.
 *
 * Starts a local Spaces-alpha PDS, creates/reuses a test account, serves the
 * Gleam app, runs the ATProto OAuth DPoP flow in Chrome, relays the
 * loopback authorization callback, then verifies a custom
 * online.stitchnglitch.* record round trip through OAuth-authenticated XRPC.
 *
 * The app itself is Gleam; this file is only the local PDS/browser harness.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'
import { generateKeyPairSync } from 'node:crypto'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const DIST = join(ROOT, 'dist')
const PUBLIC = join(ROOT, 'public')
const PDS_DIR = join(ROOT, '.pds')
const PDS_ENV = join(PDS_DIR, 'pds.env')
const ACCOUNT_FILE = join(PDS_DIR, 'account.json')
const PDS_HOST = '127.0.0.1'
const PDS_PORT = 2583
const PDS_URL = `http://localhost:${PDS_PORT}`
const APP_HOST = 'localhost'
const APP_PORT = 4173
const APP_URL = `http://${APP_HOST}:${APP_PORT}`
const REDIRECT_URI = `http://127.0.0.1:${APP_PORT}/callback`
const SCOPE = 'atproto transition:generic'
const CLIENT_ID = `http://localhost?scope=${encodeURIComponent(SCOPE)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
const IMAGE = 'ghcr.io/bluesky-social/atproto:pds-spaces-alpha'
const CONTAINER = 'sng-spike4-pds'
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 120_000)

if (!existsSync(CHROME)) {
  console.error(`Chrome not found at ${CHROME} — set CHROME_PATH`)
  process.exit(1)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.error) throw result.error
  return result
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: response.status, body, headers: response.headers }
}

async function xrpc(method, body, token = null) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  return fetchJson(`${PDS_URL}/xrpc/${method}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

function ensurePdsEnv() {
  mkdirSync(PDS_DIR, { recursive: true })
  mkdirSync(join(PDS_DIR, 'blocks'), { recursive: true })
  if (existsSync(PDS_ENV)) return

  const privateKey = generateKeyPairSync('ec', { namedCurve: 'secp256k1' })
    .privateKey.export({ format: 'jwk' })
  const plcKey = Buffer.from(privateKey.d, 'base64url').toString('hex')
  const jwtSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')

  writeFileSync(PDS_ENV, [
    'PDS_HOSTNAME=localhost',
    `PDS_PORT=${PDS_PORT}`,
    'PDS_DEV_MODE=true',
    'PDS_DATA_DIRECTORY=/pds',
    'PDS_BLOBSTORE_DISK_LOCATION=/pds/blocks',
    `PDS_JWT_SECRET=${jwtSecret}`,
    'PDS_ADMIN_PASSWORD=spike4-admin-password',
    `PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX=${plcKey}`,
    'PDS_INVITE_REQUIRED=false',
    'PDS_RATE_LIMITS_ENABLED=false',
    'PDS_SERVICE_NAME=StitchNGlitch Spike 4 PDS',
    'PDS_CONTACT_EMAIL_ADDRESS=spike4@example.test',
    '',
  ].join('\n'))
}

async function waitForPds() {
  const start = Date.now()
  while (Date.now() - start < TIMEOUT_MS) {
    try {
      const health = await fetchJson(`${PDS_URL}/xrpc/_health`)
      if (health.status === 200 && health.body?.version) return health.body.version
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('PDS did not become healthy')
}

async function startPds() {
  ensurePdsEnv()
  run('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' })
  const started = run('docker', [
    'run', '-d',
    '--name', CONTAINER,
    '--platform', 'linux/amd64',
    '--env-file', PDS_ENV,
    '-p', `${PDS_HOST}:${PDS_PORT}:2583`,
    '-v', `${PDS_DIR}:/pds`,
    IMAGE,
  ])
  if (started.status !== 0) {
    throw new Error(`could not start PDS container:\n${started.stderr || started.stdout}`)
  }
  return waitForPds()
}

async function ensureAccount() {
  let account = existsSync(ACCOUNT_FILE)
    ? JSON.parse(readFileSync(ACCOUNT_FILE, 'utf8'))
    : null

  const session = await xrpc('com.atproto.server.createSession', {
    identifier: 'spike4.test',
    password: 'spike4-password',
  })

  if (session.status === 200) {
    const didDoc = session.body.didDoc ?? account?.didDoc
    if (!didDoc) throw new Error('existing account session did not include a DID document')
    account = { did: session.body.did, handle: session.body.handle, didDoc }
  } else {
    const created = await xrpc('com.atproto.server.createAccount', {
      handle: 'spike4.test',
      email: 'spike4@example.test',
      password: 'spike4-password',
    })
    if (created.status !== 200) {
      throw new Error(`could not create/reuse spike account: ${JSON.stringify(created.body)}`)
    }
    account = {
      did: created.body.did,
      handle: created.body.handle,
      didDoc: created.body.didDoc,
    }
  }

  writeFileSync(ACCOUNT_FILE, JSON.stringify(account, null, 2))
  writeFileSync(join(PUBLIC, account.did), JSON.stringify(account.didDoc, null, 2))
  writeFileSync(join(PUBLIC, 's4-config.json'), JSON.stringify({
    did: account.did,
    handle: account.handle,
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    plcDirectory: APP_URL,
    relayUrl: `${APP_URL}/__s4_callback`,
    collection: 'online.stitchnglitch.spike',
    rkey: 'self',
    expectedName: 'S4 OAuth Lexicon round trip',
    expectedSeed: 42,
  }, null, 2))
  return account
}

function serveDist() {
  let callbackQuery = null
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', APP_URL)
    const pathname = decodeURIComponent(url.pathname)

    if (pathname === '/callback') {
      callbackQuery = url.search.startsWith('?') ? url.search.slice(1) : url.search
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      response.end('S4 OAuth callback captured. Return to the first tab.\n')
      return
    }

    if (pathname === '/__s4_callback') {
      const payload = url.searchParams.get('payload')
      if (payload != null) callbackQuery = payload
      if (process.env.DEBUG_RELAY) console.log(`relay request: ${request.url} -> ready=${callbackQuery != null}`)
      const body = JSON.stringify({ ready: callbackQuery != null, query: callbackQuery ?? '' })
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
      })
      response.end(body)
      return
    }

    const relative = pathname === '/' ? 'index.html' : pathname.slice(1)
    const file = normalize(join(DIST, relative))
    if (!file.startsWith(DIST)) {
      response.writeHead(403).end('forbidden')
      return
    }
    try {
      const body = readFileSync(file)
      const type = file.includes('/did:plc:')
        ? 'application/json; charset=utf-8'
        : ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8' }[extname(file)] ?? 'application/octet-stream')
      response.writeHead(200, { 'content-type': type })
      response.end(body)
    } catch {
      response.writeHead(404).end('not found')
    }
  })

  return new Promise((resolveServer) => {
    server.listen(APP_PORT, PDS_HOST, () => resolveServer({ server, reset: () => { callbackQuery = null } }))
  })
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

async function evaluateAwait(client, expression) {
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

async function targetByUrl(port, predicate) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  return targets.find(predicate)
}

async function authorizeOnPds(port, authUrl) {
  const created = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(authUrl)}`, { method: 'PUT' })).json()
  const authClient = cdp(created.webSocketDebuggerUrl)
  await authClient.ready
  await authClient.send('Runtime.enable')
  await authClient.send('Page.enable')

  // The reference PDS authorization UI is a React app. Drive it through the
  // DOM: sign in with the deterministic test account, then authorize the
  // loopback public client.
  await waitFor(authClient, 'document.readyState === "complete"')
  await waitFor(authClient, `!!document.querySelector('input')`)

  const bodySummary = async () => evaluate(authClient, `JSON.stringify({
    url: location.href,
    text: document.body.innerText,
    inputs: Array.from(document.querySelectorAll('input')).map(i => ({name:i.name,id:i.id,type:i.type,placeholder:i.placeholder})),
    buttons: Array.from(document.querySelectorAll('button')).map(b => ({text:b.innerText,type:b.type,disabled:b.disabled,formAction:b.formAction,outer:b.outerHTML.slice(0,220)}))
  })`)

  let signedIn = false
  for (let i = 0; i < 20 && !signedIn; i++) {
    const summary = JSON.parse(await bodySummary())
    console.log(`auth page [${i}]:`, summary.text.split('\n').slice(0, 8).join(' | '))
    if (process.env.DEBUG_AUTH) {
      console.log(`auth controls [${i}]:`, JSON.stringify({ inputs: summary.inputs, buttons: summary.buttons }))
    }

    if (summary.buttons.some((b) => /authorize|allow|continue/i.test(b.text))) {
      const submitResult = JSON.parse(await evaluateAwait(authClient, `(async () => {
        const csrfMatch = document.cookie.match(/(?:^|; )csrf-token=([^;]+)/)
        if (!csrfMatch) throw new Error('csrf cookie not found')
        const scope = window.__authorizeData?.scope ?? ${JSON.stringify(SCOPE)}
        const response = await fetch('/@atproto/oauth-provider/~api/consent', {
          method: 'POST',
          mode: 'same-origin',
          credentials: 'same-origin',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': decodeURIComponent(csrfMatch[1]),
          },
          body: JSON.stringify({ did: ${JSON.stringify(account.did)}, scope }),
        })
        return JSON.stringify({
          status: response.status,
          location: null,
          text: (await response.text()).slice(0, 1000),
        })
      })()`))
      const consent = JSON.parse(submitResult.text)
      console.log(`PDS consent response: ${submitResult.text}`)
      if (submitResult.status === 200 && consent.url) {
        const consentUrl = new URL(consent.url)
        const callbackUrl = new URL(REDIRECT_URI)
        for (const key of ['code', 'state', 'iss', 'error', 'error_description']) {
          if (consentUrl.searchParams.has(key)) {
            callbackUrl.searchParams.set(key, consentUrl.searchParams.get(key))
          }
        }
        console.log(`navigating OAuth callback: ${callbackUrl.toString()}`)
        await authClient.send('Page.navigate', { url: callbackUrl.toString() })
      } else {
        throw new Error(`authorize consent failed: ${JSON.stringify(submitResult)}`)
      }
      const start = Date.now()
      while (Date.now() - start < 15_000) {
        const url = await evaluate(authClient, 'location.href')
        if (url.startsWith(REDIRECT_URI)) break
        await new Promise((r) => setTimeout(r, 300))
      }
      signedIn = true
      break
    }

    const hasPassword = await evaluate(authClient, `!!document.querySelector('input[type="password"]')`)
    if (hasPassword) {
      const signInResult = JSON.parse(await evaluateAwait(authClient, `(async () => {
        const csrfMatch = document.cookie.match(/(?:^|; )csrf-token=([^;]+)/)
        if (!csrfMatch) throw new Error('csrf cookie not found')
        const response = await fetch('/@atproto/oauth-provider/~api/sign-in', {
          method: 'POST',
          mode: 'same-origin',
          credentials: 'same-origin',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': decodeURIComponent(csrfMatch[1]),
          },
          body: JSON.stringify({
            username: 'spike4.test',
            password: 'spike4-password',
            remember: true,
            locale: 'en',
          }),
        })
        return JSON.stringify({
          status: response.status,
          text: (await response.text()).slice(0, 1000),
        })
      })()`))
      console.log(`PDS sign-in response: ${signInResult.text}`)
      if (signInResult.status !== 200) {
        throw new Error(`PDS sign-in failed: ${JSON.stringify(signInResult)}`)
      }
      await authClient.send('Page.navigate', { url: authUrl })
    }

    await new Promise((r) => setTimeout(r, 700))
    const url = await evaluate(authClient, 'location.href')
    if (url.startsWith('http://127.0.0.1:4173/callback')) signedIn = true
  }

  await authClient.close()
}

const pdsVersion = await startPds()
console.log(`Spaces PDS ${pdsVersion} on ${PDS_URL}`)
const account = await ensureAccount()
console.log(`test account ${account.handle} (${account.did})`)

const build = run('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
if (build.status !== 0) process.exit(1)

const { server, reset } = await serveDist()
console.log(`serving Gleam app on ${APP_URL}`)
reset()

const profile = mkdtempSync(join(tmpdir(), 'sng-spike4-'))
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
let browserPort = null
let mainClient = null

const cleanup = (code) => {
  try { chrome.kill('SIGKILL') } catch {}
  try { rmSync(profile, { recursive: true, force: true }) } catch {}
  server.close()
  run('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' })
  process.exit(code)
}
process.on('SIGINT', () => cleanup(2))

try {
  browserPort = await chromePort(profile)
  const mainTarget = await targetByUrl(browserPort, (t) => t.type === 'page')
  mainClient = cdp(mainTarget.webSocketDebuggerUrl)
  await mainClient.ready
  await mainClient.send('Runtime.enable')
  await mainClient.send('Page.enable')
  await mainClient.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.addEventListener('unhandledrejection', e => console.error('UNHANDLED REJECTION: ' + (e.reason?.stack ?? e.reason))); window.addEventListener('error', e => console.error('WINDOW ERROR: ' + (e.error?.stack ?? e.message)))`,
  })
  mainClient.on((message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      pageErrors.push(message.params.exceptionDetails?.exception?.description ?? 'unknown exception')
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      pageErrors.push(message.params.args?.map((a) => a.value ?? a.description).join(' '))
    }
  })

  await mainClient.send('Page.navigate', { url: APP_URL })
  await waitFor(mainClient, `!!document.querySelector('#s4-auth-url') || !!document.querySelector('#s4-error')`)

  const authUrl = await evaluate(mainClient, `document.querySelector('#s4-auth-url')?.href ?? ''`)
  if (!authUrl) {
    const appError = await evaluate(mainClient, `document.querySelector('#s4-error')?.textContent ?? 'unknown app error'`)
    throw new Error(`OAuth flow did not produce an authorization URL: ${appError}`)
  }
  console.log('authorization URL issued (PAR + DPoP/PKCE accepted)')

  await authorizeOnPds(browserPort, authUrl)
  const relayAfterAuth = await fetchJson(`${APP_URL}/__s4_callback`)
  console.log(`callback relay after authorize: ${JSON.stringify(relayAfterAuth.body)}`)
  const resultStart = Date.now()
  let lastStatus = ''
  while (Date.now() - resultStart < TIMEOUT_MS) {
    const resultTextNow = await evaluate(mainClient, `document.querySelector('#s4-result')?.textContent ?? ''`)
    const errorTextNow = await evaluate(mainClient, `document.querySelector('#s4-error')?.textContent ?? ''`)
    if (resultTextNow || errorTextNow) break
    const statusNow = await evaluate(mainClient, `document.querySelector('#s4-status')?.textContent ?? ''`)
    if (statusNow !== lastStatus || (Date.now() - resultStart) % 5000 < 300) {
      console.log(`app status: ${statusNow}`)
      lastStatus = statusNow
    }
    await new Promise((r) => setTimeout(r, 500))
  }

  const resultText = await evaluate(mainClient, `document.querySelector('#s4-result')?.textContent ?? ''`)
  const errorText = await evaluate(mainClient, `document.querySelector('#s4-error')?.textContent ?? ''`)
  if (errorText) throw new Error(errorText)

  const result = JSON.parse(resultText)
  const checks = {
    oauth_dpop: result.auth === 'atproto-oauth-dpop' && result.scope === SCOPE,
    account_identity: result.did === account.did && result.handle === account.handle,
    spaces_pds: result.pds === PDS_URL && result.issuer === PDS_URL,
    custom_lexicon_write: result.writeUri === `at://${account.did}/online.stitchnglitch.spike/self`,
    custom_lexicon_read: result.readUri === result.writeUri && result.readCid === result.writeCid,
    round_trip_verified: result.roundTripVerified === true && result.readSeed === 42,
  }
  const pass = Object.values(checks).every(Boolean)
  const output = {
    pass,
    checks,
    result,
    pds: { image: IMAGE, version: pdsVersion, url: PDS_URL },
    account: { handle: account.handle, did: account.did },
    chrome: CHROME,
    node: process.version,
    ranAt: new Date().toISOString(),
  }
  mkdirSync(join(ROOT, 'results'), { recursive: true })
  writeFileSync(join(ROOT, 'results', 'spike4-browser-result.json'), JSON.stringify(output, null, 2))

  console.log(`result: did=${result.did}`)
  console.log(`record: ${result.writeUri}`)
  console.log(`cid: ${result.writeCid}`)
  console.log(`checks: ${JSON.stringify(checks)}`)
  console.log(`${pass ? '✅ PASS' : '❌ FAIL'} — wrote results/spike4-browser-result.json`)

  if (pageErrors.length) {
    console.error('page errors:', pageErrors)
    cleanup(1)
  }
  cleanup(pass ? 0 : 1)
} catch (error) {
  if (mainClient) {
    try {
      const status = await evaluate(mainClient, `document.querySelector('#s4-status')?.textContent ?? ''`)
      const appError = await evaluate(mainClient, `document.querySelector('#s4-error')?.textContent ?? ''`)
      console.error(`main page status: ${status}${appError ? `\nmain page error: ${appError}` : ''}`)
    } catch {}
  }
  if (pageErrors.length) console.error('page errors:', pageErrors)
  console.error(error.message ?? error)
  cleanup(1)
}
