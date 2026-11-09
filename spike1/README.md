# Spike S1 — thi.ng engine benchmark (NFR-P1)

> **Spike ID:** S1 (Build Plan §3) · **Proves:** NFR-P1 (PRD §4.2) · **Date:** 2026-11-06
> **Question:** Does a TypeScript/thi.ng pipeline convert a 12 MP image to a 300×300 chart in ≤ 5 s (P95) on a mid-range laptop, in a Web Worker, without blocking the UI?

## Verdict

## ✅ PASS

**Headline (worst configuration, browser Web Worker): total P95 = 1054 ms** — 4.7× under the
NFR-P1 budget (5000 ms) and 2.4× under the spike pass bar (2500 ms, the "met with margin" bar
from Build Plan S1). UI remained fully responsive during conversion: **60 fps measured on the
UI thread throughout, 0 jank frames** (idle baseline 53.5 fps in headless Chrome).

| | Budget | Bar | Measured (worst cell P95) |
| --- | --- | --- | --- |
| Total conversion | ≤ 5000 ms (NFR-P1) | ≤ 2500 ms (spike) | **1054 ms** |

## Environment

| | |
| --- | --- |
| Machine | MacBook Air (Mac14,2), Apple M2, 8 GB RAM, fanless |
| Browser | Google Chrome 156 (headless, CDP-driven) |
| Worker | Dedicated module Web Worker (Vite bundle) |
| Node cross-check | Node v23.11.0, darwin/arm64 |

**Mid-range-laptop caveat:** the M2 Air is a reasonable mid-range stand-in (fanless, 8 GB),
but it is not a mid-range Windows laptop. Re-run `npm run bench:browser` on target hardware
before closing the M3 exit criterion ("NFR-P1 re-verified on the real pipeline"); the ~4.7×
headroom leaves ample margin for a slower machine.

## What is measured

Pipeline = the PRD creation critical path (F-003 → F-041 → F-005/F-006), composed from thi.ng
umbrella packages:

1. **decode** — simulated: the synthetic 12 MP source (4000×3000 RGB888 packed buffer) is
   copied into an `@thi.ng/pixel` `IntBuffer` (equivalent to decode-into-bitmap cost).
   Real browser JPEG decode of a 12 MP file is a further ~100–300 ms and runs off-thread via
   `createImageBitmap` in production; it is excluded here and noted as bounded overhead.
2. **resize** — `@thi.ng/pixel` `IntBuffer.resize(300, 300, sampler)`,
   `linear` (bilinear) and `cubic` (bicubic) filtered sampling (F-041).
3. **quantize** (dither off) — per-cell nearest-thread search with **CIEDE2000** over a DMC
   sample palette, 16/32/64 colors (F-005). One bulk sRGB→Lab D50 conversion per image.
4. **dither** (dither on) — **Floyd–Steinberg** error diffusion to the palette using the
   `FLOYD_STEINBERG` kernel from `@thi.ng/pixel-dither`, same CIEDE2000 nearest search (F-006).

Source image: deterministic procedural 12 MP "photo-like" image (layered sinusoid plasma +
noise, seeded PRNG) generated once per session inside the worker — broad color coverage that
exercises the quantizer, no multi-MB binary committed. Timings are data-independent at this
scale (every cell is compared against every palette color).

**Matrix:** 2 samplers × 3 color counts × dither {off, on} = 12 cells; 3 warmup + 15 timed
runs per cell; per-stage and total percentiles (P50/P95/P99/min/max).

## Results — browser (Web Worker), ms per conversion

| Configuration | total P50 | **total P95** | P99 | decode P95 | resize P95 | quantize P95 | dither P95 | ≤ 2500 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :-: |
| linear / 16 colors / dither off | 205 | **240** | 246 | 7 | 5 | 233 | 0 | ✅ |
| linear / 16 colors / dither on | 216 | **283** | 292 | 10 | 2 | 0 | 272 | ✅ |
| linear / 32 colors / dither off | 411 | **475** | 479 | 12 | 3 | 468 | 0 | ✅ |
| linear / 32 colors / dither on | 425 | **511** | 517 | 15 | 3 | 0 | 496 | ✅ |
| linear / 64 colors / dither off | 853 | **1054** | 1180 | 40 | 3 | 1041 | 0 | ✅ |
| linear / 64 colors / dither on | 808 | **930** | 967 | 24 | 3 | 0 | 916 | ✅ |
| cubic / 16 colors / dither off | 224 | **292** | 310 | 14 | 20 | 266 | 0 | ✅ |
| cubic / 16 colors / dither on | 235 | **283** | 283 | 25 | 29 | 0 | 256 | ✅ |
| cubic / 32 colors / dither off | 411 | **497** | 512 | 12 | 43 | 455 | 0 | ✅ |
| cubic / 32 colors / dither on | 412 | **501** | 503 | 9 | 16 | 0 | 480 | ✅ |
| cubic / 64 colors / dither off | 810 | **860** | 868 | 18 | 36 | 813 | 0 | ✅ |
| cubic / 64 colors / dither on | 827 | **880** | 892 | 26 | 20 | 0 | 844 | ✅ |

Run-to-run variance between the two recorded browser runs was small on the headline cell
(982 ms / 1054 ms, ~7%) — far below the margin. Full raw data: `results/browser-results.json`.

**UI responsiveness (NFR-P1 "without blocking the UI"):** the rAF counter on the main thread
measured **60.0 fps during the entire conversion window with 0 frames > 50 ms** (idle
baseline 53.5 fps — headless Chrome vsync). The engine runs entirely in the dedicated worker.

## Results — Node cross-check (same code path), ms per conversion

| Configuration | total P50 | total P95 | resize P95 | quantize P95 | dither P95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| linear / 16 / off | 217 | 293 | 10 | 279 | 0 |
| linear / 16 / on | 231 | 277 | 10 | 0 | 266 |
| linear / 32 / off | 396 | 482 | 9 | 468 | 0 |
| linear / 32 / on | 450 | 555 | 11 | 0 | 535 |
| linear / 64 / off | 866 | 963 | 12 | 933 | 0 |
| linear / 64 / on | 881 | 1010 | 10 | 0 | 983 |
| cubic / 16 / off | 237 | 281 | 47 | 228 | 0 |
| cubic / 16 / on | 270 | 304 | 41 | 0 | 273 |
| cubic / 32 / off | 444 | 556 | 37 | 496 | 0 |
| cubic / 32 / on | 484 | 574 | 54 | 0 | 539 |
| cubic / 64 / off | 807 | 887 | 31 | 849 | 0 |
| cubic / 64 / on | 870 | 916 | 33 | 0 | 877 |

Node agrees with the browser within ~10% — the numbers are engine-bound, not harness-bound.

## Key finding — the CIEDE2000 hot path must be specialized

The single most important spike result is **not** that NFR-P1 passes — it is *how* it passes.

Using `@thi.ng/color`'s `distCIEDE2000()` directly in the per-cell inner loop **misses
NFR-P1**: it performs a Lab D50 conversion of both operands on every call (~800 ns/call at
V8's optimized tiers), putting a 300×300 × 32-color quantization at **~5.5 s** alone
(measured: `scripts/profile-distance.ts`):

| Distance implementation | 90k cells × 32 colors |
| --- | ---: |
| thi.ng `distCIEDE2000()` as-is | 5492 ms |
| Inline converter + `dE00` (this spike) | **439 ms** (12.5×) |

Correctness of the specialization, verified against the umbrella implementation:

- **Formula:** algebraically identical to thi.ng's `distCIEDE2000` — max abs difference
  **7.8e-14 ΔE** over 10,000 random pairs on identical Lab inputs.
- **End-to-end:** the inline sRGB→Lab D50 converter uses thi.ng's exact matrix/whitepoint
  constants (`color/api/constants.js`), so full pipeline output agrees to max **6.8e-6 ΔE**
  over 5,000 random pairs vs `convert(lab50) + distCIEDE2000()`.
- thi.ng remains the engine for buffers/resizing (`@thi.ng/pixel`), the dither kernel
  (`@thi.ng/pixel-dither`), and as the *reference implementation* the inline math is checked
  against. This follows the PRD §8.3 mitigation philosophy ("packages are small and
  forkable"): the hot loop is a specialization, not a re-platforming. The WASM hot-path
  fallback (PRD §7.5) is **not** needed at 16–64 colors.

**Recommendation for M3 (F-005):** wrap the specialized quantizer behind the engine API with
thi.ng's `distCIEDE2000()` as the property-test oracle (the spike's profile script is the
seed of that test). Also budget a follow-up spike or design task for **256-color palettes**
(F-004 upper bound): at ~140 ns/comparison a full scan costs ~3.3 s at 90k cells × 256
colors, so large palettes need a shortlist pre-filter (cheap ΔE76 candidate cut, exact
ΔE00 on survivors) or a Lab-space index. 16–64 colors — the realistic conversion range —
need nothing further.

## Reproduce

```bash
npm install
npm run smoke       # correctness: dims, index ranges, determinism
npm run profile     # ΔE00 agreement + hot-path throughput evidence
npm run bench:node -- 15                      # full matrix in Node
npm run build && npm run preview &            # serve on :4173
node scripts/run-browser-bench.mjs 15         # headless Chrome, real Web Worker
```

The browser harness is also runnable interactively: `npm run dev` → open the page →
"Run benchmark". Optional: `RUNS=20 WARMUP=3 BASE_URL=... CHROME_PATH=... node scripts/run-browser-bench.mjs`.

## Scope notes / known limitations

- **Decode is simulated** (buffer copy); real JPEG/WebP decode adds ~100–300 ms for 12 MP and
  is off-threaded in production. Even adding 300 ms to the worst cell keeps P95 ≈ 1.4 s.
- Palette data is an approximate DMC sample (71 colors); distance-computation cost is
  independent of exact values. Production palette ingestion (F-010) does not change the cost
  model.
- Percentiles are per-cell over 15 runs — enough for a spike gate, thin for formal
  statistics; M3's re-verification (Build Plan §4) should use ≥ 30 runs on target hardware.
- FPS numbers come from headless Chrome (60 Hz virtual vsync); interactive browsers on the
  same hardware measured no jank by construction (zero main-thread work during conversion).
