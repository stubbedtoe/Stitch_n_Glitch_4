# E2E contract — Stitch'n'Glitch M1 shell + M2 chart slices

This directory holds the **browser-level (Playwright) contract suite** derived
from `specs/m1-local-foundation.allium` (M1 shell) and
`specs/m2-chart-core.allium` (M2 chart view, surfaces ChartViewControls and
SymbolLibrary). These tests are the obligations the
shell slice (Lustre UI + PWA + IndexedDB adapter) and the M2 chart view must satisfy. The domain
core obligations are covered by the Gleam gleeunit suite in `app/test/` and are
out of scope here.

## Running

```bash
cd app/e2e
npm install          # once
npx playwright install chromium   # once
npx playwright test
```

## App-serving contract

`playwright.config.ts` starts `e2e/serve.sh` as its `webServer`:

1. `cd app && gleam build` must succeed.
2. The shell slice must place the **servable app** — `index.html`, the compiled
   JS entry point, the web app manifest, the service worker, and icons — in
   **`app/priv/static/`**. That directory is served as-is by
   `python3 -m http.server 4719`.
3. `baseURL` is `http://localhost:4719`. `/` must load the app shell.
4. The service worker must not pin a stale bundle: same-origin GETs are
   served network-first with the cache only as the offline fallback (a
   cache-first worker with a fixed cache name never delivers deploys to
   returning users). OfflineCapable must still hold — after one online
   load the shell works fully offline.

No other server, framework, or dependency is required; a plain static file
server is sufficient because M1 is fully local (all state in the browser via
IndexedDB, the app shell precached by a service worker).

## DOM contract

Prefer semantic roles and accessible names. The implementation may choose its
own markup as long as the following are reachable by a Playwright
role/label query. Tests use **8×8** grids created through the create flow, so
no test depends on the placeholder default canvas size.

### App shell (all views)

| Control / element | Contract |
|---|---|
| Offline indicator | `role="status"`, accessible name matches `/offline/i`. Hidden while online; visible within `config.offline_indicator_deadline` (5 s) of a connectivity drop; disappears when connectivity returns. Non-blocking: it is **not** a modal/dialog and never blocks editing. |
| Sign-in wall | **Absent.** No text matching `/sign in\|log in\|create an account/i`, no blocking `role="dialog"` on load (PromptFreeEntry, AC-F001-02). |
| Web app manifest | `<link rel="manifest">` resolving to JSON with non-empty `name`, `display: "standalone"`, and at least one icon with `src` and `sizes` (Installable, AC-F015-02). |
| Service worker | `navigator.serviceWorker.getRegistration()` resolves non-null after first load (AC-F015-01). |

### Library browser view

| Control / element | Contract |
|---|---|
| Create blank control | `role="button"`, accessible name `Create blank document`. Activating it reveals `role="spinbutton"` fields named `Width` and `Height` plus a `Create` button; submitting opens the editor with a grid of exactly width×height empty cells. |
| Import stub control | A file input labelled `/import image/i` (`getByLabel(/import image/i)`). Feeding it PNG bytes creates a library entry named after the file (rule `ImageImportedStub`). |
| Library entries | A `role="listitem"` per document containing: a heading with the exact document name, an `role="img"` thumbnail, text matching `/last edited/i`, and buttons with accessible names `Open <name>`, `Rename <name>`, `Duplicate <name>`, `Delete <name>`. |
| Rename | `Rename <name>` reveals a `role="textbox"` named `Document name`, prefilled with the current name; `Enter` commits and the entry heading updates. |
| Duplicate | `Duplicate <name>` immediately creates an independent entry named `<name> (copy)` (rule `DocumentDuplicated`). |
| Delete | `Delete <name>` opens a `role="dialog"` named `/delete/i` containing text matching `/permanently/i` and two buttons: `Cancel` (dismisses, entry remains) and `Delete` (removes the entry permanently). Deletion never fires without this confirmation (AC-F014-02). |
| Editor navigation | `Back to library` button/link returns to the library view. |

### Editor view

| Control / element | Contract |
|---|---|
| Document title | `role="heading"` with the exact document name. |
| Stitch grid | `role="grid"`, accessible name `Stitch grid`, with one `role="gridcell"` per cell. An empty cell's accessible name is `Cell <x>, <y>`; a stitched cell's is `Stitched cell <x>, <y>`. |
| Pencil | `role="button"` named `Pencil` — a **toggle** whose state is mirrored by `aria-pressed` (and an active-state style). With the pencil active, `mouse.down` → drag across cells → `mouse.up` is **one committed gesture** (rule `StitchesDrawn`): every dragged cell becomes `Stitched cell <x>, <y>`, and a single Undo reverts the whole stroke (one log entry). With the pencil inactive, drags commit nothing. Hovering cells with no button pressed is **not** part of any gesture: it must not create, extend, or commit a stroke — a pointerup that ends no drag (e.g. a toolbar click) commits nothing. |
| Undo / Redo | Buttons named `Undo` / `Redo` mirroring the surface guards: Undo disabled when there is nothing to undo, enabled after a gesture; Redo enabled only when the newest entry is an undo (surface-provides.Editor). |
| Chart view | Button named `Show chart` switches the editor body to the chart view (see Chart view below); while the chart view is open the DOM stitch grid is unmounted, so large documents stay operable. |
| Export placeholder | Button named `/export pdf/i` that produces a **local** download (Playwright `download` event) with a `.pdf` filename and non-empty payload. It must transmit nothing (ExportPdfPlaceholder). |

### Chart view (M2, surfaces ChartViewControls / SymbolLibrary)

Opened from the editor with `Show chart`. While the chart view is open the
DOM stitch grid is unmounted, so large documents stay operable. The chart
view is a `role="region"` named `Chart view` containing:

| Control / element | Contract |
|---|---|
| Chart canvas | `role="img"`, accessible name `Symbol chart` (WebGL2). Carries `data-style` (`symbols_on_colored_background` \| `colored_symbols_only` \| `black_and_white_symbols_only`), `data-symbol-set` (the document's current symbol-set name), `data-zoom-pct`, `data-grid-visible` (`"true"`/`"false"`), `data-center-x`, `data-center-y`, `data-chart-width`, `data-chart-height`. Pans with pointer drag and zooms with the wheel; both clamp exactly like the button controls. |
| Style switcher | `role="radiogroup"` name `Chart style`; three radios named exactly `Symbols on colored background` / `Colored symbols only` / `Black and white symbols only`; exactly one checked; default `Symbols on colored background`; the selection is persisted with the document and survives reload (AC-F009-04 — it is the export style F-013 consumes in M5). |
| Symbol set selector | `role="radiogroup"` name `Symbol set`; one radio per shipped set, each carrying `data-colorblind-safe` (`"true"`/`"false"`); at least `config.colorblind_safe_sets_required` (2) with `"true"` (NFR-U2). The canvas `data-symbol-set` always names the selected set. |
| Zoom | `role="spinbutton"` name `Zoom %`; commits on change, clamps to `config.min_zoom_pct`..`config.max_zoom_pct` (10–4000), and reflects the clamped value; grid lines auto-hide below `config.grid_auto_hide_below_zoom_pct` (25), observable as `data-grid-visible` flipping at the boundary (AC-F009-02). |
| Pan | Buttons `Pan up` / `Pan down` / `Pan left` / `Pan right`; the center stays within the canvas: `data-center-x` ∈ [0, width−1], `data-center-y` ∈ [0, height−1] (AC-F009-02). |
| Symbol key | `role="list"` name `Symbol key`; one `role="listitem"` per color used in the committed chart, ordered by color index, each carrying `data-color-index` and `data-glyph-name`; glyph names are unique across items (AC-F009-01); the list is identical across all three styles (AC-F009-04) and equal to the persisted `SymbolAssignment` mapping. |

A document that predates M2 view state (e.g. a seeded document) gets its
ChartView/SymbolAssignment initialised once on first open (rule
`DocumentViewInitialised`'s migration guidance) — no chart is ever shown
without exactly one initialised view state.

**Seeded documents.** Tests may seed a store record directly into IndexedDB
(DB `sng`, object store `store`, key `store` — see `tests/helpers.ts`);
a seeded document's `cells` array may be **sparse** (only non-empty cells):
cells absent from the array render as empty. This keeps large-document
benchmarks (the 1000×1000 NFR-P2 chart) cheap to seed.

**Performance measurement.** NFR-P2 (`PanZoomPerformance`, AC-F009-03) is
measured by `tests/chart-performance.spec.ts` with an S3-style rAF
frame-time harness during continuous drag-pan and wheel-zoom, asserting a
sustained `config.min_pan_zoom_fps` (55) on a
`config.p2_benchmark_chart_width`×`config.p2_benchmark_chart_height`
(1000×1000) chart; the environment is recorded in the test report (user
decision 2026-11-10: fanless Apple M2 Air, headless Chromium; Windows
re-verification is an M3 target-hardware task).

## Persistence contract

State must survive full page reloads and context (browser) restarts via
IndexedDB: library entries keep name, thumbnail, and last-edited text
(LibraryPersists, AC-F014-01); committed gestures survive a force-close
(CrashRecovery, NFR-A3); an undone gesture does not resurrect after restart
(UndoPersists, AC-F045-04 local half).

## Network boundary contract

`LocalOnlyBoundary` / `NoUnpublishedEgress`: while creating, editing, renaming,
duplicating, or exporting, every network request must be a same-origin
`GET`/`HEAD` for a static asset (or `/`). No `POST`/`PUT`/`PATCH`, no
cross-origin requests, ever.

## Obligation mapping

Each test file names the obligation(s) it exercises in its header comment.
Domain-level obligations (rules, invariants, value/entity structure, config
defaults, Editor surface guards, LibraryBrowser actor/exposure) are covered by
the gleeunit suite (`app/test/sng/`, 150 tests) and are not re-tested here.
The M2 chart-view obligations of `specs/m2-chart-core.allium` (surface
ChartViewControls guarantees, SymbolLibrary exposure, NFR-P2 measurement) are
browser-level by nature and live in `tests/chart-view.spec.ts` and
`tests/chart-performance.spec.ts`; their domain halves (rules ChartStyleSelected
/ ChartZoomed / ChartPanned, derived fields, ChartViewUniquePerDocument,
StyleMappingConsistency) are covered by `app/test/sng/chart_test.gleam`.
