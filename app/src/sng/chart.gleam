//// M2 chart core (F-009, specs/m2-chart-core.allium): entity ChartView with
//// its deriveds (grid_visible, rendered_cell_size, color_usage), rules
//// ChartStyleSelected / ChartZoomed / ChartPanned, invariants
//// ChartViewUniquePerDocument / StyleMappingConsistency, the ChartViewControls
//// surface (domain half), and local thumbnail rendering
//// (ThumbnailsRenderedLocally).
////
//// ChartView storage: the M1 Store record shape is pinned by M1's generated
//// tests, so the per-document view state rides inside Store.sources as a
//// marker SourceImage (id = types.chart_view_source_id) whose content_hash
//// carries the JSON encoding — the same convention as sng/tools' toolstate
//// marker, sng/pipeline's pipeline-state marker and sng/symbols'
//// symbol-assignment marker. store.source_of skips the marker, and
//// store.delete drops it with the document.
////
//// ChartView.symbol_set follows the document's SymbolAssignment (it is never
//// duplicated into the marker): switching sets (rule SymbolSetSelected)
//// updates the assignment, and the view exposes the set the chart actually
//// renders with. A document whose assignment is not initialised yet (the
//// view is initialised first, per the test-suite convention) exposes the
//// primary set.
////
//// StyleMappingConsistency (AC-F009-04): style is a render mode over the one
//// SymbolAssignment — selecting a style never re-assigns symbols, so the
//// rules below only touch this marker.
////
//// Thumbnails (guarantee ThumbnailsRenderedLocally): rendered locally as an
//// SVG data URI — an offscreen render on the device, no network involved.

import gleam/dynamic/decode.{type Decoder}
import gleam/int
import gleam/json
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/string
import gleam/uri
import sng/config
import sng/store as st
import sng/symbols
import sng/types.{
  type CellPosition, type Id, type PatternDocument, type SourceImage,
  type Timestamp, CellPosition, SourceImage, chart_view_source_id,
}

// ---------------------------------------------------------------------------
// Enumerations and entities (spec: m2-chart-core.allium)
// ---------------------------------------------------------------------------

/// -- enum ChartStyle: the three render modes (AC-F009-04). All three share
/// one color→symbol mapping; style is a render mode over the assignment,
/// never a per-style mapping.
pub type ChartStyle {
  SymbolsOnColoredBackground
  ColoredSymbolsOnly
  BlackAndWhiteSymbolsOnly
}

/// -- entity ChartView: per-document chart view state, persisted with the
/// document (the selected style is the export style F-013 consumes in M5).
/// `grid_visible`, `rendered_cell_size` and `color_usage` are deriveds —
/// see grid_visible/1, rendered_cell_px/1 and usage_counts/1 below.
pub type ChartView {
  ChartView(
    document_id: Id,
    style: ChartStyle,
    symbol_set: symbols.SymbolSet,
    zoom_pct: Int,
    center: CellPosition,
  )
}

pub type ChartError {
  DocumentNotFound
  StateNotInitialised
  CorruptState
}

// ---------------------------------------------------------------------------
// Deriveds (entity ChartView's computed fields)
// ---------------------------------------------------------------------------

/// ChartView.grid_visible: grid lines auto-hide below
/// config.grid_auto_hide_below_zoom_pct (AC-F009-02) — visible at and above
/// the threshold, hidden below.
pub fn grid_visible(view: ChartView) -> Bool {
  view.zoom_pct >= config.grid_auto_hide_below_zoom_pct
}

/// ChartView.rendered_cell_size: rendered_cell_px(zoom_pct) =
/// zoom_pct * config.min_cell_px_at_100pct / 100 (the 16px-cell-at-100%
/// binding, S5 / PRD v1.15).
pub fn rendered_cell_px(zoom_pct: Int) -> Float {
  int.to_float(zoom_pct) *. int.to_float(config.min_cell_px_at_100pct) /. 100.0
}

/// ChartView.color_usage: one entry per palette color, entry i = committed
/// cells with color_index i; empty cells contribute nothing. Derived from the
/// committed grid, so undo restores the counts (usage_counts over committed
/// cells only).
pub fn usage_counts(document: PatternDocument) -> List(Int) {
  let zeros = list.map(document.palette, fn(_) { 0 })
  list.fold(document.cells, zeros, fn(counts, cell) {
    case cell.color_index {
      None -> counts
      Some(index) -> bump(counts, index)
    }
  })
}

fn bump(counts: List(Int), index: Int) -> List(Int) {
  case counts, index {
    [], _ -> []
    [first, ..rest], 0 -> [first + 1, ..rest]
    [first, ..rest], _ -> [first, ..bump(rest, index - 1)]
  }
}

/// Binding: grid_center(document) = CellPosition(width / 2, height / 2),
/// integer division — the initial pan center is always a real cell.
pub fn grid_center(document: PatternDocument) -> CellPosition {
  CellPosition(document.width / 2, document.height / 2)
}

/// Binding: clamp_center keeps the viewport on the canvas — x in
/// [0, width - 1], y in [0, height - 1] (AC-F009-02: panning can never leave
/// the document bounds).
pub fn clamp_center(document: PatternDocument, center: CellPosition) -> CellPosition {
  CellPosition(
    int.clamp(center.x, 0, document.width - 1),
    int.clamp(center.y, 0, document.height - 1),
  )
}

// ---------------------------------------------------------------------------
// rule DocumentViewInitialised (ChartView ensures clause) + invariant
// ChartViewUniquePerDocument
// ---------------------------------------------------------------------------

/// Idempotent per-document initialisation: a new document gets its chart view
/// (default style symbols_on_colored_background, zoom 100, center on the grid
/// center). Re-initialising never creates a second view or resets the
/// existing one (invariant ChartViewUniquePerDocument).
pub fn initialise_chart_view(
  store: st.Store,
  document_id: Id,
  now: Timestamp,
) -> Result(st.Store, ChartError) {
  case st.document(store, document_id) {
    Error(_) -> Error(DocumentNotFound)
    Ok(document) ->
      case find_marker(store, document_id) {
        Some(_) -> Ok(store)
        None -> {
          let stored =
            StoredView(
              style: SymbolsOnColoredBackground,
              zoom_pct: 100,
              center: grid_center(document),
            )
          Ok(put_marker(store, document_id, stored, now))
        }
      }
  }
}

pub fn chart_view_of(store: st.Store, document_id: Id) -> Result(ChartView, ChartError) {
  case st.document(store, document_id) {
    Error(_) -> Error(DocumentNotFound)
    Ok(_) ->
      case find_marker(store, document_id) {
        None -> Error(StateNotInitialised)
        Some(entry) -> {
          use stored <- result_guard(decode_stored(entry.content_hash))
          Ok(ChartView(
            document_id: document_id,
            style: stored.style,
            symbol_set: view_symbol_set(store, document_id),
            zoom_pct: stored.zoom_pct,
            center: stored.center,
          ))
        }
      }
  }
}

/// ChartView.symbol_set follows the document's SymbolAssignment — the set the
/// chart actually renders with. No assignment yet (initialisation order):
/// the primary set.
fn view_symbol_set(store: st.Store, document_id: Id) -> symbols.SymbolSet {
  case symbols.assignment_of(store, document_id) {
    Ok(assignment) -> assignment.symbol_set
    Error(_) -> symbols.primary_symbol_set()
  }
}

// ---------------------------------------------------------------------------
// rules ChartStyleSelected / ChartZoomed / ChartPanned
// ---------------------------------------------------------------------------

/// rule ChartStyleSelected: the selected style is recorded on the document's
/// persisted view state (the export style F-013 consumes in M5, AC-F009-04).
/// The mapping is untouched — style is a render mode over one assignment.
pub fn select_chart_style(
  store: st.Store,
  document_id: Id,
  style: ChartStyle,
) -> Result(st.Store, ChartError) {
  update_view(store, document_id, fn(stored) {
    StoredView(..stored, style: style)
  })
}

/// rule ChartZoomed: the zoom clamps to config.min_zoom_pct..
/// config.max_zoom_pct (inclusive) — AC-F009-02's 10..4000 % bounds.
pub fn zoom_chart(
  store: st.Store,
  document_id: Id,
  zoom_pct: Int,
) -> Result(st.Store, ChartError) {
  update_view(store, document_id, fn(stored) {
    StoredView(..stored, zoom_pct: int.clamp(zoom_pct, config.min_zoom_pct, config.max_zoom_pct))
  })
}

/// rule ChartPanned: the center is clamped to the canvas cell bounds
/// (clamp_center; AC-F009-02).
pub fn pan_chart(
  store: st.Store,
  document_id: Id,
  center: CellPosition,
) -> Result(st.Store, ChartError) {
  case st.document(store, document_id) {
    Error(_) -> Error(DocumentNotFound)
    Ok(document) ->
      update_view(store, document_id, fn(stored) {
        StoredView(..stored, center: clamp_center(document, center))
      })
  }
}

// ---------------------------------------------------------------------------
// Tokens (persistence + the DOM contract)
// ---------------------------------------------------------------------------

/// The ChartStyle token of the spec enum (also the canvas `data-style`
/// contract value in e2e/CONTRACT.md).
pub fn style_token(style: ChartStyle) -> String {
  case style {
    SymbolsOnColoredBackground -> "symbols_on_colored_background"
    ColoredSymbolsOnly -> "colored_symbols_only"
    BlackAndWhiteSymbolsOnly -> "black_and_white_symbols_only"
  }
}

// ---------------------------------------------------------------------------
// Thumbnails (guarantee ThumbnailsRenderedLocally)
// ---------------------------------------------------------------------------

/// Render the document offscreen on the device to an SVG `data:` URI — the
/// library thumbnail. No network request is involved at any point; the URI is
/// same-origin data consumed straight from the attribute.
pub fn thumbnail_data_uri(document: PatternDocument) -> String {
  let rects =
    list.fold(document.cells, [], fn(acc, cell) {
      case cell.color_index {
        None -> acc
        Some(index) ->
          case color_at(document.palette, index) {
            None -> acc
            Some(rgb) -> [cell_rect(cell.position, rgb), ..acc]
          }
      }
    })
  let svg =
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 "
    <> int.to_string(document.width)
    <> " "
    <> int.to_string(document.height)
    <> "\">"
    <> string.join(list.reverse(rects), "")
    <> "</svg>"
  "data:image/svg+xml," <> uri.percent_encode(svg)
}

fn cell_rect(position: CellPosition, rgb: String) -> String {
  "<rect x=\""
  <> int.to_string(position.x)
  <> "\" y=\""
  <> int.to_string(position.y)
  <> "\" width=\"1\" height=\"1\" fill=\""
  <> rgb
  <> "\"/>"
}

fn color_at(palette: List(types.PaletteEntry), index: Int) -> Option(String) {
  case palette, index {
    [], _ -> None
    [entry, ..], 0 -> Some(entry.rgb)
    [_, ..rest], _ -> color_at(rest, index - 1)
  }
}

// ---------------------------------------------------------------------------
// ChartView storage (marker SourceImage in Store.sources)
// ---------------------------------------------------------------------------

/// The persisted fields of the view (symbol_set is derived from the
/// assignment, never stored — see view_symbol_set).
type StoredView {
  StoredView(style: ChartStyle, zoom_pct: Int, center: CellPosition)
}

fn find_marker(store: st.Store, document_id: Id) -> Option(SourceImage) {
  list.find(store.sources, fn(source) {
    source.id == chart_view_source_id && source.document_id == document_id
  })
  |> option.from_result
}

fn put_marker(
  store: st.Store,
  document_id: Id,
  stored: StoredView,
  now: Timestamp,
) -> st.Store {
  st.Store(..store, sources: [
    SourceImage(
      id: chart_view_source_id,
      document_id: document_id,
      content_hash: encode_stored(stored),
      imported_at: now,
    ),
    ..list.filter(store.sources, fn(source) {
      source.id != chart_view_source_id || source.document_id != document_id
    })
  ])
}

fn replace_marker(store: st.Store, document_id: Id, stored: StoredView) -> st.Store {
  st.Store(..store, sources: list.map(store.sources, fn(source) {
    case source.id == chart_view_source_id && source.document_id == document_id {
      True -> SourceImage(..source, content_hash: encode_stored(stored))
      False -> source
    }
  }))
}

fn update_view(
  store: st.Store,
  document_id: Id,
  update: fn(StoredView) -> StoredView,
) -> Result(st.Store, ChartError) {
  case st.document(store, document_id) {
    Error(_) -> Error(DocumentNotFound)
    Ok(_) ->
      case find_marker(store, document_id) {
        None -> Error(StateNotInitialised)
        Some(entry) -> {
          use stored <- result_guard(decode_stored(entry.content_hash))
          Ok(replace_marker(store, document_id, update(stored)))
        }
      }
  }
}

fn encode_stored(stored: StoredView) -> String {
  json.to_string(json.object([
    #("style", json.string(style_token(stored.style))),
    #("zoom_pct", json.int(stored.zoom_pct)),
    #(
      "center",
      json.object([
        #("x", json.int(stored.center.x)),
        #("y", json.int(stored.center.y)),
      ]),
    ),
  ]))
}

fn decode_stored(payload: String) -> Result(StoredView, ChartError) {
  case json.parse(payload, using: stored_decoder()) {
    Ok(stored) -> Ok(stored)
    Error(_) -> Error(CorruptState)
  }
}

fn stored_decoder() -> Decoder(StoredView) {
  use style <- decode.field("style", decode.string)
  use zoom_pct <- decode.field("zoom_pct", decode.int)
  use center <- decode.field("center", center_decoder())
  case parse_style(style) {
    Some(parsed) -> decode.success(StoredView(parsed, zoom_pct, center))
    None ->
      decode.failure(StoredView(SymbolsOnColoredBackground, zoom_pct, center), "chart style token")
  }
}

fn center_decoder() -> Decoder(CellPosition) {
  use x <- decode.field("x", decode.int)
  use y <- decode.field("y", decode.int)
  decode.success(CellPosition(x, y))
}

fn parse_style(token: String) -> Option(ChartStyle) {
  case token {
    "symbols_on_colored_background" -> Some(SymbolsOnColoredBackground)
    "colored_symbols_only" -> Some(ColoredSymbolsOnly)
    "black_and_white_symbols_only" -> Some(BlackAndWhiteSymbolsOnly)
    _ -> None
  }
}

fn result_guard(
  result: Result(a, ChartError),
  next: fn(a) -> Result(b, ChartError),
) -> Result(b, ChartError) {
  case result {
    Ok(value) -> next(value)
    Error(error) -> Error(error)
  }
}
