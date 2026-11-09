# Spike S3 — Gleam/Lustre ↔ TypeScript/thi.ng/WebGL2 integration

> **Spike ID:** S3 (Build Plan §3) · **Proves:** Q1 / PRD §7.2 integration skeleton · **Date:** 2026-11-07
> **Question:** Can a Lustre app call the TypeScript/thi.ng engine in a Web Worker through Gleam FFI and drive a WebGL2 canvas, end to end and typed?

## Verdict

## ✅ PASS

**Headless browser demo: import → quantize → render completed at 59.92 fps over a 1001.4 ms
measurement window with zero >50 ms UI frames.** A deterministic 1200×900 PNG crossed from a
Lustre-rendered file input into a dedicated module worker, was decoded and resized with
`@thi.ng/pixel`, quantized to a 16-color indexed chart, uploaded to a WebGL2 indexed texture,
rendered, and read back with **16 unique colors** — proving the whole Gleam → TypeScript FFI →
worker → WebGL2 → Gleam decode loop, not just a synthetic function call.

| Build-plan bar | Measured |
| --- | --- |
| Import → quantize → render demo works end to end | ✅ PASS |
| Render loop at 60 fps | ✅ **59.92 fps** |
| UI jank (>50 ms frames) | ✅ **0** |
| Engine in a Web Worker | ✅ dedicated module worker |
| Renderer | ✅ WebGL2, nonblank readback |

## Environment

| | |
| --- | --- |
| Machine | MacBook Air (Mac14,2), Apple M2, 8 GB RAM, fanless |
| Browser | Google Chrome 156 (`HeadlessChrome/156.0.0.0`), CDP-driven |
| Gleam | 1.19.2 |
| Lustre | 5.7.1 |
| TypeScript / Vite | 5.9.3 / 6.4.5 |
| Engine | `@thi.ng/pixel` 7.5.38 |
| Node | v23.11.0, darwin/arm64 |

## What is wired together

```text
src/sng_spike3.gleam
  Lustre MVU model + view
    │
    │ typed Gleam FFI calls (src/sng_spike3_ffi.mjs)
    ▼
src/ts/adapter.ts ────────────────┐
  file input listener             │ rAF UI measurement
  worker client                   │
    │ postMessage(File)           │
    ▼                             │
src/ts/engine-worker.ts           │
  createImageBitmap decode        │
  @thi.ng/pixel IntBuffer.resize  │
  nearest-palette quantization    │
    │ transfer indices + palette  │
    └─────────────────────────────┘
    ▼
src/ts/renderer.ts
  WebGL2 indexed texture + palette shader
  gl.readPixels verification
    │
    ▼
typed Gleam summary decoder → Lustre result view
```

The spike deliberately exercises the same boundaries as the PRD architecture:

- **Gleam owns the app state.** The file input is Lustre HTML; `Model`, `Msg`, update phases,
  and result rendering are Gleam types.
- **TypeScript integration is direct FFI, not ports.** `Dynamic` crosses only where browser
  objects are inherently foreign (`File`, worker payload, render info); the returned summary is
  decoded with a `gleam/dynamic/decode.Decoder` into a typed Gleam record.
- **The engine is off-thread.** Decode, thi.ng buffer import/resize, and quantization run in a
  dedicated module worker. The UI receives transferable `Uint8Array` chart data.
- **The renderer is WebGL2.** Chart indices and a 16-color palette become texture/uniform data;
  the canvas is verified via `gl.readPixels`, not assumed to have painted.

## Results — recorded headless run

| Stage / check | Result |
| --- | ---: |
| Source | 1200×900 PNG, 2,756,788 bytes |
| Decode (`createImageBitmap` + bitmap draw) | **35.1 ms** |
| `@thi.ng/pixel` resize to 300×300 | **11.4 ms** |
| Quantize 300×300 × 16 colors | **5.8 ms** |
| Worker total | **52.3 ms** |
| WebGL2 upload + draw + readback | **7.4 ms** |
| UI measurement window | **1001.4 ms** |
| UI fps / jank frames | **59.92 fps / 0** |
| Canvas readback | **16 unique colors**, checksum 1703118460 |

All seven harness checks pass: Lustre round trip, thi.ng worker, imported source dimensions,
300×300 chart shape, WebGL2 render, nonblank/limited-palette canvas readback, and 60 fps UI.
Raw artifact: `results/spike3-browser-result.json`.

## Key findings for milestone design

1. **The Q1 stack is technically sound.** Gleam 1.19 + Lustre 5.7, TypeScript, Vite,
   `@thi.ng/pixel`, and WebGL2 compose into one working browser bundle. Build Plan §7.5
   alternatives do **not** need revisiting.
2. **Use thin FFI adapter modules.** Gleam calls a tiny JS shim (`sng_spike3_ffi.mjs`), which
   delegates to TypeScript. This keeps generated-Gleam imports simple while Vite handles `.ts`
   and worker bundling.
3. **Opaque `Dynamic` handles are the right boundary for browser objects.** `File`, structured
   worker payloads, and render metadata should remain opaque in Gleam; decode only stable
   summary records at the UI edge.
4. **Warm the worker during app init.** The first `new Worker(...)` module load can dominate a
   short measurement window. Production should create/reuse the worker before the first import;
   this spike does so in `prepare_worker`.
5. **Measure UI responsiveness over a full compositor window.** Sub-100 ms headless samples can
   produce noisy average fps even with no jank. The harness reports a one-second rAF window;
   the UI remained at 60 fps while the worker completed in 52.3 ms.
6. **The renderer can be a stateless function of typed chart data.** The spike caches the
   compiled WebGL program per canvas but re-uploads indices/palette for every chart — a direct
   seed for M2's F-009 renderer boundary.

## Reproduce

```bash
npm install
gleam test                    # Gleam compile/unit test
npx tsc --noEmit             # TypeScript boundary check
npm run build                # gleam build + Vite production bundle
npm run spike                # deterministic PNG + headless-Chrome end-to-end gate
```

For an interactive run: `npm run dev`, open the printed localhost URL, and choose any image.

## Scope notes / known limitations

- **Integration proof, not production quality.** The quantizer is a simple 16-color RGB nearest
  search; CIEDE2000 performance and correctness remain covered by S1 and the M3 engine design.
- **No persistence, routing, i18n, accessibility, PWA, or server components.** This spike proves
  only the S3 browser integration skeleton; those M1 concerns remain milestone work.
- **One browser measured.** Chrome is the binding S1/S2 browser and the production performance
  baseline; Firefox/Safari compatibility remains M8's NFR-C1/C2/C3 matrix.
- **The canvas readback check verifies limited-palette nonblank output**, not symbol legibility,
  chart style, pan/zoom, or 10⁶-cell NFR-P2 behavior.
- **The one-second fps gate excludes first app/worker module-load latency** by warming the
  worker before measurement; user-perceived cold start still matters for M1/PWA work.
