# Stitch'n'Glitch Online — Build Plan

> Version: v1.6 | Author: Project team | Date: 2026-11-09
> Based on: StitchNGlitch-Online-PRD.md **v1.15** (47 features, 121 acceptance criteria, Q1–Q9 resolved)
> v1.6: Spike S5 completed (2026-11-09) — **PASS**, F-047 confusability-matrix generator verified end to end in Gleam (analysis fully in Gleam; canvas rasterization is the only FFI); minimum supported chart-cell measured at **16 px (100% zoom binding density)** with 5.2× noise-floor margin — 12 px marginal (1.4×), 8 px and below fail; findings folded into §3, M2, and §10 (see Spike5-Results.md)
> v1.5: PRD v1.14 — PDF export decided **fully vector** (jsPDF + build-time symbol font from the SVG glyph library); S5/M2/M5 scope updated; new AC-F013-05 and AC-F047-05 land in M5
> v1.4: Spike S4 completed (2026-11-07) — **PASS**, Gleam `atproto_browser` OAuth/DPoP + custom `online.stitchnglitch.*` record round trip verified against a Spaces-alpha PDS (write/read CID match; see Spike4-Results.md)
> v1.3: Spike S3 completed (2026-11-07) — **PASS**, Gleam/Lustre ↔ TypeScript/thi.ng/WebGL2 integration skeleton verified end to end at 59.92 fps UI with zero jank (see Spike3-Results.md)
> v1.2: Spike S2 completed (2026-11-06) — **PASS**, PNG IDAT mode dropped per the on-failure path; findings folded into §3, M4, and §10 (see Spike2-Results.md)
> v1.1: Spike S1 completed (2026-11-06) — **PASS** with 4.7× headroom; findings folded into §3, M3, and §10 (see Spike1-Results.md)

## 1. How to Read This Plan

Milestones are sequenced along the PRD's critical path and dependency graph (§4.3). Each milestone lists its **features** (F-xxx), **exit criteria** keyed to acceptance criteria (AC-Fxxx-nn), and **dependencies**. Exit criteria are cumulative: a milestone is done when its features' ACs pass *and* everything from previous milestones still passes. Releases follow PRD §5.2: v1.0 = all Must Have, v1.1 = all Should Have, v1.2 = Spaces-gated marketplace, v2.0 = Could Have candidates.

## 2. Build Principles

1. **Risk-first.** All unknowns with architecture-changing answers (engine performance, decoder tolerance, ATProto OAuth, the Gleam FFI boundary) are spiked in Phase 0, before any commitment is made on the critical path.
2. **Thin vertical slices.** Every milestone leaves the app usable — and usable *offline* (NFR-A1). No "infrastructure-only" milestones after M1.
3. **Local-first before network.** Anonymous mode (F-001) and the local library (F-014) work before sign-in exists; sync (F-016) is layered on top, never woven in.
4. **i18n and accessibility are architecture, not phases (Q6).** Externalized strings and keyboard/focus discipline are mandatory from M1; translation completion and the formal WCAG audit happen in M8, before launch — not after.
5. **Safety ships with publishing, not after it.** The report flow, self-labeling, on-device pre-scan, and founder-operated review (F-036/F-037) land in the same milestone as publishing (F-017). The moderation charter (Q9) is a pre-launch deliverable.
6. **Determinism as a test strategy.** Seeded databending (F-030), CIEDE2000 matching (F-005), and max-min symbol assignment (F-047) are all deterministic — regression-testable by snapshot comparison.

## 3. Phase 0 — De-Risking Spikes (Gatekeepers)

No production code survives a spike; findings are recorded and feed milestone design. S1–S4 are **gates**: the build order below assumes their outcomes.

| # | Spike | Question answered | Pass bar | On failure | PRD ref |
| --- | --- | --- | --- | --- | --- |
| S1 | thi.ng engine benchmark — **DONE 2026-11-06: ✅ PASS** | Does the TS pipeline meet NFR-P1 (12 MP → 300×300 chart, P95 ≤ 5 s, mid-range laptop, in a Web Worker)? | NFR-P1 met with margin — **met: worst-cell P95 1054 ms (4.7× under the 5 s budget), 60 fps UI with 0 jank frames** | Not triggered — WASM fallback stays dormant. Key finding: the pass is conditional on a specialized CIEDE2000 hot path (thi.ng `distCIEDE2000()` as-is misses at ~5.5 s for 90k cells × 32 colors; inline sRGB→Lab D50 + identical ΔE00 math is 12.5× faster, thi.ng kept as property-test oracle). Follow-up: >64-color palettes (F-004 allows 256) need a ΔE76 shortlist pre-filter or Lab index — M3 design task. Caveat: benchmarked on a fanless M2 Air; re-verify on a mid-range Windows laptop in M3 | NFR-P1, §8.3 |
| S2 | Databend decode tolerance — **DONE 2026-11-06: ✅ PASS (one mode dropped)** | Which corruption modes survive which browser decoders (Chrome/Firefox/Safari)? Does PNG IDAT + CRC32 repair decode reliably? How often does the retry loop fire? | Retry loop converges ≤ 3 attempts (P95) on all target browsers (NFR-C1) — **met for shipped modes: JPEG payload swap / BMP insert / TGA insert converge P95 ≤ 2 with 0% exhaustion on all three browsers**; retry fires only for JPEG (mostly Chrome), one extra attempt suffices | **Executed:** PNG IDAT corruption **dropped from v1.0** — CRC32 repair falsified (a single-byte flip desyncs the deflate stream; 0/400 flips survive strict zlib inflate) and corrupt-PNG decode diverges across browsers (Safari ignores IDAT CRC), threatening per-seed determinism. Additional findings: decode probe must be `createImageBitmap` (`<img>.decode()` too lenient in Chrome); retry policy = seed+1, cap 4, amount-halving after 2 failures; Chrome is the binding decoder — calibrate CI on Chromium, never WebKit; Edge unverified → M8 matrix | F-030, AC-F030-03 |
| S3 | Gleam ↔ TypeScript integration skeleton — **DONE 2026-11-07: ✅ PASS** | Lustre app calling thi.ng in a Web Worker via FFI, driving a WebGL2 canvas — end to end, typed | Demo: import → quantize → render at 60 fps — **met: deterministic 1200×900 import → @thi.ng/pixel 300×300 quantize in a worker → WebGL2 render/readback; 59.92 fps UI over 1001.4 ms with 0 jank frames** | Not triggered — §7.5 alternatives remain rejected. Key findings: thin FFI adapters + opaque `Dynamic` browser handles + typed summary decoders work; warm the worker at init; use a full-second rAF window for UI gates | Q1, §7.2 |
| S4 | ATProto OAuth + Lexicon round-trip — **DONE 2026-11-07: ✅ PASS** | Sign in with DPoP against a Spaces-enabled PDS; write/read a record under a custom `online.stitchnglitch.*` Lexicon | Round-trip works; auth isolated behind an adapter — **met: Gleam `atproto_browser` completed PAR/PKCE/DPoP token exchange against `ghcr.io/bluesky-social/atproto:pds-spaces-alpha` (0.5.32), then wrote/read `online.stitchnglitch.spike/self` with matching CID** | Not triggered — M6 adopts the `atproto_browser` adapter. Key findings: use strict public PLC/`flow.start` in production; local dev uses `flow.start_with` + `AllowLocalDevelopment`; loopback public-client IDs differ from production HTTPS web metadata; publish Lexicons before production; never log tokens | F-002, §7.3 |
| S5 | Confusability matrix generator — **DONE 2026-11-09: ✅ PASS** | Tooling that renders each symbol-set glyph at chart-cell size, computes pairwise differences, and merges curated overrides | Matrix artifact consumed by a toy max-min assignment; computed against the curated **SVG symbol library** (single glyph source) at the **minimum supported cell size and worst-case px-per-cell** (screen at 100 % zoom), including an eroded/blurred robustness variant simulating ink bleed — **met: full pipeline ran in Gleam at 6/8/12/16 px cells (canvas `Path2D` rasterization is the only FFI); the deterministic greedy max-min consumed the 13×13 matrix at every size (min neighbor distance 0.2135 at 16 px); minimum supported cell measured at 16 px with 5.2× margin over the cross-renderer noise floor — 12 px marginal (1.4×), 8 px and below fail; ink-bleed variants computed in the 3× print domain (1 device px bleed = ⅓ cell px) and merged by conservative elementwise minimum; 5 curated overrides merged symmetrically** (see Spike5-Results.md) | Hand-curate the launch symbol sets' matrices | F-047 |
| S6 | Stripe sandbox walkthrough *(deferred to Phase 2)* | Checkout + webhooks flow for donations (F-033) | — | — | F-033, NFR-S3 |

**Gate:** Phase 0 findings are recorded — **S1–S5 all PASS (S1/S2 on 2026-11-06, S3/S4 on 2026-11-07, S5 on 2026-11-09; see Spike1/Spike2/Spike3/Spike4/Spike5-Results.md)**; S6 remains deferred to Phase 2 (Stripe sandbox). S1's benchmark harness (`bench:node` / headless-Chrome Web Worker bench) is adopted as the CI performance regression gate and the M3 re-verification tool.

## 4. Phase 1 — MVP (v1.0): All 25 Must Features

Sequenced along the critical path (F-014 → F-008 → F-009 → F-003 → F-004 → F-010 → F-005 → F-047 → F-007 → F-013), with platform Musts attached where they belong. Effort classes assume a single full-time developer (see §9).

### M1 — Local-first foundation (M)

- **Features:** F-014 (event-sourced IndexedDB store: immutable snapshots + command log), F-001 (anonymous mode), F-015 (PWA shell, offline), F-045 part 1 (undo for document edits via inverse commands)
- **Exit:** AC-F001-01/02/03 (with a stub importer), AC-F014-01/02, AC-F015-01/02, AC-F045-04; NFR-A1/A2/A3 hold for the stub flow
- **Why first:** the storage shape is the hardest thing to change later; every subsequent milestone builds on it

### M2 — Chart core (L)

- **Features:** F-008 (editor tools), F-009 (WebGL renderer + the three chart styles), F-045 part 2 (pipeline-op undo harness; bake/flatten semantics); **curated SVG symbol library** — the single glyph source (SVG path data) for the WebGL glyph atlas, the UI sprite (`<symbol>`/`<use>`), the S5 confusability tooling, and the build-time symbol font that M5's PDF export embeds (PRD v1.14); per S5 (2026-11-09), glyphs at the ≈14%-of-cell feature floor need **≥ 16 px cells at 100% zoom** to hold a 2× noise-floor margin (12 px marginal) — this is the candidate minimum supported cell size for F-009's zoom/legibility design
- **Exit:** AC-F008-01..03, AC-F009-01..04, AC-F045-01/05; NFR-P2 (≥ 55 fps on 1000×1000) measured on target hardware; NFR-U2 symbol legibility check
- **Depends on:** M1, S3 ✅

### M3 — Conversion pipeline (XL — longest pole)

- **Features:** F-003 (import), F-041 (crop/rotate/resize), F-042 (brightness/contrast/saturation), F-004 (conversion settings), F-010 (DMC + Anchor palette data ingestion), F-011 (custom palettes, mixed-brand per AC-F011-04), F-005 (CIEDE2000 quantization), F-006 (dithering), F-047 (max-min symbol assignment — consumes S5's matrices), F-007 (confetti cleanup)
- **Exit:** US-001 and US-021 pass end to end; AC-F047-01..04; **NFR-P1 re-verified on the real pipeline** (not just S1's benchmark) **on target hardware** — S1 ran on a fanless M2 Air; re-run on a mid-range Windows laptop with ≥ 30 timed runs per cell before closing; thread-data licensing check closed (codes + names only, §8.3)
- **S1 findings baked into the design:** the F-005 quantizer ships the **specialized CIEDE2000 hot path** (inline sRGB→Lab D50 + ΔE00, verified identical to thi.ng within 7.8e-14 ΔE) behind the engine API, with thi.ng's `distCIEDE2000()` as the property-test oracle (S1's profile script seeds that test) — thi.ng's distance function as-is misses NFR-P1 (~5.5 s for 90k cells × 32 colors); add a design task for the **>64-color path**: shortlist pre-filter (cheap ΔE76 candidate cut, exact ΔE00 on survivors) or a Lab-space index, so F-004's 256-color upper bound stays within budget; real browser decode (~100–300 ms off-thread via `createImageBitmap`) is included in the re-verification budget; WASM hot-path fallback stays dormant
- **Depends on:** M2, S1 (✅ PASS 2026-11-06), S5 (✅ PASS 2026-11-09)

### M4 — Real glitch (M)

- **Features:** F-030 (databending engine — mode list settled by S2: **JPEG payload swaps** strictly between SOS header and EOI, **BMP/TGA WordPad insertion** via a bundled strict bounds-checked decoder; seeded, deterministic; decode-tolerance retry: seed+1, cap 4, amount-halving after 2 failures; `createImageBitmap` decode probe; bake to PNG. **PNG IDAT corruption dropped** per S2 — CRC32 repair falsified)
- **Exit:** AC-F030-01..03; AC-F045-02/03 (undo-a-databend, confirmed bake); determinism snapshot tests in CI — seeded from S2's self-tests (same seed → identical bytes; CRC32/Adler32 known vectors); **retry-convergence CI gate runs on Chromium** (the binding decoder — never calibrate on WebKit); production TGA decoder at least as strict as S2's, with the retry gate re-validated against it; Edge decode behavior re-verified in M8's compatibility matrix
- **Depends on:** M3, S2 (✅ PASS 2026-11-06)

### M5 — Export (M)

- **Features:** F-013 (**fully vector** PDF per PRD v1.14: single-page or paged, A4/US Letter, page map + overlap markers, cover page, color key, skein usage; Pattern Keeper-selectable symbols via embedded-TTF text runs). Assembly: **jsPDF** on the main thread (svg2pdf.js needs a real DOM, so no Web Worker) — chart pages emit direct jsPDF vector operators (cell fills, grid, symbols-as-text) from the **same chart-layout module** that drives the WebGL renderer; svg2pdf.js reserved for complex vector graphics; chrome/legend text in standard-14 fonts. **Build-time symbol font:** the subsetted TTF embedded for symbols is generated from M2's SVG symbol library, keeping glyph geometry single-source. PDFium (Chrome) is the primary CI rasterizer for AC-F047-05; Acrobat/Preview sampled manually.
- **Exit:** AC-F013-01..05; AC-F047-05 (cross-renderer + physical-print validation of the F-047 matrices through the shipped symbol font); golden-file PDF regression tests; print check on physical A4 and Letter paper
- **Depends on:** M3 (palette/symbol data), M2 (renderer + SVG symbol library), S5 (matrices)

### M6 — Identity & sync (L)

- **Features:** F-002 (ATProto OAuth, DPoP), F-016 (sync, per-record last-writer-wins), sync status UI (NFR-AV1 banner), PDS guidance — Spaces-enabled providers only (Q2)
- **Exit:** AC-F002-01..03, AC-F016-*; scripted test: edit offline on two devices → sync → LWW resolution, no data loss (NFR-A2); AC-F045-04 across devices
- **Depends on:** M1, S4 ✅

### M7 — Publishing & moderation baseline (L)

- **Features:** F-017 (publish to PDS), F-036 (self-labeling + on-device NudeNet pre-scan in a Web Worker), F-037 (indexer service doubling as ATProto labeler; self-hosted Ozone; report flow; founder-solo operations per Q9)
- **Non-code deliverables:** **moderation charter drafted and adopted** (vetting criteria, conflict-of-interest rules, moderator conduct/removal, labeler key custody — initially governing the founder's own conduct and the application process, Q9); **T0 playbook** (≤ 1 h removal SLA path per NFR-M1)
- **Exit:** AC-F017-* (incl. public-by-design disclosure, NFR-PR3), AC-F036-*, AC-F037-01..05; NFR-PR1 audit passes (no unpublished image egress)
- **Depends on:** M6; note v1.0 publishing is link-sharing — the discovery feed is v1.1 (F-022)

### M8 — Hardening & launch (M)

- **Features:** F-034 (complete DE/FR/ES/NL translations; CI key-coverage gate already green since M1), F-035 (formal WCAG 2.2 AA audit + fixes), compatibility matrix (NFR-C1/C2/C3), performance pass (NFR-P3), storage-pressure and eviction tests (AC-F014-03)
- **Exit:** accessibility audit green in all 5 languages; closed beta with 10–20 stitchers from the community; v1.0 tag
- **Depends on:** M1–M7

### Milestone summary

| Milestone | Features | Key exit criteria | Effort | Depends on |
| --- | --- | --- | --- | --- |
| M1 Local-first foundation | F-014, F-001, F-015, F-045 (pt 1) | AC-F001, F-014, F-015; NFR-A1–A3 | M | S3 ✅ |
| M2 Chart core | F-008, F-009, F-045 (pt 2) | AC-F008, F-009; NFR-P2 | L | M1, S3 ✅ |
| M3 Conversion pipeline | F-003, F-041, F-042, F-004, F-010, F-011, F-005, F-006, F-047, F-007 | US-001/US-021 e2e; NFR-P1 re-verified on target hardware (≥ 30 runs); specialized CIEDE2000 hot path + thi.ng oracle property test; >64-color pre-filter design; AC-F047 | XL | M2, S1 ✅, S5 ✅ |
| M4 Real glitch | F-030 (JPEG swap + BMP/TGA insert; PNG IDAT dropped per S2) | AC-F030; AC-F045-02/03; Chromium retry-convergence CI gate | M | M3, S2 ✅ |
| M5 Export | F-013 | AC-F013-01..05; AC-F047-05 (print validation) | M | M3, M2, S5 |
| M6 Identity & sync | F-002, F-016 | AC-F002, F-016; NFR-A2 | L | M1, S4 ✅ |
| M7 Publishing & moderation | F-017, F-036, F-037 + charter | AC-F017/036/037; NFR-PR1/PR3 | L | M6 |
| M8 Hardening & launch | F-034, F-035 completion | WCAG audit × 5 languages; beta | M | all |

**Parallelization (if a second developer joins):** M6 can start after M1 in parallel with M2–M5; S6 is an independent side task. With a solo developer, run strictly in order — the sequence minimizes rework.

## 5. Phase 2 — v1.1 (All Should Features)

1. **Discovery first:** F-022 (discovery feed) extends the indexer/labeler service deployed in M7 — publishing becomes meaningful.
2. **Moderation scaling ahead of volume:** F-038 (server-side classifier backstop), F-039 (PDQ hash-matching self-hosted), F-040 (age gating + label preferences) — landed before the feed can grow, per NFR-M1's automation-first posture.
3. **Revenue:** F-033 (donations via Stripe Checkout; S6 spike first).
4. **Pro features:** F-019 (backstitch/specialty stitches), F-020 (OXS import/export), F-012 (palette import/export), F-018 (PNG export), F-043 (levels & white balance).

## 6. Phase 3 — v1.2 (Gated on ATProto Spaces GA)

**Preconditions, both outside project control:** Spaces reaches GA with production PDS support, *and* Thorn Safer (PhotoDNA-grade) hash-matching is live (F-039 upgrade, PRD §5.2). Until then: track Spaces Alpha releases for breaking changes, but build nothing against Alpha APIs beyond a spike.

- Entitlement / space-grant service (Gleam/BEAM) → F-023 → F-024 → F-025 → F-026 (marketplace chain, Stripe Connect onboarding via S6 extension)
- F-032 (private group sharing) unblocks with the same GA event
- NFR-S2 audit gate before marketplace launch: paid payloads never touch public repos

## 7. Phase 4 — v2.0 Candidates (Could Have)

Re-selected after v1.1 ships, informed by usage data: F-021 (CRDT conflict resolution + history sync — closes the loop on §7.7), F-027 (fork & remix), F-028 (layers), F-029 (pixel art mode), F-031 (public pipeline API — internal architecture already shipped at v1.0), F-044 (histogram), F-046 (visual history timeline).

## 8. Continuous Workstreams (Not Phases)

- **i18n key coverage** in CI from M1 (English fallback, AC-F034-03); professional translation pass in M8
- **Accessibility checks** in CI from M2 (keyboard operability, focus management); automated WCAG audits gate merges (NFR-U1)
- **Performance budget dashboard** tracking NFR-P1/P2/P3 from the first milestone that can regress them
- **Privacy audits** (NFR-PR1): automated test asserting zero network egress of source images / unpublished documents
- **Schema versioning** for the event-sourced store and Lexicons — migrations are a feature of every milestone, not an afterthought
- **Spec watch:** ATProto OAuth (draft), Spaces Alpha (breaking changes expected), DSA guidance for the moderation charter
- **Dependency watch:** thi.ng is largely single-maintainer — keep packages forkable and the engine boundary language-agnostic (§7.5)

## 9. Estimation Approach & Assumptions

- **No calendar dates.** Team capacity is unstated; milestones carry effort classes (S/M/L/XL) instead. With one full-time developer, treat M3 as the pacing item and M6 as the second-largest.
- **Assumed team:** the founder, full-time, solo — consistent with Q9 (sole moderator). Every milestone except M2↔M6 parallelization survives that assumption.
- **Definition of done, every milestone:** all listed ACs green in CI; offline usability preserved (NFR-A1); no regression in prior milestones' ACs; demo-able without a network connection.

## 10. Risk-to-Plan Mapping

| PRD risk (§8.3) | Where the plan absorbs it |
| --- | --- |
| thi.ng misses NFR-P1 / maintenance stalls | **S1 gate PASSED 2026-11-06** (4.7× headroom at 16–64 colors, conditional on the specialized CIEDE2000 hot path); residual performance risk limited to >64-color palettes → shortlist pre-filter tasked in M3; S1 harness kept as CI gate; WASM fallback preserved; forkable packages |
| Launch symbol sets read as confusable at small cell sizes | **S5 gate PASSED 2026-11-09** — matrix generator validated end to end in Gleam; minimum supported cell measured at 16 px (100% zoom) with 5.2× margin over the cross-renderer noise floor (12 px marginal at 1.4×, 8 px and below fail) → minimum-feature-size rule (≈14% of cell) lands in the symbol spec and M2's zoom design; curated overrides confirmed load-bearing (pixel distance is blind to mirror/rotation/subset pairs); residual: launch validation across WebGL + two PDF engines and curation of the real launch sets in M5 (AC-F047-05); on failure there, hand-curate the launch sets' matrices |
| Browser decoder variance breaks databends | **S2 gate PASSED 2026-11-06** — variance measured and absorbed: shipped modes converge P95 ≤ 2 with 0% exhaustion on Chrome/Firefox/Safari; unreliable mode (PNG IDAT) dropped before M4 commits to it; `createImageBitmap` probe normalizes "decodable" across browsers; residual: Edge unverified (M8 matrix) and arbitrary user-JPEG encoder variance (handled by the marker-walking region picker; conservative bounds — larger files resync more); retry loop + AC-F030-03 |
| ATProto OAuth is a draft spec | **S4 gate PASSED 2026-11-07** — Gleam `atproto_browser` completed PAR/PKCE/DPoP and custom-record XRPC against a Spaces-alpha PDS; M6 pins the implemented package/spec snapshot, keeps auth behind the adapter, and monitors spec changes |
| Spaces GA timing slips | Phase 3 floats; v1.0/v1.1 are fully shippable without it (Q4) |
| Gleam/Lustre ecosystem gap | **S3 gate PASSED 2026-11-07** — Lustre 5.7 ↔ TypeScript FFI ↔ `@thi.ng/pixel` worker ↔ WebGL2 verified end to end (59.92 fps UI, zero jank); thin FFI adapters, opaque browser handles, and typed summary decoders are the M1/M2 pattern |
| Thread-brand trademark constraints | Closed during M3, before palette data ships (codes + names only) |
| IndexedDB eviction | M8 storage-pressure tests; sync/export nudges; persistent-storage request |
| Moderation volume outgrows a solo founder | Automation carries hard SLAs (NFR-M1); Phase 2 lands backstop + hash-matching *before* growth; charter + application path from Q9 |
| Stripe availability/KYC friction | S6 in Phase 2, months before the marketplace needs Connect |

## Appendix — Traceability

All 121 acceptance criteria in PRD v1.14 map to milestone exit criteria via their feature IDs: Must Have features (F-001–F-017, F-030, F-034–F-037, F-041, F-042, F-045, F-047) → Phase 1 milestones M1–M8; Should Have → Phase 2; Spaces-gated chain → Phase 3; Could Have → Phase 4. When the PRD changes, update this plan in the same commit.
