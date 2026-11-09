// S2 harness: runs the corruption × decode matrix with the AC-F030-03 retry loop
// (next seed until decodable, max MAX_ATTEMPTS; the original file is never modified),
// then POSTs the results to the local server.

import { buildCorpus } from "./corpus.js";
import { MODES } from "./corrupt.js";
import { tryDecode, tryImgDecode } from "./decode.js";
import { crc32, adler32 } from "./crc.js";
import { makeRng } from "./prng.js";
import { parsePngChunks, findJpegEntropyRange } from "./corrupt.js";
import { encodeBmp, encodeTga, decodeTgaStrict } from "./corpus.js";

const SEEDS_PER_CELL = 40;
const MAX_ATTEMPTS = 10; // retry loop cap; 10 = exhausted (never converged)
const CONCURRENCY = 8;
const IMG_CROSSCHECK_SAMPLES = 50;

const progress = (msg) => {
  document.getElementById("progress").textContent = msg;
  fetch(`/log?m=${encodeURIComponent(msg)}`).catch(() => {});
};

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

// ---------------------------------------------------------------- self-tests --

function selfTests(corpus) {
  const failures = [];
  const check = (name, cond) => {
    if (!cond) failures.push(name);
  };

  // CRC32 known vector
  check("crc32 vector", crc32(new TextEncoder().encode("123456789")) === 0xcbf43926);
  // Adler32 known vector
  check("adler32 vector", adler32(new TextEncoder().encode("Wikipedia")) === 0x11e60398);

  // PRNG determinism
  const a = makeRng(42);
  const b = makeRng(42);
  let same = true;
  for (let i = 0; i < 100; i++) if (a.next() !== b.next()) same = false;
  check("prng determinism", same);

  // PNG chunk walk covers the whole file exactly
  const pngBytes = corpus.files.png.bytes;
  let pos = 8;
  let sawIdat = false;
  while (pos + 12 <= pngBytes.length) {
    const len =
      ((pngBytes[pos] << 24) | (pngBytes[pos + 1] << 16) | (pngBytes[pos + 2] << 8) | pngBytes[pos + 3]) >>>
      0;
    const type = String.fromCharCode(pngBytes[pos + 4], pngBytes[pos + 5], pngBytes[pos + 6], pngBytes[pos + 7]);
    if (type === "IDAT") sawIdat = true;
    pos += 12 + len;
  }
  check("png chunk walk", pos === pngBytes.length && sawIdat);

  // Corpus decodes cleanly before any corruption
  // (verified in the matrix preamble — see baseline below)

  // BMP/TGA encoders round-trip dimensions through the strict decoder
  const ctx = document.createElement("canvas");
  ctx.width = 8;
  ctx.height = 6;
  const c2 = ctx.getContext("2d");
  c2.fillStyle = "#336699";
  c2.fillRect(0, 0, 8, 6);
  const id = c2.getImageData(0, 0, 8, 6);
  const bmp = encodeBmp(id);
  check("bmp magic", bmp[0] === 0x42 && bmp[1] === 0x4d);
  const tga = encodeTga(id);
  const tgaInfo = decodeTgaStrict(tga);
  check("tga round-trip", tgaInfo.width === 8 && tgaInfo.height === 6);

  // JPEG structure: entropy range is inside the file and non-trivial
  const [lo, hi] = findJpegEntropyRange(corpus.files.jpeg.bytes);
  check("jpeg entropy range", lo > 64 && hi > lo && hi <= corpus.files.jpeg.bytes.length - 2);

  // Baseline: uncorrupted corpus decodes via the probe
  return failures;
}

// ------------------------------------------------------------------ matrix ----

async function runSample(mode, corpusFile, amount, seed) {
  // AC-F030-03 retry loop: next seed on decode failure; original never modified.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let corrupted;
    try {
      corrupted = await MODES[mode].run(corpusFile.bytes, amount, seed + attempt - 1);
    } catch {
      continue; // corruption step itself rejected (e.g. inflate broke) -> re-roll
    }
    const ok = await tryDecode(MODES[mode].format, { bytes: corrupted, mime: corpusFile.mime });
    if (ok) return { attempts: attempt, converged: true };
  }
  return { attempts: MAX_ATTEMPTS, converged: false };
}

async function main() {
  const browser = new URLSearchParams(location.search).get("browser") || "unknown";
  const corpus = buildCorpus();

  const failures = selfTests(corpus);
  if (failures.length > 0) {
    await postResult(browser, { error: `self-tests failed: ${failures.join(", ")}` });
    progress(`SELF-TESTS FAILED: ${failures.join(", ")}\nYou may close this tab.`);
    return;
  }

  // Baseline decode check of the uncorrupted corpus
  for (const [fmt, entry] of Object.entries(corpus.files)) {
    const ok = await tryDecode(fmt, entry);
    if (!ok) {
      await postResult(browser, { error: `baseline decode failed for ${fmt}` });
      progress(`BASELINE DECODE FAILED: ${fmt}\nYou may close this tab.`);
      return;
    }
  }

  const cells = [];
  for (const [mode, def] of Object.entries(MODES)) {
    for (const amount of def.amounts) {
      cells.push({ mode, amount });
    }
  }
  const total = cells.length * SEEDS_PER_CELL;
  let done = 0;
  let cellIdx = 0;

  const samples = []; // per-sample rows for the raw results JSON
  const crosscheckQueue = [];

  async function worker() {
    while (cellIdx < cells.length) {
      const cell = cells[cellIdx++];
      const corpusFile = corpus.files[MODES[cell.mode].format];
      for (let seed = 0; seed < SEEDS_PER_CELL; seed++) {
        const r = await runSample(cell.mode, corpusFile, cell.amount, seed);
        samples.push({ mode: cell.mode, amount: cell.amount, seed, attempts: r.attempts, converged: r.converged });
        done++;
        if (done % 50 === 0) progress(`[${browser}] ${done}/${total} samples…`);
        // Queue a cross-check of the FIRST attempt file for a subset of samples.
        if (crosscheckQueue.length < IMG_CROSSCHECK_SAMPLES && seed % 8 === 0 && cell.mode !== "png-idat-zlib") {
          crosscheckQueue.push({ mode: cell.mode, corpusFile, amount: cell.amount, seed });
        }
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // <img> decode cross-check on first-attempt files (createImageBitmap sanity)
  const crosscheck = [];
  for (const q of crosscheckQueue) {
    let corrupted = null;
    try {
      corrupted = await MODES[q.mode].run(q.corpusFile.bytes, q.amount, q.seed);
    } catch {
      continue;
    }
    const viaBitmap = await tryDecode(MODES[q.mode].format, { bytes: corrupted, mime: q.corpusFile.mime });
    let viaImg = null;
    if (MODES[q.mode].format !== "tga") viaImg = await tryImgDecode(corrupted, q.corpusFile.mime);
    crosscheck.push({ mode: q.mode, viaBitmap, viaImg });
  }

  // ------------------------------------------------------------- aggregate --
  const aggregate = {};
  for (const s of samples) {
    const key = `${s.mode}@${s.amount}`;
    (aggregate[key] ??= { mode: s.mode, amount: s.amount, n: 0, attempts: [], converged: 0 });
    const a = aggregate[key];
    a.n++;
    a.attempts.push(s.attempts);
    if (s.converged) a.converged++;
  }
  for (const a of Object.values(aggregate)) {
    a.attempts.sort((x, y) => x - y);
    a.firstAttemptOk = a.attempts.filter((x) => x === 1).length;
    a.p50 = percentile(a.attempts, 50);
    a.p95 = percentile(a.attempts, 95);
    a.max = a.attempts[a.attempts.length - 1];
    a.retryFiredPct = ((a.n - a.firstAttemptOk) / a.n) * 100;
    a.exhaustedPct = ((a.n - a.converged) / a.n) * 100;
    delete a.attempts;
  }

  const ua = navigator.userAgent;
  const result = {
    browser,
    userAgent: ua,
    seedsPerCell: SEEDS_PER_CELL,
    maxAttempts: MAX_ATTEMPTS,
    samples,
    aggregate: Object.values(aggregate).sort((x, y) => (x.mode + x.amount).localeCompare(y.mode + y.amount)),
    crosscheck,
    timingMs: Date.now() - t0,
  };
  await postResult(browser, result);
  const pass = Object.values(aggregate).every((a) => a.p95 <= 3 && a.exhaustedPct === 0);
  progress(
    `DONE — [${browser}] ${total} samples, cross-checks: ${crosscheck.length}. ` +
      `Gate (all cells P95 ≤ 3 attempts, 0% exhausted): ${pass ? "PASS" : "FAIL"}\n` +
      `Results posted. You may close this tab.`,
  );
  document.getElementById("progress").classList.add("done");
}

const t0 = Date.now();

async function postResult(browser, result) {
  await fetch(`/result/${encodeURIComponent(browser)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result),
  });
}

main().catch(async (err) => {
  progress(`HARNESS ERROR: ${err.stack || err}\nYou may close this tab.`);
  try {
    await postResult(new URLSearchParams(location.search).get("browser") || "unknown", {
      error: String(err.stack || err),
    });
  } catch {}
});
