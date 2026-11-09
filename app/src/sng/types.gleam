//// Domain types for the M1 local-first foundation.
//// Mirrors specs/m1-local-foundation.allium (entities and value types).

import gleam/list
import gleam/option.{type Option}

/// Epoch milliseconds. Time is always passed in by the caller (the app shell
/// or the tests), never read from a clock inside the domain layer.
pub type Timestamp =
  Int

pub type Id =
  String

/// -- value CellPosition
pub type CellPosition {
  CellPosition(x: Int, y: Int)
}

/// -- value CellState (color_index null = empty cell)
pub type CellState {
  CellState(position: CellPosition, color_index: Option(Int))
}

/// -- value CellChange
pub type CellChange {
  CellChange(position: CellPosition, before: Option(Int), after: Option(Int))
}

/// -- value DocumentEdit
pub type DocumentEdit {
  DocumentEdit(changes: List(CellChange))
}

/// -- value PaletteEntry
pub type PaletteEntry {
  PaletteEntry(name: String, rgb: String)
}

/// -- value Thumbnail (placeholder rendering until the M2 renderer exists)
pub type Thumbnail {
  Thumbnail(data: String, generated_at: Timestamp)
}

/// -- entity User (M1: every user is anonymous; sign-in is F-002, M6)
pub type User {
  User(id: Id, has_account: Bool)
}

pub fn is_anonymous(user: User) -> Bool {
  !user.has_account
}

/// -- entity PatternDocument
pub type PatternDocument {
  PatternDocument(
    id: Id,
    name: String,
    width: Int,
    height: Int,
    /// Materialized current grid. Invariant LogMaterialization: always equal
    /// to replay_materialize() over the command log.
    cells: List(CellState),
    palette: List(PaletteEntry),
    created_at: Timestamp,
    last_edited: Timestamp,
  )
}

/// -- entity DocumentCommand (append-only log entry; state is a fold)
pub type CommandVerb {
  Draw
  Undo
  Redo
}

pub type DocumentCommand {
  DocumentCommand(
    id: Id,
    document_id: Id,
    sequence: Int,
    verb: CommandVerb,
    edit: DocumentEdit,
    inverse: DocumentEdit,
    committed_at: Timestamp,
  )
}

/// -- entity DocumentSnapshot (immutable restore point)
pub type DocumentSnapshot {
  DocumentSnapshot(
    id: Id,
    document_id: Id,
    sequence: Int,
    cells: List(CellState),
    taken_at: Timestamp,
  )
}

/// -- entity SourceImage (retained for the life of the document, PRD §7.7)
pub type SourceImage {
  SourceImage(
    id: Id,
    document_id: Id,
    content_hash: String,
    imported_at: Timestamp,
  )
}

/// -- entity AppSession
pub type AppSession {
  AppSession(
    id: Id,
    started_at: Timestamp,
    network_available: Bool,
    offline_notice_shown: Bool,
  )
}

/// Build an empty width×height grid of empty cells, row-major.
pub fn empty_grid(width: Int, height: Int) -> List(CellState) {
  list.flat_map(range_list(height), fn(y) {
    list.map(range_list(width), fn(x) {
      CellState(CellPosition(x, y), option.None)
    })
  })
}

fn range_list(n: Int) -> List(Int) {
  range_list_loop(n, [])
}

fn range_list_loop(n: Int, acc: List(Int)) -> List(Int) {
  case n <= 0 {
    True -> acc
    False -> range_list_loop(n - 1, [n - 1, ..acc])
  }
}

/// Apply an edit's changes to a grid (each change sets its cell to `after`).
pub fn apply_edit(cells: List(CellState), edit: DocumentEdit) -> List(CellState) {
  list.fold(edit.changes, cells, fn(acc, change) {
    set_cell(acc, change.position, change.after)
  })
}

fn set_cell(
  cells: List(CellState),
  position: CellPosition,
  color: Option(Int),
) -> List(CellState) {
  case cells {
    [] -> []
    [cell, ..rest] ->
      case cell.position == position {
        True -> [CellState(position, color), ..rest]
        False -> [cell, ..set_cell(rest, position, color)]
      }
  }
}

pub fn cell_at(cells: List(CellState), position: CellPosition) -> Option(Int) {
  case cells {
    [] -> option.None
    [cell, ..rest] ->
      case cell.position == position {
        True -> cell.color_index
        False -> cell_at(rest, position)
      }
  }
}
