# Spike S2 — Databend decode tolerance (F-030 / AC-F030-03 / NFR-C1)

> **Spike ID:** S2 (Build Plan §3) · **Proves:** AC-F030-03 + NFR-C1 (PRD §4.2, F-030) · **Date:** 2026-11-06
> **Question:** Which corruption modes survive which browser decoders (Chrome/Firefox/Safari)? Does PNG IDAT + CRC32 repair decode reliably? How often does the retry loop fire?

## Verdict

## ✅ PASS — with one mode dropped (the plan's on-failure path, executed)

**The retry gate holds for the modes that ship: JPEG payload swaps, BMP/TGA WordPad
reinterpretation converge in ≤ 2 attempts (P95 ≤ 2) on all three target browsers with
0% exhaustion.** PNG IDAT byte corruption **fails the gate on every browser under
strict decoding** (P95 = 10 = cap, up to 100% exhausted) — per Build Plan S2's
"On failure" column, **PNG IDAT corruption is dropped from the v1.0 default modes**.
This is the gate working as designed, not a failed spike: the question is answered,
and the answer changes F-030's shipped mode list before M4 commits to it.

| | Pass bar | JPEG payload | BMP insert | TGA insert | PNG IDAT (any variant) |
| --- | --- | :-: | :-: | :-: | :-: |
| Retry P95 | ≤ 3 attempts, all browsers | **≤ 2** ✅ | **1** ✅ | **1** ✅ | **10** ❌ |
| Exhausted | 0% | **0%** ✅ | **0%** ✅ | **0%** ✅ | **32–100%** ❌ |

## Environment

| | |
| --- | --- |
| Machine | MacBook Air (Mac14,2), Apple M2, 8 GB RAM |
| Chrome | 156.0.8078.81 (headless=new) |
| Firefox | 151.0.4 (headless) |
| Safari | 26.4 (windowed — no headless mode; harness tab reports on-screen) |
| Harness | dependency-free: Node static server + ES-module test page, seeded mulberry32 PRNG |
| Node ground truth | Node v23.11.0 strict zlib (`inflateSync`), `scripts/test-png-modes.mjs` |

## What is measured

Corpus: one deterministic procedural 192×128 image per format — JPEG q=0.85 and PNG
from canvas, hand-encoded 24-bit BMP and uncompressed TGA. Corruption modes (all pure
functions: `(originalBytes, amount, seed) → bytes`, original never mutated — AC-F030-03):

| Mode | What it does | PRD basis |
| --- | --- | --- |
| `jpeg-swap` | N seeded byte swaps in the entropy-coded payload (between SOS header and EOI) | F-030 "JPEG payload corruption" (mattdennewitz corrupt.py reference) |
| `png-idat-raw` | N byte flips inside IDAT data, no checksum repair | F-030 "PNG IDAT corruption" |
| `png-idat-crc` | N byte flips + chunk CRC32 recomputed | **F-030's exact claim**: "PNG IDAT corruption with CRC32 repair so decoders still accept the file" |
| `png-idat-zlib` | N byte flips + CRC32 + zlib Adler32 patched to match the desynced stream | spike hypothesis: CRC repair alone may not suffice |
| `bmp-insert` / `tga-insert` | N junk bytes inserted at a random offset in the pixel-data region ("WordPad effect") | F-030 "BMP/TGA raw reinterpretation" |

Decode probe: `createImageBitmap(blob)` (the production off-thread decode API), except
TGA which browsers can't decode — a bundled strict bounds-checked JS decoder stands in
(what F-030 would ship). Retry loop per AC-F030-03: re-corrupt with `seed+1` until
decodable, cap 10. Matrix: 6 modes × 3–4 amounts × 40 seeds = **920 samples per
browser**; each sample records attempts-to-success. Self-tests before the matrix:
CRC32/Adler32 known vectors, PRNG determinism, PNG chunk walk, BMP/TGA round-trip,
JPEG marker parse; all green in every run.

## Results — shipped modes (gate cells), all three browsers

| Mode @ amount | Chrome first-try | Firefox first-try | Safari first-try | Chrome P95 | Firefox P95 | Safari P95 | Worst max | Exhausted |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :-: |
| jpeg-swap @ 2 | 100% | 100% | 100% | 1 | 1 | 1 | 1 | 0% |
| jpeg-swap @ 5 | 92.5% | 100% | 100% | 2 | 1 | 1 | 2 | 0% |
| jpeg-swap @ 10 | 85.0% | 100% | 100% | 2 | 1 | 1 | 2 | 0% |
| jpeg-swap @ 20 | 80.0% | 97.5% | 100% | 2 | 1 | 1 | 2 | 0% |
| bmp-insert @ 1–8 | 100% | 100% | 100% | 1 | 1 | 1 | 1 | 0% |
| tga-insert @ 1–8 | 100% | 100% | 100% | 1 | 1 | 1 | 1 | 0% |

**How often does the retry loop fire?** Only for JPEG, and only Chrome stresses it:
0–20% of samples (Firefox ≤ 2.5%, Safari 0%). When it fires it converges in **one
extra attempt** (worst observed: 2 attempts at 20 swaps in Chrome). At the PRD's
canonical "10 iterations" (AC-F030-02), ≥ 85% of bends decode on the first try
everywhere. BMP/TGA never fire the retry at any tested amount.

Full per-browser tables: run `npm run report` (data in `results/*.json`).

## Results — PNG IDAT modes: the PRD's CRC32-repair claim does not hold

| Browser | png-idat-raw (no repair) | png-idat-crc (PRD claim) | png-idat-zlib (+ Adler32) |
| --- | --- | --- | --- |
| Chrome | 0% first-try (rejects on CRC) | 17.5% @ 1 flip → 0% @ ≥ 4; P95 = 7–10; 90–100% exhausted | 0%, 100% exhausted |
| Firefox | 0% first-try (rejects on CRC) | 32.5–67.5% first-try (partial-render leniency) — but P95 = 5 > 3 @ 1–2 flips | 0%, 100% exhausted |
| Safari | **100% first-try at every amount** (ignores IDAT CRC entirely) | **100% first-try** | 0%, 100% exhausted |
| Strict zlib (Node, ground truth) | 0/50 decode | **0/50 decode; 0/400 single-flip positions keep a deflate stream inflatable** | surviving flips (≈0–2.5%) patch and decode correctly — implementation verified |

Three distinct findings, all gate-relevant:

1. **CRC32 repair is not sufficient, and the missing piece is not another checksum —
   it is the deflate stream itself.** Node strict-zlib ground truth: *no* single-byte
   flip in a dynamic-Huffman IDAT survives `inflateSync` (0/400 positions), so Adler32
   mismatch is moot — the stream errors first. The retry loop re-rolls a die that
   almost never comes up: P95 = cap, 32–100% exhausted. PNG IDAT corruption cannot
   converge ≤ 3 attempts on any browser. **Fails the S2 gate; dropped from v1.0.**
2. **"Decode success" is not browser-portable for corrupt PNGs — determinism hazard.**
   The *same seeded file* is rejected by Chrome/Firefox (CRC enforced) but decoded by
   Safari (IDAT CRC ignored) 100% of the time; with CRC repaired, Chrome accepts 17.5%
   and Firefox 32–67% of *partially-rendered* images (garbage rows). A retry gate
   calibrated on WebKit would accept files Blink rejects and ship visually-broken
   images as "success" — F-030's determinism guarantee (AC-F030-02) would hold per
   byte yet diverge per browser in outcome.
3. **The Adler32-repair path (`png-idat-zlib`) is implemented and verified** — every
   flip that survives inflate patches into a strictly-decodable file (Node-verified) —
   but survival probability ≈ 0–2.5%, so it rescues nothing in practice. A PNG-source
   "bend" that decodes reliably would have to corrupt *pre-compression* pixels, which
   is pixel-level editing, outside F-030's byte-level definition. **Conclusion: PNG
   stays the bake/output format only** (which F-030 already specifies).

## Key findings for M4 (F-030) design

1. **Ship these default modes:** `jpeg-swap` (payload region strictly between the SOS
   header and EOI — never headers/markers), `bmp-insert`, `tga-insert` (bundled strict
   decoder). Gate: retry ≤ 2 attempts everywhere with margin.
2. **Decode probe must be `createImageBitmap`** — the strictest probe available.
   Cross-check: in Chrome, `<img>.decode()` accepted 25/50 files that
   `createImageBitmap` rejected (all corrupt PNG/JPEG first-attempts, img-more-lenient).
   Firefox and Safari agreed 50/50. A gate on `<img>` would pass garbage.
3. **Retry policy:** next-seed (`seed+1`) is sufficient; measured worst case 2
   attempts at 20 swaps. Ship cap 4 with amount-halving after 2 failures (PRD's
   "or reduces the corruption amount") — unreachable in practice, cheap insurance.
4. **Chrome is the binding decoder** for JPEG (strictest: 80% first-try @ 20 swaps vs
   Firefox 97.5%, Safari 100%) — CI gate should run the retry-convergence test on
   Chromium. Safari/WebKit is the lenient outlier; never calibrate tolerances on it.
5. **Determinism regression test seed:** the spike's self-tests (same seed → identical
   bytes; known-vector CRC32/Adler32) are the nucleus of M4's CI snapshot test.

## Reproduce

```bash
npm run spike            # all three browsers (Safari opens a windowed tab; auto-posts, then closable)
npm run spike -- chrome firefox     # subset
node scripts/test-png-modes.mjs     # strict-zlib ground truth for the PNG modes (no browser)
npm run report                      # per-browser gate tables from results/*.json
```

Raw per-sample data: `results/{chrome,firefox,safari}.json`, `results/summary.json`.

## Scope notes / known limitations

- **Edge not measured** (no Windows host): it is Chromium-based and expected to match
  Chrome; re-verify in M8's compatibility matrix (NFR-C1/C2/C3).
- One image size per format (192×128). JPEG tolerance grows with more restart
  intervals in larger files (more resync points), so these are conservative bounds;
  PNG structurally unaffected by size.
- 40 seeds/cell — spike-grade statistics. The shipped-mode margins (P95 ≤ 2 vs bar 3)
  are wide enough that this is not a risk; M4's CI test can cheaply use 200+.
- BMP/TGA "success" = structurally decodable (the WordPad effect shifts pixels by
  design); pixel-level sanity of decoded output is not asserted here.
- TGA goes through the spike's strict JS decoder; a production decoder (M4) must be at
  least as strict, and the retry gate must re-validate with it.
- Safari ran windowed via `open -a`; harness reports completion on-screen. First run
  may leave the tab open — close it manually.
- The corpus's canvas JPEG/PNG encoders are the browsers' own; production import
  accepts arbitrary user files, whose encoder variance (e.g. progressive JPEG,
  multi-scan) shifts `jpeg-swap` tolerance — the engine's region picker must skip
  scans it doesn't understand, which the spike's marker-walking parser already does.
