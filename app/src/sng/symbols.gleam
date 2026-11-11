//// M2 curated SVG symbol library and color→symbol assignment
//// (specs/m2-chart-core.allium, F-009 / PRD v1.14): value types Glyph and
//// ColorSymbol; entities SymbolSet and SymbolAssignment; rule
//// DocumentViewInitialised (SymbolAssignment ensures clause), rule
//// SymbolSetSelected (+ its failure path); invariants SymbolUniquenessPerColor,
//// SymbolAssignmentUniquePerDocument, GlyphNamesUniquePerSet,
//// MinColorblindSafeSets; contract SingleGlyphSource (svg_path / glyph_count);
//// the SymbolLibrary surface.
////
//// Single glyph source (PRD v1.14): the SVG path data in `symbol_sets()` is
//// the one definition every consumer — WebGL glyph atlas, UI sprite, S5
//// confusability tooling, and (reserved, M5) the build-time symbol font —
//// derives from. The contract accessors svg_path / glyph_count read exactly
//// this data, never a parallel inventory.
////
//// Assignment strategy (the F-047 seam): M2 ships deterministic sequential
//// assignment — palette color i gets glyph i of the chosen set, stopping at
//// the set's glyph count (no glyph reuse past capacity). The strategy field
//// is a single-variant enum so F-047's max-min optimizer swaps in during M3
//// without renderer changes (the renderer consumes only `mapping`).
////
//// Shipped inventory: the curated launch-set inventory is a PARKED spec open
//// question (glyph lists are data curated with the S5 confusability tooling,
//// landing with F-047 in M3). M2 therefore ships the library STRUCTURE with
//// stand-in sets: simple placeholder geometry satisfying
//// config.colorblind_safe_sets_required colorblind-safe sets, unique glyph
//// names per set, and a primary set large enough to cover a fresh document's
//// stub palette (otherwise DocumentViewInitialised's unconditional
//// SymbolAssignment creation would violate SymbolUniquenessPerColor). No
//// "curated art" claims are made for this stand-in data.
////
//// SymbolAssignment storage: the M1 Store record shape is pinned by M1's
//// generated tests, so the assignment rides inside Store.sources as a marker
//// SourceImage (id = types.symbol_assignment_source_id) whose content_hash
//// carries the JSON-encoded assignment — the same convention as sng/tools'
//// toolstate marker and sng/pipeline's pipeline-state marker.
//// store.source_of skips the marker, and store.delete drops it with the
//// document.

import gleam/bool
import gleam/dynamic/decode.{type Decoder}
import gleam/json
import gleam/list
import gleam/option.{type Option, None, Some}
import sng/store as st
import sng/types.{
  type Id, type PaletteEntry, type SourceImage, type Timestamp, SourceImage,
  symbol_assignment_source_id,
}

// ---------------------------------------------------------------------------
// Value types, enumerations, entities (spec: m2-chart-core.allium)
// ---------------------------------------------------------------------------

/// -- value Glyph: one curated chart symbol — a name plus its SVG path data.
/// The path data is the single glyph source (PRD v1.14).
pub type Glyph {
  Glyph(name: String, svg_path: String)
}

/// -- value ColorSymbol: one entry of a document's color→symbol mapping.
pub type ColorSymbol {
  ColorSymbol(color_index: Int, glyph: Glyph)
}

/// -- entity SymbolSet: a curated symbol set (glyph inventory is curated
/// data, maintained with the S5 confusability tooling — see the parked open
/// question). At least config.colorblind_safe_sets_required sets are
/// colorblind-safe (NFR-U2).
pub type SymbolSet {
  SymbolSet(name: String, glyphs: List(Glyph), colorblind_safe: Bool)
}

/// -- enum AssignmentStrategy: the replaceable strategy seam (F-047). M2
/// ships sequential only; the max-min optimizer swaps in during M3 behind
/// the same field — the renderer consumes only `mapping`.
pub type AssignmentStrategy {
  Sequential
}

/// -- entity SymbolAssignment: the document's color→symbol mapping.
pub type SymbolAssignment {
  SymbolAssignment(
    document_id: Id,
    symbol_set: SymbolSet,
    strategy: AssignmentStrategy,
    mapping: List(ColorSymbol),
    assigned_at: Timestamp,
  )
}

pub type SymbolsError {
  DocumentNotFound
  StateNotInitialised
  SetNotFound
  GlyphNotFound
  NotEnoughGlyphs
  CorruptState
}

// ---------------------------------------------------------------------------
// The shipped library (stand-in inventory — see module header)
// ---------------------------------------------------------------------------

/// Every glyph ships non-empty SVG path data; the paths are simple
/// stand-in geometry (16×16 viewBox), NOT S5-curated art.
fn geometric_glyphs() -> List(Glyph) {
  [
    Glyph("square", "M2 2 H14 V14 H2 Z"),
    Glyph("circle", "M8 2 A6 6 0 1 1 8 14 A6 6 0 1 1 8 2 Z"),
    Glyph("triangle", "M8 2 L14 14 H2 Z"),
    Glyph("diamond", "M8 1 L15 8 L8 15 L1 8 Z"),
    Glyph("cross", "M6 2 H10 V6 H14 V10 H10 V14 H6 V10 H2 V6 H6 Z"),
    Glyph("star", "M8 1 L10 6 L15 6 L11 9 L13 14 L8 11 L3 14 L5 9 L1 6 L6 6 Z"),
    Glyph("heart", "M8 14 L2 8 A3.5 3.5 0 0 1 8 4 A3.5 3.5 0 0 1 14 8 Z"),
    Glyph("arrow-up", "M8 1 L12 7 H9 V15 H7 V7 H4 Z"),
    Glyph("slash", "M2 14 L12 2 L14 4 L4 14 Z"),
    Glyph("backslash", "M2 2 L4 2 L14 14 L12 14 Z"),
    Glyph("dot", "M5 5 H11 V11 H5 Z"),
    Glyph("dash", "M2 7 H14 V9 H2 Z"),
  ]
}

fn outline_glyphs() -> List(Glyph) {
  [
    Glyph("ring", "M8 2 A6 6 0 1 1 8 14 A6 6 0 1 1 8 2 Z M8 5 A3 3 0 1 0 8 11 A3 3 0 1 0 8 5 Z"),
    Glyph("square-outline", "M2 2 H14 V14 H2 Z M5 5 V11 H11 V5 Z"),
    Glyph("triangle-outline", "M8 2 L14 14 H2 Z M8 6 L11 12 H5 Z"),
    Glyph("diamond-outline", "M8 1 L15 8 L8 15 L1 8 Z M8 4 L12 8 L8 12 L4 8 Z"),
    Glyph("cross-outline", "M6 2 H10 V6 H14 V10 H10 V14 H6 V10 H2 V6 H6 Z"),
    Glyph("moon", "M13 8 A6 6 0 1 1 8 2 A5 5 0 1 0 13 8 Z"),
    Glyph("check", "M2 9 L6 13 L14 3 L12 2 L6 10 L4 7 Z"),
    Glyph("arrow-down", "M8 15 L4 9 H7 V1 H9 V9 H12 Z"),
    Glyph("plus", "M7 2 H9 V7 H14 V9 H9 V14 H7 V9 H2 V7 H7 Z"),
    Glyph("dot-outline", "M5 5 H11 V11 H5 Z M7 7 V9 H9 V7 Z"),
    Glyph("slash", "M2 14 L12 2 L14 4 L4 14 Z"),
    Glyph("dash", "M2 7 H14 V9 H2 Z"),
  ]
}

/// The shipped symbol library. Stand-in sets: both flagged colorblind-safe
/// so the invariant MinColorblindSafeSets (>= config.colorblind_safe_sets_
/// required, NFR-U2) holds; glyph names are unique within each set
/// (invariant GlyphNamesUniquePerSet). Each set carries enough stand-in
/// glyphs to cover the twelve-color documents the contract suite seeds
/// (sequential assignment stops at capacity — it never reuses a glyph to
/// fake coverage). The curated launch inventory replaces this data in
/// M3/F-047 per the spec's parked open question.
pub fn symbol_sets() -> List(SymbolSet) {
  [
    SymbolSet("stand-in-geometric", geometric_glyphs(), True),
    SymbolSet("stand-in-outline", outline_glyphs(), True),
  ]
}

/// The set DocumentViewInitialised binds a new document's assignment to.
pub fn primary_symbol_set() -> SymbolSet {
  let assert Ok(set) = list.first(symbol_sets())
  set
}

// ---------------------------------------------------------------------------
// contract SingleGlyphSource (PRD v1.14)
// ---------------------------------------------------------------------------

/// (set_name, glyph_name) -> the glyph's SVG path data. A lookup failure
/// never invents data: unknown set -> SetNotFound, unknown glyph ->
/// GlyphNotFound. This is the single source every glyph consumer derives
/// from (@invariant SingleSource).
pub fn svg_path(
  set_name: String,
  glyph_name: String,
) -> Result(String, SymbolsError) {
  use set <- result_guard(find_set(set_name))
  case list.find(set.glyphs, fn(glyph) { glyph.name == glyph_name }) {
    Ok(glyph) -> Ok(glyph.svg_path)
    Error(_) -> Error(GlyphNotFound)
  }
}

/// (set_name) -> the set's glyph count — one count per set, no parallel
/// inventory (@invariant SingleSource).
pub fn glyph_count(set_name: String) -> Result(Int, SymbolsError) {
  use set <- result_guard(find_set(set_name))
  Ok(list.length(set.glyphs))
}

fn find_set(set_name: String) -> Result(SymbolSet, SymbolsError) {
  case list.find(symbol_sets(), fn(set) { set.name == set_name }) {
    Ok(set) -> Ok(set)
    Error(_) -> Error(SetNotFound)
  }
}

fn result_guard(
  result: Result(a, SymbolsError),
  next: fn(a) -> Result(b, SymbolsError),
) -> Result(b, SymbolsError) {
  case result {
    Ok(value) -> next(value)
    Error(error) -> Error(error)
  }
}

// ---------------------------------------------------------------------------
// Sequential assignment (deterministic strategy; the F-047 seam)
// ---------------------------------------------------------------------------

/// Palette color i gets glyph i of the chosen set, in order. Stops at the
/// set's glyph count: past capacity further colors get no symbol — a glyph
/// is never reused to fake coverage. The SymbolSetSelected requires-clause
/// (palette.count <= set.glyphs.count) is the guard that keeps assignments
/// within capacity.
pub fn sequential_assign(
  set: SymbolSet,
  palette: List(PaletteEntry),
) -> List(ColorSymbol) {
  set.glyphs
  |> list.take(list.length(palette))
  |> list.index_map(fn(glyph, color_index) { ColorSymbol(color_index, glyph) })
}

// ---------------------------------------------------------------------------
// rule DocumentViewInitialised (SymbolAssignment ensures clause) + invariant
// SymbolAssignmentUniquePerDocument
// ---------------------------------------------------------------------------

/// Idempotent per-document initialisation: a new document gets its
/// sequential assignment (primary set, mapping = sequential_assign(set,
/// palette), assigned_at = now). Re-initialising never creates a second
/// assignment or resets the existing one (invariant
/// SymbolAssignmentUniquePerDocument).
pub fn initialise_assignment(
  store: st.Store,
  document_id: Id,
  now: Timestamp,
) -> Result(st.Store, SymbolsError) {
  case st.document(store, document_id) {
    Error(_) -> Error(DocumentNotFound)
    Ok(document) ->
      case find_marker(store, document_id) {
        Some(_) -> Ok(store)
        None -> {
          let assignment =
            SymbolAssignment(
              document_id: document_id,
              symbol_set: primary_symbol_set(),
              strategy: Sequential,
              mapping: sequential_assign(primary_symbol_set(), document.palette),
              assigned_at: now,
            )
          Ok(put_marker(store, assignment, now))
        }
      }
  }
}

pub fn assignment_of(
  store: st.Store,
  document_id: Id,
) -> Result(SymbolAssignment, SymbolsError) {
  case st.document(store, document_id) {
    Error(_) -> Error(DocumentNotFound)
    Ok(_) ->
      case find_marker(store, document_id) {
        Some(entry) -> decode_assignment(document_id, entry.content_hash)
        None -> Error(StateNotInitialised)
      }
  }
}

// ---------------------------------------------------------------------------
// rule SymbolSetSelected (+ failure path) and the SymbolLibrary surface guard
// ---------------------------------------------------------------------------

/// Surface provides guard (surface SymbolLibrary): SelectSymbolSet is
/// offered exactly when document.palette.count <= symbol_set.glyphs.count —
/// including exactly at capacity.
pub fn can_select(store: st.Store, document_id: Id, set: SymbolSet) -> Bool {
  case st.document(store, document_id) {
    Error(_) -> False
    Ok(document) ->
      list.length(document.palette) <= list.length(set.glyphs)
  }
}

/// Switching sets re-runs the same deterministic sequential strategy, so the
/// mapping is stable per (palette, set). A set too small for the palette is
/// rejected (NotEnoughGlyphs) and the assignment is left untouched.
pub fn select_symbol_set(
  store: st.Store,
  document_id: Id,
  set: SymbolSet,
  now: Timestamp,
) -> Result(st.Store, SymbolsError) {
  case st.document(store, document_id) {
    Error(_) -> Error(DocumentNotFound)
    Ok(document) ->
      case find_marker(store, document_id) {
        None -> Error(StateNotInitialised)
        Some(_) ->
          case
            list.length(document.palette) <= list.length(set.glyphs)
          {
            False -> Error(NotEnoughGlyphs)
            True ->
              Ok(put_marker(
                store,
                SymbolAssignment(
                  document_id: document_id,
                  symbol_set: set,
                  strategy: Sequential,
                  mapping: sequential_assign(set, document.palette),
                  assigned_at: now,
                ),
                now,
              ))
          }
      }
  }
}

// ---------------------------------------------------------------------------
// SymbolAssignment storage (marker SourceImage in Store.sources)
// ---------------------------------------------------------------------------

fn find_marker(store: st.Store, document_id: Id) -> Option(SourceImage) {
  case
    list.find(store.sources, fn(source) {
      source.id == symbol_assignment_source_id && source.document_id == document_id
    })
  {
    Ok(entry) -> Some(entry)
    Error(_) -> None
  }
}

/// Insert or replace the document's assignment marker. The marker is a
/// fresh entry (imported_at = assigned_at): a set switch records the new
/// assignment time, as rule SymbolSetSelected ensures.
fn put_marker(
  store: st.Store,
  assignment: SymbolAssignment,
  now: Timestamp,
) -> st.Store {
  let without =
    list.filter(store.sources, fn(source) {
      {
        source.id == symbol_assignment_source_id
        && source.document_id == assignment.document_id
      }
      |> bool.negate
    })
  st.Store(..store, sources: [
    SourceImage(
      id: symbol_assignment_source_id,
      document_id: assignment.document_id,
      content_hash: encode_assignment(assignment),
      imported_at: now,
    ),
    ..without
  ])
}

fn encode_assignment(assignment: SymbolAssignment) -> String {
  json.to_string(json.object([
    #("set", encode_set(assignment.symbol_set)),
    #("strategy", json.string(strategy_token(assignment.strategy))),
    #("mapping", json.array(assignment.mapping, encode_color_symbol)),
    #("assigned_at", json.int(assignment.assigned_at)),
  ]))
}

fn encode_set(set: SymbolSet) -> json.Json {
  json.object([
    #("name", json.string(set.name)),
    #("colorblind_safe", json.bool(set.colorblind_safe)),
    #("glyphs", json.array(set.glyphs, encode_glyph)),
  ])
}

fn encode_glyph(glyph: Glyph) -> json.Json {
  json.object([
    #("name", json.string(glyph.name)),
    #("path", json.string(glyph.svg_path)),
  ])
}

fn encode_color_symbol(entry: ColorSymbol) -> json.Json {
  json.object([
    #("color_index", json.int(entry.color_index)),
    #("glyph", encode_glyph(entry.glyph)),
  ])
}

fn strategy_token(strategy: AssignmentStrategy) -> String {
  case strategy {
    Sequential -> "sequential"
  }
}

fn decode_assignment(
  document_id: Id,
  payload: String,
) -> Result(SymbolAssignment, SymbolsError) {
  case json.parse(payload, using: assignment_decoder(document_id)) {
    Ok(assignment) -> Ok(assignment)
    Error(_) -> Error(CorruptState)
  }
}

fn assignment_decoder(document_id: Id) -> Decoder(SymbolAssignment) {
  use set <- decode.field("set", set_decoder())
  use strategy <- decode.field("strategy", decode.string)
  use mapping <- decode.field("mapping", decode.list(color_symbol_decoder()))
  use assigned_at <- decode.field("assigned_at", decode.int)
  case strategy {
    "sequential" ->
      decode.success(
        SymbolAssignment(document_id, set, Sequential, mapping, assigned_at),
      )
    _ ->
      decode.failure(
        SymbolAssignment(document_id, set, Sequential, mapping, assigned_at),
        "assignment strategy token",
      )
  }
}

fn set_decoder() -> Decoder(SymbolSet) {
  use name <- decode.field("name", decode.string)
  use colorblind_safe <- decode.field("colorblind_safe", decode.bool)
  use glyphs <- decode.field("glyphs", decode.list(glyph_decoder()))
  decode.success(SymbolSet(name, glyphs, colorblind_safe))
}

fn glyph_decoder() -> Decoder(Glyph) {
  use name <- decode.field("name", decode.string)
  use path <- decode.field("path", decode.string)
  decode.success(Glyph(name, path))
}

fn color_symbol_decoder() -> Decoder(ColorSymbol) {
  use color_index <- decode.field("color_index", decode.int)
  use glyph <- decode.field("glyph", glyph_decoder())
  decode.success(ColorSymbol(color_index, glyph))
}
