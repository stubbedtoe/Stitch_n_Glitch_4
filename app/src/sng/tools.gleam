//// M2 editor tools (F-008) and library search (F-014): the EditorTools and
//// LibrarySearch surfaces of specs/m2-chart-core.allium.
////
//// Every tool builds one DocumentEdit and commits it through M1's store.draw,
//// so one committed gesture = one log entry (PRD §7.7, AC-F045-05) and
//// undo/redo inverses come from M1's append-only command log unchanged.
////
//// EditorToolState storage: the M1 Store record shape is pinned by M1's
//// generated tests, so the per-document tool state rides inside
//// Store.sources as a marker SourceImage (id = types.tool_state_source_id)
//// whose content_hash carries the JSON-encoded state. store.source_of
//// skips the marker, and store.delete drops it with the document.
////
//// Rasterizers (implementation choice, not pinned by the spec): Bresenham
//// line, bounding-rectangle outline, midpoint-ellipse outline; degenerate
//// shapes collapse to a single cell. Flood fill and selection-move semantics
///  are pinned by the spec's rules.

import gleam/dynamic/decode.{type Decoder}
import gleam/int
import gleam/json
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/string
import sng/store as st
import sng/types.{
  type CellPosition, type DocumentEdit, type Id, type PatternDocument,
  type SourceImage, type Timestamp, CellChange, CellPosition, DocumentEdit,
  SourceImage, cell_at, tool_state_source_id,
}

// ---------------------------------------------------------------------------
// Value types, enumerations, entities (spec: m2-chart-core.allium)
// ---------------------------------------------------------------------------

/// -- value CellRect (selection box, shape bounds).
pub type CellRect {
  CellRect(x: Int, y: Int, width: Int, height: Int)
}

/// -- enum EditorTool (F-008 toolset).
pub type EditorTool {
  Pencil
  Eraser
  FloodFill
  Line
  Rectangle
  Ellipse
  Select
  ColorPicker
}

/// -- entity EditorToolState (per-document editor session state).
pub type EditorToolState {
  EditorToolState(
    document_id: Id,
    active_tool: EditorTool,
    active_color_index: Option(Int),
    selection: Option(CellRect),
  )
}

/// -- entity SearchResults (F-014 library search execution).
pub type SearchResults {
  SearchResults(
    query: String,
    matches: List(st.LibraryEntry),
    returned_at: Timestamp,
  )
}

pub type ToolsError {
  OutOfBounds
  CellEmpty
  InvalidColorIndex
  EmptyQuery
  DocumentNotFound
  StateNotInitialised
  CorruptState
  StoreRejected
}

// ---------------------------------------------------------------------------
// rule DocumentViewInitialised (EditorToolState half) + invariant
// ToolStateUniquePerDocument
// ---------------------------------------------------------------------------

pub fn initialise_document(
  store: st.Store,
  document_id: Id,
  now: Timestamp,
) -> Result(st.Store, ToolsError) {
  case st.document(store, document_id) {
    Error(_) -> Error(DocumentNotFound)
    Ok(_) ->
      case find_marker(store, document_id) {
        Some(_) ->
          // Already initialised: never create a second state or reset the
          // existing one (invariant ToolStateUniquePerDocument).
          Ok(store)
        None ->
          Ok(
            st.Store(..store, sources: [
              marker_entry(
                document_id,
                EditorToolState(
                  document_id,
                  Pencil,
                  None,
                  None,
                ),
                now,
              ),
              ..store.sources
            ]),
          )
      }
  }
}

pub fn tool_state_of(
  store: st.Store,
  document_id: Id,
) -> Result(EditorToolState, ToolsError) {
  case st.document(store, document_id) {
    Error(_) -> Error(DocumentNotFound)
    Ok(_) ->
      case find_marker(store, document_id) {
        Some(entry) -> decode_state(document_id, entry.content_hash)
        None -> Error(StateNotInitialised)
      }
  }
}

// ---------------------------------------------------------------------------
// rule ToolSelected
// ---------------------------------------------------------------------------

pub fn select_tool(
  store: st.Store,
  document_id: Id,
  tool: EditorTool,
) -> Result(st.Store, ToolsError) {
  update_state(store, document_id, fn(state) {
    EditorToolState(..state, active_tool: tool)
  })
}

// ---------------------------------------------------------------------------
// rule ColorPicked — samples the stitch under the pointer; commits no edit.
// ---------------------------------------------------------------------------

pub fn pick_color(
  store: st.Store,
  document_id: Id,
  position: CellPosition,
) -> Result(st.Store, ToolsError) {
  case st.document(store, document_id) {
    Error(_) -> Error(DocumentNotFound)
    Ok(document) ->
      case within_grid(document, position) {
        False -> Error(OutOfBounds)
        True ->
          case cell_at(document.cells, position) {
            None -> Error(CellEmpty)
            Some(color_index) ->
              update_state(store, document_id, fn(state) {
                EditorToolState(..state, active_color_index: Some(color_index))
              })
          }
      }
  }
}

// ---------------------------------------------------------------------------
// rule EraserUsed — the whole erase stroke commits as one command; erased
// cells get after = null (rule guidance).
// ---------------------------------------------------------------------------

pub fn erase_cells(
  store: st.Store,
  document_id: Id,
  positions: List(CellPosition),
  now: Timestamp,
) -> Result(st.Store, ToolsError) {
  case st.document(store, document_id) {
    Error(_) -> Error(DocumentNotFound)
    Ok(document) ->
      // One bad cell in a stroke fails the whole gesture atomically
      // (requires: positions.all within_grid).
      case list.all(positions, fn(p) { within_grid(document, p) }) {
        False -> Error(OutOfBounds)
        True -> {
          let changes =
            list.map(positions, fn(position) {
              CellChange(position, cell_at(document.cells, position), None)
            })
          commit_edit(store, document_id, DocumentEdit(changes), now)
        }
      }
  }
}

// ---------------------------------------------------------------------------
// rule RegionFlooded — contiguous same-color (or empty) region recolored;
// one fill = one log entry, even when the fill colour matches the region.
// ---------------------------------------------------------------------------

pub fn flood_fill(
  store: st.Store,
  document_id: Id,
  origin: CellPosition,
  color_index: Int,
  now: Timestamp,
) -> Result(st.Store, ToolsError) {
  use document <- require_document(store, document_id)
  case within_grid(document, origin) {
    False -> Error(OutOfBounds)
    True ->
      case valid_color(document, color_index) {
        False -> Error(InvalidColorIndex)
        True -> {
          let target = cell_at(document.cells, origin)
          let region = flood_region(document, origin, target)
          let changes =
            list.map(region, fn(position) {
              CellChange(position, target, Some(color_index))
            })
          commit_edit(store, document_id, DocumentEdit(changes), now)
        }
      }
  }
}

// ---------------------------------------------------------------------------
// rule LineDrawn — Bresenham line; the cell set is drag-direction
// independent (endpoints normalised).
// ---------------------------------------------------------------------------

pub fn draw_line(
  store: st.Store,
  document_id: Id,
  from: CellPosition,
  to: CellPosition,
  color_index: Int,
  now: Timestamp,
) -> Result(st.Store, ToolsError) {
  use document <- require_document(store, document_id)
  case within_grid(document, from) && within_grid(document, to) {
    False -> Error(OutOfBounds)
    True ->
      case valid_color(document, color_index) {
        False -> Error(InvalidColorIndex)
        True ->
          commit_shape(store, document, document_id, line_cells(from, to), color_index, now)
      }
  }
}

// ---------------------------------------------------------------------------
// rule RectangleDrawn — bounding-rectangle outline stroke.
// ---------------------------------------------------------------------------

pub fn draw_rectangle(
  store: st.Store,
  document_id: Id,
  from: CellPosition,
  to: CellPosition,
  color_index: Int,
  now: Timestamp,
) -> Result(st.Store, ToolsError) {
  use document <- require_document(store, document_id)
  case within_grid(document, from) && within_grid(document, to) {
    False -> Error(OutOfBounds)
    True ->
      case valid_color(document, color_index) {
        False -> Error(InvalidColorIndex)
        True ->
          commit_shape(store, document, document_id, rectangle_cells(from, to), color_index, now)
      }
  }
}

// ---------------------------------------------------------------------------
// rule EllipseDrawn — midpoint-ellipse outline of the bounding rectangle.
// ---------------------------------------------------------------------------

pub fn draw_ellipse(
  store: st.Store,
  document_id: Id,
  from: CellPosition,
  to: CellPosition,
  color_index: Int,
  now: Timestamp,
) -> Result(st.Store, ToolsError) {
  use document <- require_document(store, document_id)
  case within_grid(document, from) && within_grid(document, to) {
    False -> Error(OutOfBounds)
    True ->
      case valid_color(document, color_index) {
        False -> Error(InvalidColorIndex)
        True ->
          commit_shape(store, document, document_id, ellipse_cells(from, to), color_index, now)
      }
  }
}

// ---------------------------------------------------------------------------
// rule SelectionMoved — lifts the stitches in from_rect and re-commits them
// at to_rect (offsets preserved, source cells emptied); one drag = one log
// entry; the selection box follows the move.
// ---------------------------------------------------------------------------

pub fn move_selection(
  store: st.Store,
  document_id: Id,
  from_rect: CellRect,
  to_rect: CellRect,
  now: Timestamp,
) -> Result(st.Store, ToolsError) {
  use document <- require_document(store, document_id)
  case rect_within_grid(document, from_rect) && rect_within_grid(document, to_rect) {
    False -> Error(OutOfBounds)
    True ->
      case tool_state_of(store, document_id) {
        Error(error) -> Error(error)
        Ok(state) -> {
          let clears =
            rect_positions(from_rect)
            |> list.map(fn(position) {
              CellChange(position, cell_at(document.cells, position), None)
            })
          let writes =
            rect_positions(from_rect)
            |> list.map(fn(position) {
              let destination =
                CellPosition(
                  to_rect.x + { position.x - from_rect.x },
                  to_rect.y + { position.y - from_rect.y },
                )
              CellChange(
                destination,
                cell_at(document.cells, destination),
                cell_at(document.cells, position),
              )
            })
          case
            commit_edit(
              store,
              document_id,
              DocumentEdit(list.append(clears, writes)),
              now,
            )
          {
            Error(error) -> Error(error)
            Ok(committed) ->
              Ok(replace_marker(
                committed,
                EditorToolState(..state, selection: Some(to_rect)),
              ))
          }
        }
      }
  }
}

// ---------------------------------------------------------------------------
// rule LibrarySearched — local name matching over the pattern library; the
// query and results never leave the device (SearchRunsLocally).
// ---------------------------------------------------------------------------

pub fn search_library(
  store: st.Store,
  query: String,
  now: Timestamp,
) -> Result(SearchResults, ToolsError) {
  // requires: query != ""; whitespace-only queries carry no matching
  // semantics either, so they fail the same way.
  case string.trim(query) == "" {
    True -> Error(EmptyQuery)
    False -> {
      let matches =
        st.library_view(store, now)
        |> list.filter(fn(entry) { string.contains(entry.name, query) })
      Ok(SearchResults(query: query, matches: matches, returned_at: now))
    }
  }
}

// ---------------------------------------------------------------------------
// Guards and shared commit path
// ---------------------------------------------------------------------------

fn require_document(
  store: st.Store,
  document_id: Id,
  next: fn(PatternDocument) -> Result(st.Store, ToolsError),
) -> Result(st.Store, ToolsError) {
  case st.document(store, document_id) {
    Error(_) -> Error(DocumentNotFound)
    Ok(document) -> next(document)
  }
}

fn within_grid(document: PatternDocument, position: CellPosition) -> Bool {
  position.x >= 0
  && position.x < document.width
  && position.y >= 0
  && position.y < document.height
}

fn rect_within_grid(document: PatternDocument, rect: CellRect) -> Bool {
  rect.x >= 0
  && rect.y >= 0
  && rect.x + rect.width <= document.width
  && rect.y + rect.height <= document.height
}

fn valid_color(document: PatternDocument, color_index: Int) -> Bool {
  color_index >= 0 && color_index < list.length(document.palette)
}

/// Commit a tool gesture through M1's draw so the command log, inverses,
/// snapshots, and last_edited all follow M1's rule StitchesDrawn.
fn commit_edit(
  store: st.Store,
  document_id: Id,
  edit: DocumentEdit,
  now: Timestamp,
) -> Result(st.Store, ToolsError) {
  case st.draw(store, document_id, edit, now) {
    Ok(store) -> Ok(store)
    Error(error) -> Error(map_store_error(error))
  }
}

fn commit_shape(
  store: st.Store,
  document: PatternDocument,
  document_id: Id,
  positions: List(CellPosition),
  color_index: Int,
  now: Timestamp,
) -> Result(st.Store, ToolsError) {
  let changes =
    list.map(positions, fn(position) {
      CellChange(position, cell_at(document.cells, position), Some(color_index))
    })
  commit_edit(store, document_id, DocumentEdit(changes), now)
}

fn map_store_error(error: st.StoreError) -> ToolsError {
  case error {
    st.OutOfBounds -> OutOfBounds
    st.DocumentNotFound -> DocumentNotFound
    // st.draw cannot reject a tool edit with these: the palette is non-empty
    // for every document the store creates, and bounds are pre-checked.
    _ -> StoreRejected
  }
}

fn update_state(
  store: st.Store,
  document_id: Id,
  update: fn(EditorToolState) -> EditorToolState,
) -> Result(st.Store, ToolsError) {
  case tool_state_of(store, document_id) {
    Error(error) -> Error(error)
    Ok(state) -> Ok(replace_marker(store, update(state)))
  }
}

// ---------------------------------------------------------------------------
// Rasterizers
// ---------------------------------------------------------------------------

/// Bresenham line between two cells (inclusive, both endpoints).
fn line_cells(from: CellPosition, to: CellPosition) -> List(CellPosition) {
  let dx = int.absolute_value(to.x - from.x)
  let dy = int.absolute_value(to.y - from.y)
  let sx = case from.x < to.x {
    True -> 1
    False -> -1
  }
  let sy = case from.y < to.y {
    True -> 1
    False -> -1
  }
  line_loop(from.x, from.y, to, dx, dy, sx, sy, dx - dy, [from])
  |> list.reverse
}

fn line_loop(
  x: Int,
  y: Int,
  to: CellPosition,
  dx: Int,
  dy: Int,
  sx: Int,
  sy: Int,
  err: Int,
  acc: List(CellPosition),
) -> List(CellPosition) {
  case x == to.x && y == to.y {
    True -> acc
    False -> {
      let e2 = 2 * err
      let #(next_x, err) = case e2 > -dy {
        True -> #(x + sx, err - dy)
        False -> #(x, err)
      }
      let #(next_y, err) = case e2 < dx {
        True -> #(y + sy, err + dx)
        False -> #(y, err)
      }
      line_loop(next_x, next_y, to, dx, dy, sx, sy, err, [
        CellPosition(next_x, next_y),
        ..acc
      ])
    }
  }
}

/// Outline stroke of the bounding rectangle of the two corner cells.
fn rectangle_cells(from: CellPosition, to: CellPosition) -> List(CellPosition) {
  let x0 = int.min(from.x, to.x)
  let x1 = int.max(from.x, to.x)
  let y0 = int.min(from.y, to.y)
  let y1 = int.max(from.y, to.y)
  list.flat_map(span(y0, y1), fn(y) {
    list.filter(span(x0, x1), fn(x) { x == x0 || x == x1 || y == y0 || y == y1 })
    |> list.map(fn(x) { CellPosition(x, y) })
  })
}

/// Midpoint-ellipse outline of the bounding rectangle of the two corner
/// cells. Decision parameters are scaled by 4 to keep the arithmetic
/// integral. Degenerate axes collapse to a line, a point to a single cell.
fn ellipse_cells(from: CellPosition, to: CellPosition) -> List(CellPosition) {
  let x0 = int.min(from.x, to.x)
  let x1 = int.max(from.x, to.x)
  let y0 = int.min(from.y, to.y)
  let y1 = int.max(from.y, to.y)
  let rx = x1 - x0
  let ry = y1 - y0
  case rx == 0 && ry == 0 {
    True -> [from]
    False ->
      case rx == 0 {
        True ->
          list.map(span(y0, y1), fn(y) { CellPosition(x0, y) })
        False ->
          case ry == 0 {
            True ->
              list.map(span(x0, x1), fn(x) { CellPosition(x, y0) })
            False -> {
              let assert Ok(cx) = int.divide(x0 + x1, 2)
              let assert Ok(cy) = int.divide(y0 + y1, 2)
              let erx = x1 - cx
              let ery = y1 - cy
              let rx2 = erx * erx
              let ry2 = ery * ery
              // Region 1: walk x while dx < dy, starting at (0, ry).
              let p1 = 4 * ry2 + 4 * rx2 * ery * ery - 4 * rx2 * ery + rx2 - 4
                * rx2
                * ry2
              let #(x, y, _p1, acc) =
                ellipse_region_1(0, ery, rx2, ry2, cx, cy, p1, [])
              // Region 2: walk y to 0 from the region-1 exit point.
              let p2 =
                4 * ry2 * x * x
                + 4 * ry2 * x
                + ry2
                + 4 * rx2 * { y - 1 } * { y - 1 }
                - 4
                * rx2
                * ry2
              ellipse_region_2(x, y, rx2, ry2, cx, cy, p2, acc)
              |> list.filter(fn(p) {
                p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1
              })
              |> list.unique
            }
          }
      }
  }
}

fn ellipse_region_1(
  x: Int,
  y: Int,
  rx2: Int,
  ry2: Int,
  cx: Int,
  cy: Int,
  p: Int,
  acc: List(CellPosition),
) -> #(Int, Int, Int, List(CellPosition)) {
  case ry2 * x < rx2 * y {
    False -> #(x, y, p, acc)
    True -> {
      let acc = plot_ellipse_quadrants(cx, cy, x, y, acc)
      case p < 0 {
        True ->
          ellipse_region_1(x + 1, y, rx2, ry2, cx, cy, p + 4 * ry2 * { 2 * x + 3 }, acc)
        False ->
          ellipse_region_1(
            x + 1,
            y - 1,
            rx2,
            ry2,
            cx,
            cy,
            p + 4 * ry2 * { 2 * x + 3 } + 4 * rx2 * { -2 * y + 2 },
            acc,
          )
      }
    }
  }
}

fn ellipse_region_2(
  x: Int,
  y: Int,
  rx2: Int,
  ry2: Int,
  cx: Int,
  cy: Int,
  p: Int,
  acc: List(CellPosition),
) -> List(CellPosition) {
  case y >= 0 {
    False -> acc
    True -> {
      let acc = plot_ellipse_quadrants(cx, cy, x, y, acc)
      case p > 0 {
        True ->
          ellipse_region_2(x, y - 1, rx2, ry2, cx, cy, p + 4 * rx2 * { -2 * y + 3 }, acc)
        False ->
          ellipse_region_2(
            x + 1,
            y - 1,
            rx2,
            ry2,
            cx,
            cy,
            p + 4 * ry2 * { 2 * x + 1 } + 4 * rx2 * { -2 * y + 2 },
            acc,
          )
      }
    }
  }
}

fn plot_ellipse_quadrants(
  cx: Int,
  cy: Int,
  x: Int,
  y: Int,
  acc: List(CellPosition),
) -> List(CellPosition) {
  [
    CellPosition(cx + x, cy + y),
    CellPosition(cx - x, cy + y),
    CellPosition(cx + x, cy - y),
    CellPosition(cx - x, cy - y),
    ..acc
  ]
}

/// Contiguous region of `target`-colored cells reachable from `origin`
/// (4-connectivity, boundaries and other colors stop the fill).
fn flood_region(
  document: PatternDocument,
  origin: CellPosition,
  target: Option(Int),
) -> List(CellPosition) {
  flood_loop(document, [origin], [origin], target, [origin])
}

fn flood_loop(
  document: PatternDocument,
  queue: List(CellPosition),
  visited: List(CellPosition),
  target: Option(Int),
  acc: List(CellPosition),
) -> List(CellPosition) {
  case queue {
    [] -> list.reverse(acc)
    [current, ..rest] -> {
      let candidates = [
        CellPosition(current.x, current.y - 1),
        CellPosition(current.x - 1, current.y),
        CellPosition(current.x + 1, current.y),
        CellPosition(current.x, current.y + 1),
      ]
      let fresh =
        list.filter(candidates, fn(p) {
          within_grid(document, p)
          && !list.contains(visited, p)
          && cell_at(document.cells, p) == target
        })
      flood_loop(
        document,
        list.append(rest, fresh),
        list.append(visited, fresh),
        target,
        list.append(fresh, acc),
      )
    }
  }
}

fn rect_positions(rect: CellRect) -> List(CellPosition) {
  list.flat_map(span(rect.y, rect.y + rect.height - 1), fn(y) {
    list.map(span(rect.x, rect.x + rect.width - 1), fn(x) {
      CellPosition(x, y)
    })
  })
}

/// Inclusive ascending integer span.
fn span(from: Int, to: Int) -> List(Int) {
  span_loop(int.min(from, to), int.max(from, to), [])
}

fn span_loop(from: Int, to: Int, acc: List(Int)) -> List(Int) {
  case from > to {
    True -> acc
    False -> span_loop(from, to - 1, [to, ..acc])
  }
}

// ---------------------------------------------------------------------------
// EditorToolState storage (marker SourceImage in Store.sources)
// ---------------------------------------------------------------------------

fn find_marker(store: st.Store, document_id: Id) -> Option(SourceImage) {
  list.find(store.sources, fn(source) {
    source.id == tool_state_source_id && source.document_id == document_id
  })
  |> option.from_result
}

fn marker_entry(
  document_id: Id,
  state: EditorToolState,
  now: Timestamp,
) -> SourceImage {
  SourceImage(
    id: tool_state_source_id,
    document_id: document_id,
    content_hash: encode_state(state),
    imported_at: now,
  )
}

fn replace_marker(store: st.Store, state: EditorToolState) -> st.Store {
  st.Store(..store, sources: list.map(store.sources, fn(source) {
    case
      source.id == tool_state_source_id && source.document_id == state.document_id
    {
      True -> SourceImage(..source, content_hash: encode_state(state))
      False -> source
    }
  }))
}

fn encode_state(state: EditorToolState) -> String {
  json.to_string(json.object([
    #("tool", json.string(tool_token(state.active_tool))),
    #("color", encode_optional_int(state.active_color_index)),
    #(
      "selection",
      case state.selection {
        None -> json.null()
        Some(rect) ->
          json.object([
            #("x", json.int(rect.x)),
            #("y", json.int(rect.y)),
            #("width", json.int(rect.width)),
            #("height", json.int(rect.height)),
          ])
      },
    ),
  ]))
}

fn decode_state(document_id: Id, payload: String) -> Result(EditorToolState, ToolsError) {
  case json.parse(payload, using: state_decoder(document_id)) {
    Ok(state) -> Ok(state)
    Error(_) -> Error(CorruptState)
  }
}

fn state_decoder(document_id: Id) -> Decoder(EditorToolState) {
  use tool <- decode.field("tool", decode.string)
  use color <- decode.field("color", decode.optional(decode.int))
  use selection <- decode.field("selection", decode.optional(rect_decoder()))
  case parse_tool(tool) {
    Some(active_tool) ->
      decode.success(EditorToolState(document_id, active_tool, color, selection))
    None ->
      decode.failure(
        EditorToolState(document_id, Pencil, color, selection),
        "editor tool token",
      )
  }
}

fn rect_decoder() -> Decoder(CellRect) {
  use x <- decode.field("x", decode.int)
  use y <- decode.field("y", decode.int)
  use width <- decode.field("width", decode.int)
  use height <- decode.field("height", decode.int)
  decode.success(CellRect(x:, y:, width:, height:))
}

fn encode_optional_int(value: Option(Int)) -> json.Json {
  case value {
    Some(i) -> json.int(i)
    None -> json.null()
  }
}

fn tool_token(tool: EditorTool) -> String {
  case tool {
    Pencil -> "pencil"
    Eraser -> "eraser"
    FloodFill -> "flood_fill"
    Line -> "line"
    Rectangle -> "rectangle"
    Ellipse -> "ellipse"
    Select -> "select"
    ColorPicker -> "color_picker"
  }
}

fn parse_tool(token: String) -> Option(EditorTool) {
  case token {
    "pencil" -> Some(Pencil)
    "eraser" -> Some(Eraser)
    "flood_fill" -> Some(FloodFill)
    "line" -> Some(Line)
    "rectangle" -> Some(Rectangle)
    "ellipse" -> Some(Ellipse)
    "select" -> Some(Select)
    "color_picker" -> Some(ColorPicker)
    _ -> None
  }
}
