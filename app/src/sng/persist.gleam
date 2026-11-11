//// Store serialization: the exact bytes the persistence adapter (IndexedDB,
//// M1 FFI) writes and reads back. Guarantees exercised through this seam:
////   LibraryPersists  (AC-F014-01) — documents survive restarts
////   CrashRecovery    (NFR-A3)     — reopening restores the last committed state
////   UndoPersists     (AC-F045-04) — the log (including undo entries) survives
////
//// JSON via gleam_json both directions; no FFI needed.

import gleam/dynamic/decode.{type Decoder}
import gleam/json
import gleam/option.{type Option}
import sng/store.{type Store}
import sng/types.{
  type CellChange, type CellState, type CommandVerb,
  type DocumentCommand, type DocumentEdit, type DocumentSnapshot,
  type PaletteEntry, type PatternDocument, type SourceImage,
  CellChange, CellPosition, CellState, DocumentCommand, DocumentEdit,
  DocumentSnapshot, Draw, PaletteEntry, PatternDocument, Redo, SourceImage, Undo,
}

pub type PersistError {
  Corrupt(String)
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

pub fn serialize(store: Store) -> String {
  json.to_string(encode_store(store))
}

fn encode_store(store: Store) -> json.Json {
  json.object([
    #("documents", json.array(store.documents, encode_document)),
    #("commands", json.array(store.commands, encode_command)),
    #("snapshots", json.array(store.snapshots, encode_snapshot)),
    #("sources", json.array(store.sources, encode_source)),
    #("counter", json.int(store.counter)),
  ])
}

fn encode_document(document: PatternDocument) -> json.Json {
  json.object([
    #("id", json.string(document.id)),
    #("name", json.string(document.name)),
    #("width", json.int(document.width)),
    #("height", json.int(document.height)),
    #("cells", json.array(document.cells, encode_cell)),
    #("palette", json.array(document.palette, encode_palette_entry)),
    #("created_at", json.int(document.created_at)),
    #("last_edited", json.int(document.last_edited)),
  ])
}

fn encode_command(command: DocumentCommand) -> json.Json {
  json.object([
    #("id", json.string(command.id)),
    #("document_id", json.string(command.document_id)),
    #("sequence", json.int(command.sequence)),
    #("verb", encode_verb(command.verb)),
    #("edit", encode_edit(command.edit)),
    #("inverse", encode_edit(command.inverse)),
    #("committed_at", json.int(command.committed_at)),
  ])
}

fn encode_verb(verb: CommandVerb) -> json.Json {
  case verb {
    Draw -> json.string("draw")
    Undo -> json.string("undo")
    Redo -> json.string("redo")
  }
}

fn encode_edit(edit: DocumentEdit) -> json.Json {
  json.object([#("changes", json.array(edit.changes, encode_change))])
}

fn encode_change(change: CellChange) -> json.Json {
  json.object([
    #("x", json.int(change.position.x)),
    #("y", json.int(change.position.y)),
    #("before", encode_optional_int(change.before)),
    #("after", encode_optional_int(change.after)),
  ])
}

fn encode_cell(cell: CellState) -> json.Json {
  json.object([
    #("x", json.int(cell.position.x)),
    #("y", json.int(cell.position.y)),
    #("color", encode_optional_int(cell.color_index)),
  ])
}

fn encode_optional_int(value: Option(Int)) -> json.Json {
  case value {
    option.Some(i) -> json.int(i)
    option.None -> json.null()
  }
}

fn encode_palette_entry(entry: PaletteEntry) -> json.Json {
  json.object([
    #("name", json.string(entry.name)),
    #("rgb", json.string(entry.rgb)),
  ])
}

fn encode_snapshot(snapshot: DocumentSnapshot) -> json.Json {
  json.object([
    #("id", json.string(snapshot.id)),
    #("document_id", json.string(snapshot.document_id)),
    #("sequence", json.int(snapshot.sequence)),
    #("cells", json.array(snapshot.cells, encode_cell)),
    #("taken_at", json.int(snapshot.taken_at)),
  ])
}

fn encode_source(source: SourceImage) -> json.Json {
  json.object([
    #("id", json.string(source.id)),
    #("document_id", json.string(source.document_id)),
    #("content_hash", json.string(source.content_hash)),
    #("imported_at", json.int(source.imported_at)),
  ])
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

pub fn deserialize(payload: String) -> Result(Store, PersistError) {
  case json.parse(payload, using: store_decoder()) {
    Ok(store) -> Ok(store)
    Error(_) -> Error(Corrupt("store payload did not decode"))
  }
}

fn store_decoder() -> Decoder(Store) {
  use documents <- decode.field("documents", decode.list(document_decoder()))
  use commands <- decode.field("commands", decode.list(command_decoder()))
  use snapshots <- decode.field("snapshots", decode.list(snapshot_decoder()))
  use sources <- decode.field("sources", decode.list(source_decoder()))
  use counter <- decode.field("counter", decode.int)
  decode.success(store.Store(
    documents: documents,
    commands: commands,
    snapshots: snapshots,
    sources: sources,
    counter: counter,
  ))
}

fn document_decoder() -> Decoder(PatternDocument) {
  use id <- decode.field("id", decode.string)
  use name <- decode.field("name", decode.string)
  use width <- decode.field("width", decode.int)
  use height <- decode.field("height", decode.int)
  use cells <- decode.field("cells", decode.list(cell_decoder()))
  use palette <- decode.field("palette", decode.list(palette_entry_decoder()))
  // Records written outside the app (seeded stores, pre-M2 exports) may lack
  // the timestamps; default them to 0. The migration path initialises M2 view
  // state on first open regardless.
  use created_at <- decode.optional_field("created_at", 0, decode.int)
  use last_edited <- decode.optional_field("last_edited", 0, decode.int)
  decode.success(PatternDocument(
    id: id,
    name: name,
    width: width,
    height: height,
    cells: cells,
    palette: palette,
    created_at: created_at,
    last_edited: last_edited,
  ))
}

fn command_decoder() -> Decoder(DocumentCommand) {
  use id <- decode.field("id", decode.string)
  use document_id <- decode.field("document_id", decode.string)
  use sequence <- decode.field("sequence", decode.int)
  use verb <- decode.field("verb", verb_decoder())
  use edit <- decode.field("edit", edit_decoder())
  use inverse <- decode.field("inverse", edit_decoder())
  use committed_at <- decode.field("committed_at", decode.int)
  decode.success(DocumentCommand(
    id: id,
    document_id: document_id,
    sequence: sequence,
    verb: verb,
    edit: edit,
    inverse: inverse,
    committed_at: committed_at,
  ))
}

fn verb_decoder() -> Decoder(CommandVerb) {
  decode.string
  |> decode.then(fn(verb) {
    case verb {
      "draw" -> decode.success(Draw)
      "undo" -> decode.success(Undo)
      "redo" -> decode.success(Redo)
      _ -> decode.failure(Draw, "draw | undo | redo")
    }
  })
}

fn edit_decoder() -> Decoder(DocumentEdit) {
  use changes <- decode.field("changes", decode.list(change_decoder()))
  decode.success(DocumentEdit(changes: changes))
}

fn change_decoder() -> Decoder(CellChange) {
  use x <- decode.field("x", decode.int)
  use y <- decode.field("y", decode.int)
  use before <- decode.field("before", decode.optional(decode.int))
  use after <- decode.field("after", decode.optional(decode.int))
  decode.success(CellChange(CellPosition(x, y), before, after))
}

fn cell_decoder() -> Decoder(CellState) {
  use x <- decode.field("x", decode.int)
  use y <- decode.field("y", decode.int)
  use color <- decode.field("color", decode.optional(decode.int))
  decode.success(CellState(CellPosition(x, y), color))
}

fn palette_entry_decoder() -> Decoder(PaletteEntry) {
  use name <- decode.field("name", decode.string)
  use rgb <- decode.field("rgb", decode.string)
  decode.success(PaletteEntry(name, rgb))
}

fn snapshot_decoder() -> Decoder(DocumentSnapshot) {
  use id <- decode.field("id", decode.string)
  use document_id <- decode.field("document_id", decode.string)
  use sequence <- decode.field("sequence", decode.int)
  use cells <- decode.field("cells", decode.list(cell_decoder()))
  use taken_at <- decode.field("taken_at", decode.int)
  decode.success(DocumentSnapshot(
    id: id,
    document_id: document_id,
    sequence: sequence,
    cells: cells,
    taken_at: taken_at,
  ))
}

fn source_decoder() -> Decoder(SourceImage) {
  use id <- decode.field("id", decode.string)
  use document_id <- decode.field("document_id", decode.string)
  use content_hash <- decode.field("content_hash", decode.string)
  use imported_at <- decode.field("imported_at", decode.int)
  decode.success(SourceImage(
    id: id,
    document_id: document_id,
    content_hash: content_hash,
    imported_at: imported_at,
  ))
}
