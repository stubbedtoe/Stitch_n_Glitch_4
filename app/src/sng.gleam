//// Stitch'n'Glitch — M1 browser shell + M2 chart view: Lustre UI (library
//// browser + editor + symbol chart), PWA wiring, and the IndexedDB
//// persistence adapter on top of the domain core (sng/store, sng/persist,
//// sng/chart, sng/symbols).
////
//// Surfaces and guarantees wired here (specs/m1-local-foundation.allium,
//// specs/m2-chart-core.allium):
////   LibraryBrowser — create blank, import image stub, rename, duplicate,
////     delete behind confirmation (AC-F014-02); locally rendered thumbnails
////     (ThumbnailsRenderedLocally: SVG data URIs, no network involved)
////   Editor — pencil gestures (rule StitchesDrawn: one drag = one command),
////     undo/redo guards, local PDF export placeholder, Show chart
////   ChartViewControls / SymbolLibrary (F-009) — style switcher, symbol set
////     selector, zoom (clamped 10..4000 %, grid auto-hide below 25 %), pan
////     (clamped to the canvas), symbol key; the WebGL2 canvas is rendered off
////     the UI thread by a dedicated module worker (S3 architecture) as a
////     stateless function of the committed model
////   AppShell — no sign-in wall (AC-F001-02), non-blocking offline indicator
////     within config.offline_indicator_deadline (OfflineIndicatorTimely)
////   IndexedDB persistence — every committed operation is durable before it
////     is acknowledged (LibraryPersists, CrashRecovery, UndoPersists)

import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/float
import gleam/int
import gleam/json
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/string
import lustre
import lustre/attribute
import lustre/effect.{type Effect}
import lustre/element.{type Element}
import lustre/element/html
import lustre/event
import sng/browser_ffi
import sng/chart
import sng/chart_ffi
import sng/config
import sng/persist
import sng/persist_ffi
import sng/store
import sng/symbols
import sng/types.{
  type AppSession, type CellPosition, type PatternDocument, CellChange,
  CellPosition, DocumentEdit,
}
import sng/ui/pdf

const import_input_id = "import-image"

const default_grid_size = 8

/// DOM id of the chart canvas (the chart_ffi bridge binds a dedicated worker
/// to this element).
const chart_canvas_dom_id = "sng-chart-canvas"

/// Wheel-zoom factor, multiplicative with integer truncation (UI gesture
/// constant; the spec pins only the clamp bounds — config.min/max_zoom_pct —
/// which chart.zoom_chart applies). Truncation makes alternating zoom
/// notches drift instead of exactly cancelling.
const wheel_zoom_in_num = 6

const wheel_zoom_in_den = 5

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

type Model {
  Model(
    store: store.Store,
    session: AppSession,
    route: Route,
    // Library view state
    creating: Bool,
    create_width: String,
    create_height: String,
    renaming: Option(String),
    rename_value: String,
    pending_delete: Option(String),
    // Editor view state
    pencil_active: Bool,
    stroke: List(CellPosition),
    // Chart view state (F-009): the renderer is a stateless function of the
    // committed model, so the render effect recomputes a payload from the
    // store on every chart-affecting message. The document half (cells,
    // palette, glyph source) is cached: it changes only with the document or
    // the symbol assignment, while pan/zoom/style frames are cheap.
    chart_zoom_input: String,
    chart_drag: Option(#(Float, Float, CellPosition)),
    chart_doc_cache: Option(#(String, Int, Int, String)),
  )
}

type Route {
  Library
  Editor(id: String)
  Chart(id: String)
}

type ImportedFile {
  ImportedFile(name: String, bytes: List(Int))
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

type Msg {
  StoreLoaded(Dynamic)
  CreateFormToggled
  CreateWidthChanged(String)
  CreateHeightChanged(String)
  CreateSubmitted
  FilePicked(Dynamic)
  DocumentOpened(String)
  BackToLibrary
  RenameClicked(String)
  RenameChanged(String)
  RenameCommitted
  DuplicateClicked(String)
  DeleteClicked(String)
  DeleteConfirmed
  DeleteCancelled
  PencilToggled
  StrokeStarted(id: String, x: Int, y: Int)
  StrokeMoved(id: String, x: Int, y: Int, buttons: Int)
  StrokeEnded
  UndoClicked
  RedoClicked
  ExportClicked
  ConnectivityChanged(Bool)
  // Chart view (F-009, surface ChartViewControls + SymbolLibrary)
  ChartShown(String)
  ChartHidden
  ChartStylePicked(chart.ChartStyle)
  ChartSymbolSetPicked(String)
  ChartZoomInputChanged(String)
  ChartWheel(Float)
  ChartPanButtonClicked(Int, Int)
  ChartDragStarted(Float, Float)
  ChartDragMoved(Float, Float, Int)
  ChartDragEnded
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

fn init(_flags: Nil) -> #(Model, Effect(Msg)) {
  let now = browser_ffi.now_ms()
  #(
    Model(
      store: store.new(),
      session: store.new_session("session-1", now, browser_ffi.online()),
      route: Library,
      creating: False,
      create_width: int.to_string(default_grid_size),
      create_height: int.to_string(default_grid_size),
      renaming: None,
      rename_value: "",
      pending_delete: None,
      pencil_active: True,
      stroke: [],
      chart_zoom_input: "",
      chart_drag: None,
      chart_doc_cache: None,
    ),
    effect.batch([
      effect.from(fn(dispatch) {
        persist_ffi.load(fn(payload) { dispatch(StoreLoaded(payload)) })
      }),
      effect.from(fn(dispatch) {
        browser_ffi.watch_connectivity(
          fn(online) { dispatch(ConnectivityChanged(online)) },
          config.offline_indicator_deadline_ms,
        )
      }),
      effect.from(fn(dispatch) {
        browser_ffi.watch_pointer_end(fn() { dispatch(StrokeEnded) })
      }),
      effect.from(fn(dispatch) {
        browser_ffi.watch_pointer_end(fn() { dispatch(ChartDragEnded) })
      }),
      effect.from(fn(_) { browser_ffi.register_service_worker("/sw.js") }),
      effect.after_paint(fn(dispatch, _) {
        browser_ffi.attach_file_input(import_input_id, fn(file) {
          dispatch(FilePicked(file))
        })
      }),
    ]),
  )
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/// A committed gesture/operation is durable before it is acknowledged
/// (CrashRecovery, NFR-A3): every store mutation is persisted immediately.
fn persist(new_store: store.Store) -> Effect(Msg) {
  effect.from(fn(_) { persist_ffi.save(persist.serialize(new_store)) })
}

fn update(model: Model, msg: Msg) -> #(Model, Effect(Msg)) {
  let now = browser_ffi.now_ms()
  case msg {
    StoreLoaded(payload) -> #(
      Model(..model, store: decode_store(payload)),
      effect.none(),
    )

    CreateFormToggled -> #(
      Model(..model, creating: !model.creating),
      effect.none(),
    )

    CreateWidthChanged(value) -> #(
      Model(..model, create_width: value),
      effect.none(),
    )

    CreateHeightChanged(value) -> #(
      Model(..model, create_height: value),
      effect.none(),
    )

    CreateSubmitted -> {
      let width = int.parse(model.create_width) |> or_default(default_grid_size)
      let height =
        int.parse(model.create_height) |> or_default(default_grid_size)
      case store.create_blank(model.store, width, height, now) {
        Ok(#(new_store, document)) ->
          // rule DocumentViewInitialised: the new document gets its chart
          // view and symbol assignment right after creation.
          case chart.initialise_chart_view(new_store, document.id, now) {
            Error(_) -> #(model, effect.none())
            Ok(store_with_view) ->
              case
                symbols.initialise_assignment(store_with_view, document.id, now)
              {
                Error(_) -> #(
                  Model(
                    ..model,
                    store: store_with_view,
                    route: Editor(document.id),
                    creating: False,
                  ),
                  persist(store_with_view),
                )
                Ok(initialised) -> #(
                  Model(
                    ..model,
                    store: initialised,
                    route: Editor(document.id),
                    creating: False,
                  ),
                  persist(initialised),
                )
              }
          }
        Error(_) -> #(model, effect.none())
      }
    }

    FilePicked(file) -> {
      case decode.run(file, imported_file_decoder()) {
        Ok(ImportedFile(name, bytes)) ->
          case store.import_image_stub(model.store, name, bytes, now) {
            Ok(#(new_store, _document)) -> #(
              Model(..model, store: new_store),
              persist(new_store),
            )
            Error(_) -> #(model, effect.none())
          }
        Error(_) -> #(model, effect.none())
      }
    }

    DocumentOpened(id) -> {
      // Migration half of rule DocumentViewInitialised: a document that
      // predates M2 view state (seeded record, pre-M2 export) gets its
      // ChartView and SymbolAssignment exactly once, on first open.
      let opened = Model(..model, route: Editor(id), stroke: [])
      case chart.initialise_chart_view(opened.store, id, now) {
        Error(_) -> #(opened, effect.none())
        Ok(store_with_view) ->
          case symbols.initialise_assignment(store_with_view, id, now) {
            Error(_) -> #(
              Model(..opened, store: store_with_view),
              persist(store_with_view),
            )
            Ok(initialised) -> #(
              Model(..opened, store: initialised),
              persist(initialised),
            )
          }
      }
    }

    BackToLibrary -> #(
      Model(..model, route: Library, stroke: [], renaming: None),
      effect.none(),
    )

    RenameClicked(id) -> {
      let name = case store.document(model.store, id) {
        Ok(document) -> document.name
        Error(_) -> ""
      }
      #(Model(..model, renaming: Some(id), rename_value: name), effect.none())
    }

    RenameChanged(value) -> #(
      Model(..model, rename_value: value),
      effect.none(),
    )

    RenameCommitted -> {
      case model.renaming {
        Some(id) ->
          case store.rename(model.store, id, model.rename_value, now) {
            Ok(new_store) -> #(
              Model(..model, store: new_store, renaming: None),
              persist(new_store),
            )
            Error(_) -> #(model, effect.none())
          }
        None -> #(model, effect.none())
      }
    }

    DuplicateClicked(id) -> {
      case store.duplicate(model.store, id, now) {
        Ok(#(new_store, _copy)) -> #(
          Model(..model, store: new_store),
          persist(new_store),
        )
        Error(_) -> #(model, effect.none())
      }
    }

    DeleteClicked(id) -> #(
      Model(..model, pending_delete: Some(id)),
      effect.none(),
    )

    DeleteConfirmed -> {
      case model.pending_delete {
        Some(id) ->
          case store.delete(model.store, id) {
            Ok(new_store) -> #(
              Model(..model, store: new_store, pending_delete: None),
              persist(new_store),
            )
            Error(_) -> #(model, effect.none())
          }
        None -> #(model, effect.none())
      }
    }

    DeleteCancelled -> #(
      Model(..model, pending_delete: None),
      effect.none(),
    )

    PencilToggled -> {
      // M1 ships the pencil as the only tool (spec guidance, stitch grid +
      // pencil only): the button is a toggle, and its class/aria-pressed
      // reflect the state so the user can see whether the tool is active.
      // Strokes commit only while it is active, so the control genuinely
      // gates the gesture pipeline rather than being decorative chrome.
      #(
        Model(..model, pencil_active: !model.pencil_active),
        effect.none(),
      )
    }

    StrokeStarted(id, x, y) -> case model.pencil_active {
      True -> #(
        Model(..model, route: Editor(id), stroke: [CellPosition(x, y)]),
        effect.none(),
      )
      False -> #(model, effect.none())
    }

    StrokeMoved(id, x, y, buttons) -> {
      let position = CellPosition(x, y)
      // Only an in-progress drag accumulates cells. Two guards, because
      // pointerover fires for mere hover too:
      //   - buttons != 0: no button is held, so this is hover, not a drag;
      //   - stroke non-empty: the drag was seeded by a pointerdown on a
      //     cell (StrokeStarted), so a stroke exists to extend.
      // Without these, hovered cells would pile up and the next pointerup
      // (e.g. the click on Undo or Redo) would commit them as a phantom
      // gesture — which the button's own action would then undo/redo
      // instead of the user's real edit.
      case
        model.route == Editor(id)
        && buttons != 0
        && !list.is_empty(model.stroke)
        && !list.contains(model.stroke, position)
      {
        True -> #(
          Model(..model, stroke: [position, ..model.stroke]),
          effect.none(),
        )
        False -> #(model, effect.none())
      }
    }

    // One committed gesture = one draw command (rule StitchesDrawn): the
    // whole drag is committed as a single edit when the pointer is released.
    StrokeEnded -> {
      case model.route, model.stroke {
        Editor(id), [_first, ..] -> {
          let assert Ok(document) = store.document(model.store, id)
          let changes =
            list.map(list.reverse(model.stroke), fn(position) {
              CellChange(
                position,
                types.cell_at(document.cells, position),
                Some(0),
              )
            })
          case store.draw(model.store, id, DocumentEdit(changes), now) {
            Ok(new_store) -> #(
              Model(..model, store: new_store, stroke: []),
              persist(new_store),
            )
            Error(_) -> #(Model(..model, stroke: []), effect.none())
          }
        }
        _, _ -> #(Model(..model, stroke: []), effect.none())
      }
    }

    UndoClicked -> {
      case model.route {
        Editor(id) ->
          case store.undo(model.store, id, now) {
            Ok(new_store) -> #(Model(..model, store: new_store), persist(new_store))
            Error(_) -> #(model, effect.none())
          }
        _ -> #(model, effect.none())
      }
    }

    RedoClicked -> {
      case model.route {
        Editor(id) ->
          case store.redo(model.store, id, now) {
            Ok(new_store) -> #(Model(..model, store: new_store), persist(new_store))
            Error(_) -> #(model, effect.none())
          }
        _ -> #(model, effect.none())
      }
    }

    // ExportPdfPlaceholder: the PDF is built locally and handed to a local
    // download; nothing is transmitted (contract LocalOnlyBoundary).
    ExportClicked -> {
      case model.route {
        Editor(id) ->
          case store.document(model.store, id) {
            Ok(document) -> #(
              model,
              effect.from(fn(_) {
                browser_ffi.download_text(
                  document.name <> ".pdf",
                  pdf.build(document.name),
                )
              }),
            )
            Error(_) -> #(model, effect.none())
          }
        _ -> #(model, effect.none())
      }
    }

    // Rules OfflineIndicatorShown / OnlineIndicatorHidden: a passive status
    // region, never a dialog; editing is never interrupted.
    ConnectivityChanged(available) -> {
      let session = case available {
        True -> store.online_restored(model.session)
        False -> store.offline_detected(model.session)
      }
      #(Model(..model, session:), effect.none())
    }

    // -- Chart view (F-009) --------------------------------------------------

    ChartShown(id) -> {
      let zoom_input = case chart.chart_view_of(model.store, id) {
        Ok(view) -> int.to_string(view.zoom_pct)
        Error(_) -> model.chart_zoom_input
      }
      let opened =
        Model(..model, route: Chart(id), chart_drag: None, chart_zoom_input: zoom_input)
      with_chart_render(opened, id)
    }

    ChartHidden -> {
      case model.route {
        Chart(id) -> #(Model(..model, route: Editor(id), chart_drag: None), effect.none())
        _ -> #(model, effect.none())
      }
    }

    // rule ChartStyleSelected: the style is the document's persisted export
    // style (AC-F009-04); the mapping is untouched.
    ChartStylePicked(style) -> {
      case model.route {
        Chart(id) ->
          case chart.select_chart_style(model.store, id, style) {
            Ok(new_store) -> {
              let updated = Model(..model, store: new_store)
              let #(updated, render_fx) = with_chart_render(updated, id)
              #(updated, effect.batch([persist(new_store), render_fx]))
            }
            Error(_) -> #(model, effect.none())
          }
        _ -> #(model, effect.none())
      }
    }

    // rule SymbolSetSelected: re-runs the deterministic sequential strategy;
    // the canvas then renders (and names) the new set.
    ChartSymbolSetPicked(name) -> {
      case list.find(symbols.symbol_sets(), fn(set) { set.name == name }) {
        Error(_) -> #(model, effect.none())
        Ok(set) ->
          case model.route {
            Chart(id) ->
              case symbols.select_symbol_set(model.store, id, set, now) {
                Ok(new_store) -> {
                  let updated = Model(..model, store: new_store)
                  let #(updated, render_fx) = with_chart_render(updated, id)
                  #(updated, effect.batch([persist(new_store), render_fx]))
                }
                Error(_) -> #(model, effect.none())
              }
            _ -> #(model, effect.none())
          }
      }
    }

    // rule ChartZoomed: the zoom input commits on input, clamps to
    // config.min_zoom_pct..config.max_zoom_pct and reflects the clamped
    // value (AC-F009-02).
    ChartZoomInputChanged(value) -> {
      case model.route {
        Chart(id) ->
          case int.parse(value) {
            Error(_) -> #(
              Model(..model, chart_zoom_input: value),
              effect.none(),
            )
            Ok(requested) ->
              case chart.zoom_chart(model.store, id, requested) {
                Ok(new_store) -> {
                  let zoom = case chart.chart_view_of(new_store, id) {
                    Ok(view) -> view.zoom_pct
                    Error(_) -> requested
                  }
                  let updated =
                    Model(
                      ..model,
                      store: new_store,
                      chart_zoom_input: int.to_string(zoom),
                    )
                  let #(updated, render_fx) = with_chart_render(updated, id)
                  #(updated, effect.batch([persist(new_store), render_fx]))
                }
                Error(_) -> #(model, effect.none())
              }
          }
        _ -> #(model, effect.none())
      }
    }

    // Canvas wheel zoom: the same clamped rule ChartZoomed.
    ChartWheel(delta_y) -> {
      case model.route {
        Chart(id) ->
          case chart.chart_view_of(model.store, id) {
            Error(_) -> #(model, effect.none())
            Ok(view) -> {
              let requested = case delta_y <. 0.0 {
                True -> view.zoom_pct * wheel_zoom_in_num / wheel_zoom_in_den
                False -> view.zoom_pct * wheel_zoom_in_den / wheel_zoom_in_num
              }
              case chart.zoom_chart(model.store, id, requested) {
                Ok(new_store) -> {
                  let zoom = case chart.chart_view_of(new_store, id) {
                    Ok(next) -> next.zoom_pct
                    Error(_) -> requested
                  }
                  let updated =
                    Model(
                      ..model,
                      store: new_store,
                      chart_zoom_input: int.to_string(zoom),
                    )
                  let #(updated, render_fx) = with_chart_render(updated, id)
                  #(updated, effect.batch([persist(new_store), render_fx]))
                }
                Error(_) -> #(model, effect.none())
              }
            }
          }
        _ -> #(model, effect.none())
      }
    }

    // rule ChartPanned via the pan buttons: one cell per click, clamped.
    ChartPanButtonClicked(dx, dy) -> {
      case model.route {
        Chart(id) ->
          case chart.chart_view_of(model.store, id) {
            Error(_) -> #(model, effect.none())
            Ok(view) ->
              case
                chart.pan_chart(
                  model.store,
                  id,
                  CellPosition(view.center.x + dx, view.center.y + dy),
                )
              {
                Ok(new_store) -> {
                  let updated = Model(..model, store: new_store)
                  let #(updated, render_fx) = with_chart_render(updated, id)
                  #(updated, effect.batch([persist(new_store), render_fx]))
                }
                Error(_) -> #(model, effect.none())
              }
          }
        _ -> #(model, effect.none())
      }
    }

    // Canvas drag pan: the drag is one gesture; committed view state follows
    // the pointer (clamped by rule ChartPanned) and is persisted on release.
    ChartDragStarted(x, y) -> {
      case model.route {
        Chart(id) ->
          case chart.chart_view_of(model.store, id) {
            Ok(view) -> #(
              Model(..model, chart_drag: Some(#(x, y, view.center))),
              effect.none(),
            )
            Error(_) -> #(model, effect.none())
          }
        _ -> #(model, effect.none())
      }
    }

    ChartDragMoved(x, y, buttons) -> {
      case model.route, model.chart_drag {
        Chart(id), Some(#(start_x, start_y, start_center)) ->
          case buttons != 0 {
            False -> #(model, effect.none())
            True ->
              case chart.chart_view_of(model.store, id) {
                Error(_) -> #(model, effect.none())
                Ok(view) -> {
                  let cell_px = chart.rendered_cell_px(view.zoom_pct)
                  let dx_cells = float.truncate({ x -. start_x } /. cell_px)
                  let dy_cells = float.truncate({ y -. start_y } /. cell_px)
                  case
                    chart.pan_chart(
                      model.store,
                      id,
                      CellPosition(
                        start_center.x - dx_cells,
                        start_center.y - dy_cells,
                      ),
                    )
                  {
                    Ok(new_store) -> {
                      let updated = Model(..model, store: new_store)
                      let #(updated, render_fx) = with_chart_render(updated, id)
                      #(updated, render_fx)
                    }
                    Error(_) -> #(model, effect.none())
                  }
                }
              }
          }
        _, _ -> #(model, effect.none())
      }
    }

    ChartDragEnded -> {
      case model.chart_drag {
        Some(_) -> #(Model(..model, chart_drag: None), persist(model.store))
        None -> #(model, effect.none())
      }
    }
  }
}

fn or_default(result: Result(Int, _), default: Int) -> Int {
  case result {
    Ok(value) -> value
    Error(_) -> default
  }
}

fn decode_store(payload: Dynamic) -> store.Store {
  case decode.run(payload, decode.optional(decode.string)) {
    Ok(Some(json)) ->
      case persist.deserialize(json) {
        Ok(loaded) -> loaded
        // Corrupt record: boot with a fresh store.
        Error(_) -> store.new()
      }
    _ -> store.new()
  }
}

fn imported_file_decoder() -> decode.Decoder(ImportedFile) {
  use name <- decode.field("name", decode.string)
  use bytes <- decode.field("bytes", decode.list(decode.int))
  decode.success(ImportedFile(name:, bytes:))
}

// ---------------------------------------------------------------------------
// Chart rendering (F-009): payload builders + the render effect
// ---------------------------------------------------------------------------

/// The render effect: post the current committed chart state to the renderer
/// worker. The payload is a pure function of the model; the document half is
/// cached (rebuilt only when the document or its symbol assignment changed),
/// so pan/zoom/style frames never re-serialize the grid.
fn with_chart_render(model: Model, id: String) -> #(Model, Effect(Msg)) {
  let model = ensure_chart_doc_cache(model, id)
  let payload = chart_payload(model, id)
  #(
    model,
    effect.after_paint(fn(_, _) {
      chart_ffi.render_chart(chart_canvas_dom_id, payload)
    }),
  )
}

fn ensure_chart_doc_cache(model: Model, id: String) -> Model {
  case store.document(model.store, id) {
    Error(_) -> model
    Ok(document) -> {
      let assigned_at = case symbols.assignment_of(model.store, id) {
        Ok(assignment) -> assignment.assigned_at
        Error(_) -> 0
      }
      case model.chart_doc_cache {
        Some(#(cached_id, edited, at, _))
          if cached_id == id
          && edited == document.last_edited
          && at == assigned_at
        -> model
        _ ->
          Model(..model, chart_doc_cache: Some(#(
            id,
            document.last_edited,
            assigned_at,
            build_doc_payload(id, document, model.store),
          )))
      }
    }
  }
}

fn chart_payload(model: Model, id: String) -> String {
  let doc_part = case model.chart_doc_cache {
    Some(#(cached_id, _, _, payload)) if cached_id == id -> payload
    _ -> "null"
  }
  let view_part = case chart.chart_view_of(model.store, id) {
    Error(_) -> "{}"
    Ok(view) ->
      "{\"style\":"
      <> json_string(chart.style_token(view.style))
      <> ",\"zoom\":"
      <> int.to_string(view.zoom_pct)
      <> ",\"center\":["
      <> int.to_string(view.center.x)
      <> ","
      <> int.to_string(view.center.y)
      <> "],\"gridVisible\":"
      <> bool_string(chart.grid_visible(view))
      <> ",\"minCellPx\":"
      <> int.to_string(config.min_cell_px_at_100pct)
      <> "}"
  }
  "{\"doc\":" <> doc_part <> ",\"view\":" <> view_part <> "}"
}

/// The document half of the render payload: indexed chart data plus the
/// SingleGlyphSource glyph data (atlas input) and the color→glyph mapping.
fn build_doc_payload(
  id: String,
  document: types.PatternDocument,
  store_data: store.Store,
) -> String {
  let #(glyphs, mapping) = case symbols.assignment_of(store_data, id) {
    Ok(assignment) -> #(
      glyphs_json(assignment.symbol_set.glyphs),
      mapping_json(assignment.symbol_set.glyphs, assignment.mapping),
    )
    Error(_) -> #("[]", "[]")
  }
  let cells =
    document.cells
    |> list.filter(fn(cell) { cell.color_index != None })
    |> list.map(cell_json)
    |> string.join(",")
  let palette =
    document.palette
    |> list.map(fn(entry) { json_string(entry.rgb) })
    |> string.join(",")
  "{\"version\":"
  <> json_string(id <> ":" <> int.to_string(document.last_edited))
  <> ",\"width\":"
  <> int.to_string(document.width)
  <> ",\"height\":"
  <> int.to_string(document.height)
  <> ",\"cells\":["
  <> cells
  <> "],\"palette\":["
  <> palette
  <> "],\"glyphs\":"
  <> glyphs
  <> ",\"mapping\":"
  <> mapping
  <> "}"
}

fn cell_json(cell: types.CellState) -> String {  let color = case cell.color_index {
    Some(index) -> index
    None -> -1
  }
  "["
  <> int.to_string(cell.position.x)
  <> ","
  <> int.to_string(cell.position.y)
  <> ","
  <> int.to_string(color)
  <> "]"
}

fn glyphs_json(glyphs: List(symbols.Glyph)) -> String {
  glyphs
  |> list.map(fn(glyph) {
    "{\"name\":"
    <> json_string(glyph.name)
    <> ",\"path\":"
    <> json_string(glyph.svg_path)
    <> "}"
  })
  |> string.join(",")
  |> fn(body) { "[" <> body <> "]" }
}

/// One glyph-table index per mapping entry, in mapping (color) order; -1
/// where the glyph is not in the set (never expected, defensive).
fn mapping_json(
  glyphs: List(symbols.Glyph),
  mapping: List(symbols.ColorSymbol),
) -> String {
  mapping
  |> list.map(fn(entry) { int.to_string(glyph_index(glyphs, entry.glyph.name, 0)) })
  |> string.join(",")
  |> fn(body) { "[" <> body <> "]" }
}

fn glyph_index(glyphs: List(symbols.Glyph), name: String, index: Int) -> Int {
  case glyphs {
    [] -> -1
    [first, ..] if first.name == name -> index
    [_, ..rest] -> glyph_index(rest, name, index + 1)
  }
}

fn json_string(value: String) -> String {
  json.to_string(json.string(value))
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

fn view(model: Model) -> Element(Msg) {
  html.div([attribute.class("app")], [
    offline_indicator(model),
    case model.route {
      Library -> library_view(model)
      Editor(id) -> editor_view(model, id)
      Chart(id) -> chart_view_page(model, id)
    },
  ])
}

/// Non-blocking offline notice (role="status", not a dialog). Only rendered
/// while the session says the notice is shown, so it is hidden while online.
fn offline_indicator(model: Model) -> Element(Msg) {
  case model.session.offline_notice_shown {
    True ->
      html.div(
        [
          attribute.role("status"),
          attribute.aria_label("Offline"),
          attribute.class("offline-banner"),
        ],
        [html.text("You are offline — your work stays saved on this device.")],
      )
    False -> element.none()
  }
}

// ---------------------------------------------------------------------------
// Library browser view
// ---------------------------------------------------------------------------

fn library_view(model: Model) -> Element(Msg) {
  html.main([attribute.class("library")], [
    html.h1([], [html.text("Stitch'n'Glitch")]),
    html.p([attribute.class("tagline")], [
      html.text("Local-first pattern editor. Your work never leaves this device."),
    ]),
    html.div([attribute.class("toolbar")], [
      case model.creating {
        True -> element.none()
        False ->
          html.button([event.on_click(CreateFormToggled)], [
            html.text("Create blank document"),
          ])
      },
      html.label([attribute.class("import-control")], [
        html.text("Import image"),
        html.input([
          attribute.id(import_input_id),
          attribute.type_("file"),
          attribute.accept(["image/*"]),
        ]),
      ]),
    ]),
    case model.creating {
      True -> create_form(model)
      False -> element.none()
    },
    html.ul(
      [attribute.class("library-list")],
      list.map(store.library_view(model.store, browser_ffi.now_ms()), fn(entry) {
        library_entry_view(model, entry)
      }),
    ),
    case model.pending_delete {
      Some(id) -> delete_dialog(model, id)
      None -> element.none()
    },
  ])
}

fn create_form(model: Model) -> Element(Msg) {
  html.div([attribute.class("create-form")], [
    html.label([], [
      html.text("Width"),
      html.input([
        attribute.type_("number"),
        attribute.min("1"),
        attribute.value(model.create_width),
        event.on_input(CreateWidthChanged),
      ]),
    ]),
    html.label([], [
      html.text("Height"),
      html.input([
        attribute.type_("number"),
        attribute.min("1"),
        attribute.value(model.create_height),
        event.on_input(CreateHeightChanged),
      ]),
    ]),
    html.button([event.on_click(CreateSubmitted)], [html.text("Create")]),
  ])
}

fn library_entry_view(model: Model, entry: store.LibraryEntry) -> Element(Msg) {
  let id = entry.document_id
  html.li([attribute.class("entry")], [
    // ThumbnailsRenderedLocally: rendered on-device to a data: URI — no
    // network request is involved at any point.
    case store.document(model.store, id) {
      Ok(document) ->
        html.img([
          attribute.alt("Thumbnail of " <> entry.name),
          attribute.class("thumb"),
          attribute.src(chart.thumbnail_data_uri(document)),
        ])
      Error(_) -> element.none()
    },
    html.h3([], [html.text(entry.name)]),
    case model.renaming == Some(id) {
      True ->
        html.input([
          attribute.type_("text"),
          attribute.aria_label("Document name"),
          attribute.value(model.rename_value),
          event.on_input(RenameChanged),
          on_enter(RenameCommitted),
        ])
      False -> element.none()
    },
    html.p([attribute.class("meta")], [
      html.text("Last edited " <> int.to_string(entry.last_edited)),
    ]),
    html.div([attribute.class("actions")], [
      html.button([event.on_click(DocumentOpened(id))], [
        html.text("Open " <> entry.name),
      ]),
      html.button([event.on_click(RenameClicked(id))], [
        html.text("Rename " <> entry.name),
      ]),
      html.button([event.on_click(DuplicateClicked(id))], [
        html.text("Duplicate " <> entry.name),
      ]),
      html.button([event.on_click(DeleteClicked(id))], [
        html.text("Delete " <> entry.name),
      ]),
    ]),
  ])
}

/// Explicit confirmation gate (AC-F014-02): deletion never fires without it.
fn delete_dialog(model: Model, id: String) -> Element(Msg) {
  let name = case store.document(model.store, id) {
    Ok(document) -> document.name
    Error(_) -> ""
  }
  html.div(
    [
      attribute.role("dialog"),
      attribute.aria_label("Delete " <> name),
      attribute.class("dialog"),
    ],
    [
      html.p([], [
        html.text(
          "Delete \""
          <> name
          <> "\"? This permanently removes the document from this device.",
        ),
      ]),
      html.button([event.on_click(DeleteCancelled)], [html.text("Cancel")]),
      html.button([event.on_click(DeleteConfirmed)], [html.text("Delete")]),
    ],
  )
}

// ---------------------------------------------------------------------------
// Editor view
// ---------------------------------------------------------------------------

fn editor_view(model: Model, id: String) -> Element(Msg) {
  case store.editor_view(model.store, id) {
    Error(_) ->
      html.main([], [
        html.button([event.on_click(BackToLibrary)], [
          html.text("Back to library"),
        ]),
        html.p([], [html.text("Document not found.")]),
      ])
    Ok(editor) -> {
      let can_undo = store.can_undo(model.store, id)
      let can_redo = store.can_redo(model.store, id)
      html.main([attribute.class("editor")], [
        html.header([attribute.class("editor-bar")], [
          html.button([event.on_click(BackToLibrary)], [
            html.text("Back to library"),
          ]),
          html.h1([], [html.text(editor.name)]),
          html.button(
            [
              event.on_click(PencilToggled),
              attribute.aria_pressed(bool_string(model.pencil_active)),
              attribute.class(case model.pencil_active {
                True -> "tool active"
                False -> "tool"
              }),
            ],
            [html.text("Pencil")],
          ),
          html.button(
            [event.on_click(UndoClicked), attribute.disabled(!can_undo)],
            [html.text("Undo")],
          ),
          html.button(
            [event.on_click(RedoClicked), attribute.disabled(!can_redo)],
            [html.text("Redo")],
          ),
          html.button([event.on_click(ExportClicked)], [
            html.text("Export PDF"),
          ]),
          html.button([event.on_click(ChartShown(id))], [
            html.text("Show chart"),
          ]),
        ]),
        stitch_grid(id, editor),
      ])
    }
  }
}

fn stitch_grid(id: String, editor: store.EditorView) -> Element(Msg) {
  html.div(
    [
      attribute.role("grid"),
      attribute.aria_label("Stitch grid"),
      attribute.class("stitch-grid"),
      attribute.style(
        "grid-template-columns",
        "repeat(" <> int.to_string(editor.width) <> ", 28px)",
      ),
    ],
    list.map(editor.cells, fn(cell) {
      let x = cell.position.x
      let y = cell.position.y
      let stitched = cell.color_index != None
      let label = case stitched {
        True ->
          "Stitched cell "
          <> int.to_string(x)
          <> ", "
          <> int.to_string(y)
        False -> "Cell " <> int.to_string(x) <> ", " <> int.to_string(y)
      }
      html.div(
        [
          attribute.role("gridcell"),
          attribute.aria_label(label),
          attribute.class(case stitched {
            True -> "cell stitched"
            False -> "cell"
          }),
          // Lustre attaches these directly on the cell node, so the
          // non-bubbling hover events work during a drag.
          event.on("pointerdown", decode.success(StrokeStarted(id, x, y))),
          event.on("pointerover", {
            // buttons tells hover (0) from drag (non-zero): see StrokeMoved.
            use buttons <- decode.field("buttons", decode.int)
            decode.success(StrokeMoved(id, x, y, buttons))
          }),
        ],
        [],
      )
    }),
  )
}

fn bool_string(value: Bool) -> String {
  case value {
    True -> "true"
    False -> "false"
  }
}

/// Commit an input's value when Enter is pressed.
fn on_enter(msg: Msg) -> attribute.Attribute(Msg) {  event.on("keydown", {
    use key <- decode.field("key", decode.string)
    case key {
      "Enter" -> decode.success(msg)
      _ -> decode.failure(msg, "Enter")
    }
  })
}

// ---------------------------------------------------------------------------
// Chart view (F-009, surfaces ChartViewControls / SymbolLibrary)
// ---------------------------------------------------------------------------

type NamedStyle {
  NamedStyle(style: chart.ChartStyle, label: String)
}

/// The three spec styles, in switcher order (AC-F009-04).
fn chart_styles() -> List(NamedStyle) {
  [
    NamedStyle(chart.SymbolsOnColoredBackground, "Symbols on colored background"),
    NamedStyle(chart.ColoredSymbolsOnly, "Colored symbols only"),
    NamedStyle(chart.BlackAndWhiteSymbolsOnly, "Black and white symbols only"),
  ]
}

fn chart_view_page(model: Model, id: String) -> Element(Msg) {
  case chart.chart_view_of(model.store, id) {
    Error(_) ->
      html.main([], [
        html.button([event.on_click(BackToLibrary)], [
          html.text("Back to library"),
        ]),
        html.p([], [html.text("Chart view is not initialised for this document.")]),
      ])
    Ok(view) ->
      case store.document(model.store, id) {
        Error(_) ->
          html.main([], [
            html.button([event.on_click(BackToLibrary)], [
              html.text("Back to library"),
            ]),
            html.p([], [html.text("Document not found.")]),
          ])
        Ok(document) ->
          html.main([attribute.class("editor chart-open")], [
            html.header([attribute.class("editor-bar")], [
              html.button([event.on_click(BackToLibrary)], [
                html.text("Back to library"),
              ]),
              html.h1([], [html.text(document.name)]),
              html.button([event.on_click(ChartHidden)], [
                html.text("Back to editor"),
              ]),
            ]),
            html.section(
              [
                attribute.role("region"),
                attribute.aria_label("Chart view"),
                attribute.class("chart-view"),
              ],
              [
                chart_canvas(view, document),
                chart_controls(model, view),
                symbol_key(model, view, document),
              ],
            ),
          ])
      }
  }
}

/// The WebGL2 chart canvas. Every piece of view state is observable on the
/// element via data-* attributes (e2e/CONTRACT.md "Chart view"); the pixels
/// are drawn off the UI thread by the dedicated worker (chart_ffi).
fn chart_canvas(view: chart.ChartView, document: PatternDocument) -> Element(Msg) {
  html.canvas([
    attribute.id(chart_canvas_dom_id),
    attribute.class("chart-canvas"),
    attribute.role("img"),
    attribute.aria_label("Symbol chart"),
    attribute.style(
      "width",
      "min(720px, 100%); height: 540px; touch-action: none; display: block; border: 1px solid #999; background: #fff;",
    ),
    attribute.attribute("data-style", chart.style_token(view.style)),
    attribute.attribute("data-symbol-set", view.symbol_set.name),
    attribute.attribute("data-zoom-pct", int.to_string(view.zoom_pct)),
    attribute.attribute("data-grid-visible", bool_string(chart.grid_visible(view))),
    attribute.attribute("data-center-x", int.to_string(view.center.x)),
    attribute.attribute("data-center-y", int.to_string(view.center.y)),
    attribute.attribute("data-chart-width", int.to_string(document.width)),
    attribute.attribute("data-chart-height", int.to_string(document.height)),
    event.on("pointerdown", {
      use x <- decode.field("offsetX", decode.float)
      use y <- decode.field("offsetY", decode.float)
      decode.success(ChartDragStarted(x, y))
    }),
    event.on("pointermove", {
      use x <- decode.field("offsetX", decode.float)
      use y <- decode.field("offsetY", decode.float)
      use buttons <- decode.field("buttons", decode.int)
      decode.success(ChartDragMoved(x, y, buttons))
    }),
    event.on("wheel", {
      use delta_y <- decode.field("deltaY", decode.float)
      decode.success(ChartWheel(delta_y))
    })
      |> event.prevent_default,
  ])
}

fn chart_controls(model: Model, view: chart.ChartView) -> Element(Msg) {
  html.div([attribute.class("chart-controls")], [
    html.div(
      [attribute.role("radiogroup"), attribute.aria_label("Chart style")],
      list.map(chart_styles(), fn(named) {
        html.label([], [
          html.input([
            attribute.type_("radio"),
            attribute.name("chart-style"),
            attribute.value(chart.style_token(named.style)),
            attribute.checked(named.style == view.style),
            event.on_click(ChartStylePicked(named.style)),
          ]),
          html.text(named.label),
        ])
      }),
    ),
    html.div(
      [attribute.role("radiogroup"), attribute.aria_label("Symbol set")],
      list.map(symbols.symbol_sets(), fn(set) {
        html.label([], [
          html.input([
            attribute.type_("radio"),
            attribute.name("symbol-set"),
            attribute.attribute("data-colorblind-safe", bool_string(set.colorblind_safe)),
            attribute.checked(set.name == view.symbol_set.name),
            event.on_click(ChartSymbolSetPicked(set.name)),
          ]),
          html.text(set.name),
        ])
      }),
    ),
    html.label([], [
      html.text("Zoom %"),
      html.input([
        attribute.type_("number"),
        attribute.min(int.to_string(config.min_zoom_pct)),
        attribute.max(int.to_string(config.max_zoom_pct)),
        attribute.value(model.chart_zoom_input),
        event.on_input(ChartZoomInputChanged),
      ]),
    ]),
    html.div([attribute.class("pan-buttons")], [
      pan_button("Pan up", 0, -1),
      pan_button("Pan down", 0, 1),
      pan_button("Pan left", -1, 0),
      pan_button("Pan right", 1, 0),
    ]),
  ])
}

fn pan_button(label: String, dx: Int, dy: Int) -> Element(Msg) {
  html.button([event.on_click(ChartPanButtonClicked(dx, dy))], [html.text(label)])
}

/// The symbol key (AC-F009-01): one item per color used in the committed
/// chart, ordered by color index, identical across all three styles and equal
/// to the persisted SymbolAssignment mapping.
fn symbol_key(
  model: Model,
  view: chart.ChartView,
  document: PatternDocument,
) -> Element(Msg) {
  let usage = chart.usage_counts(document)
  let mapping = case symbols.assignment_of(model.store, view.document_id) {
    Ok(assignment) -> assignment.mapping
    Error(_) -> []
  }
  let items =
    list.filter(mapping, fn(entry) { count_at(usage, entry.color_index) > 0 })
  html.ul(
    [attribute.role("list"), attribute.aria_label("Symbol key")],
    list.map(items, fn(entry) {
      html.li(
        [
          attribute.attribute("data-color-index", int.to_string(entry.color_index)),
          attribute.attribute("data-glyph-name", entry.glyph.name),
        ],
        [
          html.text(
            name_at(document.palette, entry.color_index)
              <> ": "
              <> entry.glyph.name,
          ),
        ],
      )
    }),
  )
}

fn count_at(counts: List(Int), index: Int) -> Int {
  case counts, index {
    [], _ -> 0
    [first, ..], 0 -> first
    [_, ..rest], _ -> count_at(rest, index - 1)
  }
}

fn name_at(palette: List(types.PaletteEntry), index: Int) -> String {
  case palette, index {
    [], _ -> ""
    [first, ..], 0 -> first.name
    [_, ..rest], _ -> name_at(rest, index - 1)
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

pub fn main() -> Nil {
  let app = lustre.application(init, update, view)
  case lustre.start(app, onto: "#app", with: Nil) {
    Ok(_) -> Nil
    Error(_) -> Nil
  }
}
