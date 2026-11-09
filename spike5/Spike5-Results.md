# Spike S5 — Confusability matrix generator

> **Spike ID:** S5 (Build Plan §3) · **Proves:** F-047 / PRD AC-F047-05 confusability-matrix tooling · **Date:** 2026-11-09
> **Question:** Can tooling render each symbol-set glyph at chart-cell size, compute pairwise differences (including an ink-bleed robustness variant), merge curated overrides, and produce a matrix artifact that a max-min assignment consumes — with margin above the measurement noise floor?

## Verdict

## ✅ PASS

**The full matrix pipeline ran in a headless browser with the analysis entirely in Gleam** — the only JavaScript is the canvas `Path2D` rasterizer (a browser primitive) and DOM sinks. A 13-glyph curated SVG symbol library was rasterized at four chart-cell sizes (6/8/12/16 px, screen density plus a 3× print density), pairwise L1 distances were computed per rendering condition, ink-bleed variants (3×-domain gaussian blur and 3×-domain erosion, downsampled back) were merged conservatively, five curated overrides merged, and a deterministic toy max-min assignment consumed the final matrix at every size. The headless gate independently re-verified the matrix (symmetric, zero diagonal, in range), the noise-floor margins, and the assignment.

| Build-plan bar | Result |
| --- | --- |
| Renders each glyph at chart-cell size | ✅ PASS — canvas rasterization of SVG path data at 6/8/12/16 px |
| Computes pairwise differences | ✅ PASS — L1 mean over alpha bitmaps, 13×13 per condition |
| Matrix artifact consumed by a toy max-min assignment | ✅ PASS — greedy max-min over an 8-color path graph at all four sizes; min neighbor distance 0.2135 at the supported cell |
| Ink-bleed robustness variant | ✅ PASS — blur + erosion variants computed in the 3× print domain (1 device px bleed = ⅓ cell px), conservative elementwise minimum |
| Minimum cell size / worst-case px-per-cell | ✅ PASS — measured, not assumed: **16 px cells pass all launch gates (5.2× margin)**; 12 px marginal (1.4×); 8 px and below fail |
| Curated overrides merged | ✅ PASS — 5 overrides applied symmetrically; the toy assignment never places an overridden pair on neighboring colors |

## Headline finding — minimum supported cell size

The point of the spike was to find where the matrix floor sits, and the measurement is decisive:

| Cell | Noise floor (cross-density render variance) | Computed min pair distance | Margin | Launch gates |
| --- | ---: | ---: | ---: | :-: |
| 6 px | 0.0199 | 0.0022 | 0.1× | ❌ (dot vanishes: zero pixels ≥ 50% coverage) |
| 8 px | 0.0225 | 0.0074 | 0.3× | ❌ (erosion merges the diagonal/dot pairs) |
| 12 px | 0.0273 | 0.0380 | 1.4× | ❌ (below the 2× margin bar) |
| **16 px** | **0.0121** | **0.0630** | **5.2×** | ✅ **PASS — candidate minimum supported cell** |

With glyphs whose thinnest features are ~14% of cell height (2.2/16 units), **16 px cells at 100% zoom are the smallest that clear the launch gates with margin** — which lands exactly on AC-F047-05's "screen at 100% zoom is the binding density". 12 px is marginal (1.4× the noise floor — viable only with thicker glyphs), and 8 px is unsupportable with this feature size. This is the input F-009's zoom/legibility design and the symbol-spec minimum-feature-size rule (AC-F047-05) were waiting for.

## Environment

| | |
| --- | --- |
| Machine | MacBook Air (Mac14,2), Apple M2, 8 GB RAM, fanless |
| Browser | Google Chrome 156 (`HeadlessChrome/156.0.0.0`), CDP-driven |
| Gleam | 1.19.2 (target javascript) |
| Deps | gleam_stdlib 1.0.5, gleam_javascript 1.0.1, gleam_json 3.1.0, gleeunit 1.11.0 |
| Node / Vite | v23.11.0 / 6.4.5 |

## What is wired together

```text
src/sng_spike5.gleam              (orchestration, config, report JSON)
  │
  │  gleam/javascript Array boundary (array.from_list / array.to_list)
  ▼
src/sng_spike5_ffi.mjs            (only JS: canvas Path2D fill + DOM sinks)
  rasterize(paths, cell, scale) -> [{width, height, pixels}]
  glyph_sheet(paths, sizes)     -> PNG contact sheet artifact
  │
  ▼  pure Gleam:
src/bitmap.gleam     alpha bitmap, L1 distance, gaussian blur, erosion,
                     box downsample, coverage, O(1) dict sampler for filters
src/matrix.gleam     pairwise matrices, conservative min, curated overrides
src/assignment.gleam deterministic greedy max-min assignment (F-047 seed)
src/symbol_library.gleam  the curated SVG glyph source (single source of truth)
```

Per cell size the app rasterizes three ways — screen density, screen density re-rendered for the noise floor is *not* used; the floor is **cross-density render variance**: L1 between the 1× render and the 3× downsampled render of the same geometry, max over glyphs. That models the rasterizer disagreement AC-F047-05 expects across WebGL/pdf.js/Acrobat, and lands at 0.012–0.027 depending on cell size.

## Results — recorded headless run (2026-11-09)

| Check | Result |
| --- | :-: |
| Pipeline ran at all four cell sizes | ✅ |
| 16 px launch gates (symmetric, zero-diagonal, rendered, floor margins, print variant, assignment) | ✅ all 7 |
| Min supported cell measured | ✅ **16 px** |
| Toy assignment at 16 px (8 colors, path graph) | ✅ min neighbor distance **0.2135**, unique symbols, full coverage |
| Matrix artifact per size (13×13 JSON) | ✅ |
| Curated overrides (5) merged symmetrically | ✅ |
| Independent harness re-verification | ✅ |
| Glyph contact sheet artifact | ✅ `results/spike5-glyph-sheet.png` |
| Page errors | ✅ none |

Per-condition minimum off-diagonal distances at 16 px: plain 0.0875 · blur 0.0903 · erode 0.0630 · print 0.0919 — the conservative launch matrix takes the elementwise minimum (0.0630), so pairs that only survive in *some* rendering conditions are still treated as confusable. The computed matrix correctly flags `cross~slash`/`cross~backslash` as the closest geometric pair (the cross contains both diagonal bands — subset geometry); those are also curated overrides so the assignment never places them on neighboring colors.

Raw artifacts: `results/spike5-browser-result.json`, `results/spike5-glyph-sheet.png`.

## Key findings for milestone design

1. **Gleam can own the entire analysis.** No TypeScript at all in this spike; the FFI is one rasterizer and three DOM sinks. On this stdlib, Gleam lists are *not* JS arrays — cross the boundary via `gleam/javascript/array` (`from_list`/`to_list`) or JS sees a head/tail structure. (S3/S4 used `Dynamic` handles and decoders; arrays are simpler for bulk bitmap data.)
2. **Compute bleed variants in the print domain, not the screen domain.** A 3×3 erosion directly on a 16 px cell annihilates every outline glyph (they all erode to near-blank and become mutually identical — distances collapse to 0). One device pixel of bleed at 3× density = ⅓ cell pixel, which is the physically meaningful simulation and keeps the variants informative.
3. **The measurement noise floor is cross-renderer variance, and it is small.** Screen render vs 3× downsampled render of identical geometry disagrees by 0.012–0.027 L1 — that is the bar distinct pairs must clear, and it is comfortably clearable at 16 px (5.2× margin) but not at 12 px and below with 14%-of-cell features.
4. **Raw pixel distance is blind to mirror/rotation/subset confusables — exactly as theorized.** `slash~backslash` measure far apart pixel-wise yet are the classic confusion; `cross~slash` is pixel-close because the geometry is a subset. Both kinds need curated overrides, and the override mechanism demonstrably feeds the assignment.
5. **The minimum supported cell size is measurable, not guessable.** The dot disappearing at 6 px (zero coverage pixels) and erosion merging pairs at 8 px are exactly the failure modes the launch gate must catch; the gate caught them.
6. **Filters need an O(1) sampler.** Naive list-walk pixel access is O(n²) per convolution and both overflows the stack (non-tail recursion) and crawls at 48×48. One `list.index_fold` into a `Dict` per bitmap fixes both. M3/F-047 tooling should keep this pattern.

## Reproduce

```bash
npm install        # vite only; Gleam deps are standard hex packages
gleam test         # 13 unit tests: metrics, filters, matrix, overrides, assignment
npm run spike      # build + headless-Chrome end-to-end gate with independent re-verification
```

`npm run spike` builds the production bundle, serves it, runs the analysis in headless Chrome, re-checks the Gleam-produced report from Node (matrix symmetry/diagonal/range, noise-floor margins, assignment uniqueness and recomputed min-neighbor distance), saves the JSON + PNG artifacts, and exits non-zero on any failure.

## Scope notes / known limitations

- **Stand-in glyph set.** The 13 glyphs are spike-grade representatives on a 16-unit grid, not the launch library; they exist to prove the tooling and probe the feature-size floor. Launch sets need the full curation pass (colorblind-safe sets per NFR-U2 are out of scope here).
- **Canvas2D rasterizer, not WebGL or a PDF engine.** AC-F047-05's final validation must reproduce matrices across WebGL *and* two PDF engines; this spike proves the generator and its gates, with the cross-density floor as the variance model. Swapping the rasterizer behind the FFI is the verification path.
- **L1 on alpha coverage is the whole metric.** No perceptual weighting (center emphasis, stroke-orientment sensitivity); curated overrides are the pressure valve until M5's launch validation adds a perceptual metric if needed.
- **Toy assignment, not F-047.** Greedy max-min on a synthetic path graph stands in for CIEDE2000-neighborhood optimization; it proves the matrix artifact is consumable and deterministic, not that the optimizer is optimal.
- **One browser measured.** Chrome remains the binding S1/S2 browser; the Firefox/Safari matrix remains M8 work.
