//// Placeholder implementations for the M1 black boxes. Each is local,
//// deterministic, and replaced by a later milestone:
////   stub_convert  → real conversion pipeline (F-003/F-004/F-005, M3)
////   default_stub_palette → brand palettes (F-010/F-011, M3)
////   render_thumbnail     → real renderer (F-009, M2)
////   content_hash  → upgraded to SHA-256 with the persistence adapter; the
////                     32-bit mix below is sufficient for M1 addressing.
////
//// Image bytes cross into the domain as List(Int) (the IndexedDB/FFI
//// adapter converts); the domain never touches BitArray syntax, keeping it
//// portable across Gleam targets.

import gleam/int
import gleam/list
import gleam/option
import gleam/string
import sng/types.{
  type CellState, type DocumentEdit, type PaletteEntry, type PatternDocument,
  type Thumbnail, type Timestamp, CellChange, CellPosition, CellState,
  DocumentEdit, PaletteEntry, Thumbnail, cell_at,
}

/// Deterministic placeholder for the M3 conversion pipeline: a 16×16 grid
/// whose cell colors are derived from the image bytes. Runs locally — the
/// image never leaves the device (LocalOnlyBoundary).
pub fn stub_convert(image_bytes: List(Int)) -> StubGrid {
  let palette = default_stub_palette()
  let width = 16
  let height = 16
  let byte_count = list.length(image_bytes)
  let cells =
    list.flat_map(range_list(height), fn(y) {
      list.map(range_list(width), fn(x) {
        let assert Ok(byte) = at_index(image_bytes, { x + y * width } % byte_count)
        CellState(CellPosition(x, y), option.Some(byte % list.length(palette)))
      })
    })
  StubGrid(width:, height:, cells:, palette:)
}

pub type StubGrid {
  StubGrid(
    width: Int,
    height: Int,
    cells: List(CellState),
    palette: List(PaletteEntry),
  )
}

fn range_list(n: Int) -> List(Int) {
  case n <= 0 {
    True -> []
    False -> range_list(n - 1) |> list.append([n - 1])
  }
}

fn at_index(list: List(a), index: Int) -> Result(a, Nil) {
  case list, index <= 0 {
    [], _ -> Error(Nil)
    [first, ..], True -> Ok(first)
    [_, ..rest], False -> at_index(rest, index - 1)
  }
}

/// Minimal placeholder palette until F-010/F-011 (M3).
pub fn default_stub_palette() -> List(PaletteEntry) {
  [
    PaletteEntry("Stub Red", "#CC0000"),
    PaletteEntry("Stub Green", "#00CC00"),
    PaletteEntry("Stub Blue", "#0000CC"),
    PaletteEntry("Stub Black", "#000000"),
  ]
}

/// Placeholder thumbnail: a deterministic marker derived from the document
/// content. Replaced by real rendering in M2 (F-009). The shape of the
/// result (data + generated_at) is the contract the library list uses.
pub fn render_thumbnail(document: PatternDocument, now: Timestamp) -> Thumbnail {
  let seed = int.to_string(list.length(document.cells)) <> "-" <> document.name
  Thumbnail(data: "stub-thumbnail:" <> seed, generated_at: now)
}

/// Deterministic 32-bit content hash, 8 hex digits. Content addressing for
/// the retained source image; upgrade to SHA-256 with the persistence
/// adapter (M1 placeholder is explicitly permitted by the spec's guidance).
pub fn content_hash(bytes: List(Int)) -> String {
  mix(bytes, 0, 5381)
}

fn mix(bytes: List(Int), acc: Int, hash: Int) -> String {
  case bytes {
    [] -> to_hex(hash)
    [byte, ..rest] -> {
      let hash = int.bitwise_and(hash * 33 + byte, 0xFFFFFFFF)
      mix(rest, acc + 1, hash)
    }
  }
}

fn to_hex(value: Int) -> String {
  let value = int.bitwise_and(value, 0xFFFFFFFF)
  let assert Ok(digits) = int.to_base_string(value, 16)
  let digits = case digits {
    "-" <> rest -> rest
    _ -> digits
  }
  string.pad_start(digits, 8, "0")
}

/// Build the inverse of an edit against the current grid: the inverse change
/// sets each cell back to the value it had before the edit (its `after` is
/// the cell's current value; its `before` is the value the edit imposed).
pub fn inverse_of(cells: List(CellState), edit: DocumentEdit) -> DocumentEdit {
  DocumentEdit(
    changes: list.map(edit.changes, fn(change) {
      CellChange(change.position, change.after, cell_at(cells, change.position))
    }),
  )
}
