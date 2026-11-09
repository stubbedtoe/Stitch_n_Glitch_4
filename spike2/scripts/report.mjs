// Aggregate results/*.json into the gate table used in the README.

import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RESULTS = join(dirname(fileURLToPath(import.meta.url)), "..", "results");

const files = (await readdir(RESULTS)).filter((f) => f.endsWith(".json") && f !== "summary.json");
for (const f of files.sort()) {
  const r = JSON.parse(await readFile(join(RESULTS, f), "utf8"));
  const browser = f.replace(".json", "");
  if (r.error) {
    console.log(`${browser}: ERROR — ${r.error}`);
    continue;
  }
  console.log(`\n## ${browser} (${r.userAgent})`);
  console.log("| Mode | Amount | First-try decode | Retry fired | P50 | P95 | Max | Exhausted | Gate |");
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :-: |");
  for (const a of r.aggregate) {
    const verdict = a.p95 <= 3 && a.exhaustedPct === 0 ? "✅" : a.exhaustedPct === 0 ? "⚠️ p95>3" : "❌";
    console.log(
      `| ${a.mode} | ${a.amount} | ${((a.firstAttemptOk / a.n) * 100).toFixed(1)}% | ${a.retryFiredPct.toFixed(1)}% | ${a.p50} | ${a.p95} | ${a.max} | ${a.exhaustedPct.toFixed(1)}% | ${verdict} |`,
    );
  }
  const cross = r.crosscheck ?? [];
  const agree = cross.filter((c) => c.viaImg === null || c.viaImg === c.viaBitmap).length;
  console.log(`\n<img> decode cross-check agreement with createImageBitmap: ${agree}/${cross.length}`);
}
