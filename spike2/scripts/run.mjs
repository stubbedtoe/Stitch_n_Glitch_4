// S2 runner: starts the harness server, drives each target browser (NFR-C1) at the
// harness page, waits for the results POST, writes results/<browser>.json, and prints
// a gate summary. Chrome/Firefox run headless; Safari runs windowed via `open -a`
// (it has no headless mode) and reports on-page when done.

import { spawn, execFile } from "node:child_process";
import { mkdir, access, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../server.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FIREFOX = "/Applications/Firefox.app/Contents/MacOS/firefox";
const SAFARI = "/Applications/Safari.app/Contents/MacOS/Safari";

const TIMEOUT_MS = {
  chrome: Number(process.env.CHROME_TIMEOUT ?? 300_000),
  firefox: Number(process.env.FIREFOX_TIMEOUT ?? 300_000),
  safari: Number(process.env.SAFARI_TIMEOUT ?? 600_000),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function exists(p) {
  return access(p).then(
    () => true,
    () => false,
  );
}

function launchChrome(url, profileDir) {
  return spawn(
    CHROME,
    [
      "--headless=new",
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--disable-extensions",
      "--disable-background-networking",
      "--window-size=1280,900",
      url,
    ],
    { stdio: "ignore" },
  );
}

function launchFirefox(url, profileDir) {
  return spawn(FIREFOX, ["-headless", "-profile", profileDir, url], {
    stdio: "ignore",
    env: { ...process.env, MOZ_HEADLESS: "1" },
  });
}

function launchSafari(url) {
  // No headless mode: open a windowed tab. The harness page reports completion
  // on-screen; the runner detects the results POST.
  const child = spawn("open", ["-a", "Safari", url], { stdio: "ignore" });
  child.on("exit", () => {});
  return child;
}

async function closeSafariTab(port) {
  await new Promise((resolve) => {
    execFile(
      "osascript",
      [
        "-e",
        `tell application "Safari" to close (tabs of windows whose URL contains "127.0.0.1:${port}")`,
      ],
      () => resolve(),
    );
  });
}

async function runBrowser(key, url, profileRoot) {
  const profileDir = join(profileRoot, key);
  await mkdir(profileDir, { recursive: true }); // Firefox requires the profile dir to exist
  const proc = { chrome: launchChrome, firefox: launchFirefox, safari: launchSafari }[key](
    `${url}?browser=${key}`,
    profileDir,
  );
  const deadline = Date.now() + TIMEOUT_MS[key];
  while (Date.now() < deadline) {
    if (completed.has(key)) {
      if (key === "safari") await closeSafariTab(server.address().port);
      else proc.kill("SIGKILL");
      return completed.get(key);
    }
    await sleep(500);
  }
  if (key !== "safari") proc.kill("SIGKILL");
  throw new Error(`${key}: timed out after ${TIMEOUT_MS[key] / 1000}s`);
}

// ---------------------------------------------------------------------------

const { server, completed } = createServer(join(ROOT, "results"));
await mkdir(join(ROOT, "results"), { recursive: true });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();
const url = `http://127.0.0.1:${port}/`;
console.log(`Harness: ${url}`);

const only = process.argv.slice(2);
const candidates = [
  ["chrome", CHROME],
  ["firefox", FIREFOX],
  ["safari", SAFARI],
].filter(([k, bin]) => (!only.length || only.includes(k)) && true);

const profileRoot = join(ROOT, ".profiles");
await mkdir(profileRoot, { recursive: true });

const results = {};
for (const [key, bin] of candidates) {
  if (!(await exists(bin))) {
    console.log(`SKIP ${key} (not installed at ${bin})`);
    continue;
  }
  process.stdout.write(`RUN  ${key} … `);
  try {
    const r = await runBrowser(key, url, profileRoot);
    results[key] = r;
    if (r.error) console.log(`ERROR: ${r.error}`);
    else console.log(`ok (${r.samples.length} samples, ${r.timingMs} ms)`);
  } catch (err) {
    console.log(String(err.message ?? err));
    results[key] = { error: String(err.message ?? err) };
  }
}

await writeFile(join(ROOT, "results", "summary.json"), JSON.stringify(results, null, 2));

// Gate summary
console.log("\n=== Gate: retry loop converges ≤ 3 attempts (P95), 0% exhausted, per cell ===");
for (const [key, r] of Object.entries(results)) {
  if (r.error) {
    console.log(`\n${key}: ERROR`);
    continue;
  }
  console.log(`\n${key}`);
  for (const a of r.aggregate) {
    const verdict =
      a.p95 <= 3 && a.exhaustedPct === 0 ? "PASS" : a.exhaustedPct === 0 ? "p95>3" : "EXHAUSTED";
    console.log(
      `  ${a.mode.padEnd(14)} amount=${String(a.amount).padEnd(2)} ` +
        `first-try=${String(((a.firstAttemptOk / a.n) * 100).toFixed(1)).padStart(5)}% ` +
        `retry-fired=${a.retryFiredPct.toFixed(1).padStart(5)}% ` +
        `P50=${a.p50} P95=${a.p95} max=${a.max} ` +
        `exhausted=${a.exhaustedPct.toFixed(1)}%  ${verdict}`,
    );
  }
  const cross = r.crosscheck ?? [];
  const agree = cross.filter((c) => c.viaImg === null || c.viaImg === c.viaBitmap).length;
  console.log(`  <img> cross-check agreement: ${agree}/${cross.length}`);
}

server.close();
process.exit(0);
