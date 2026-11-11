//// The event-sourced document store: immutable snapshots + append-only
//// command log (F-014, PRD §7.7). Implements the rules and invariants of
//// specs/m1-local-foundation.allium.
////
//// State is a fold over the log: undo and redo are themselves log entries
//// carrying precomputed inverses — no cursor, no mutation of history. That
//// is what makes undo persist across sessions and crash recovery exact
//// (AC-F045-04 local half, NFR-A3, invariant LogMaterialization).

import gleam/int
import gleam/list
import sng/config
import sng/stub
import sng/types.{
  type AppSession, type CellState, type DocumentCommand, type DocumentEdit,
  type DocumentSnapshot, type Id, type PaletteEntry, type PatternDocument,
  type SourceImage, type Thumbnail, type Timestamp, type CommandVerb,
  AppSession,
  DocumentCommand, DocumentSnapshot, Draw, PatternDocument, Redo,
  SourceImage, Undo, apply_edit, empty_grid,
}

pub type Store {
  Store(
    documents: List(PatternDocument),
    commands: List(DocumentCommand),
    snapshots: List(DocumentSnapshot),
    sources: List(SourceImage),
    counter: Int,
  )
}

pub fn new() -> Store {
  Store(documents: [], commands: [], snapshots: [], sources: [], counter: 0)
}

pub type StoreError {
  DocumentNotFound
  InvalidDimensions
  EmptyPalette
  OutOfBounds
  NothingToUndo
  NothingToRedo
  EmptyName
}

// ---------------------------------------------------------------------------
// Creation (rule BlankDocumentCreated, rule ImageImportedStub)
// ---------------------------------------------------------------------------

pub fn create_blank(
  store: Store,
  width: Int,
  height: Int,
  now: Timestamp,
) -> Result(#(Store, PatternDocument), StoreError) {
  case width >= 1 && height >= 1 {
    False -> Error(InvalidDimensions)
    True -> {
      let #(store, id) = fresh_id(store, "doc")
      let document =
        PatternDocument(
          id: id,
          name: "Untitled",
          width: width,
          height: height,
          cells: empty_grid(width, height),
          palette: stub.default_stub_palette(),
          created_at: now,
          last_edited: now,
        )
      Ok(#(put_document(store, document), document))
    }
  }
}

pub fn import_image_stub(
  store: Store,
  file_name: String,
  image_bytes: List(Int),
  now: Timestamp,
) -> Result(#(Store, PatternDocument), StoreError) {
  let grid = stub.stub_convert(image_bytes)
  let #(store, doc_id) = fresh_id(store, "doc")
  let #(store, src_id) = fresh_id(store, "src")
  let document =
    PatternDocument(
      id: doc_id,
      name: file_name,
      width: grid.width,
      height: grid.height,
      cells: grid.cells,
      palette: grid.palette,
      created_at: now,
      last_edited: now,
    )
  let source =
    SourceImage(
      id: src_id,
      document_id: doc_id,
      content_hash: stub.content_hash(image_bytes),
      imported_at: now,
    )
  let store =
    store
    |> put_document(document)
    |> put_source(source)
  Ok(#(store, document))
}

// ---------------------------------------------------------------------------
// Editing (rule StitchesDrawn)
// ---------------------------------------------------------------------------

pub fn draw(
  store: Store,
  document_id: Id,
  edit: DocumentEdit,
  now: Timestamp,
) -> Result(Store, StoreError) {
  use document <- result_guard_document(store, document_id)
  case document.palette {
    [] -> Error(EmptyPalette)
    _ ->
      case all_in_bounds(document, edit) {
        False -> Error(OutOfBounds)
        True ->
          Ok(commit_command(store, document, Draw, edit, now)
            |> check_snapshot(document_id, now))
      }
  }
}

fn all_in_bounds(document: PatternDocument, edit: DocumentEdit) -> Bool {
  list.all(edit.changes, fn(change) {
    change.position.x >= 0
    && change.position.x < document.width
    && change.position.y >= 0
    && change.position.y < document.height
  })
}

// ---------------------------------------------------------------------------
// Undo / redo (rules EditUndone, EditRedone — append-only, PRD §7.7)
// ---------------------------------------------------------------------------

pub fn undo(
  store: Store,
  document_id: Id,
  now: Timestamp,
) -> Result(Store, StoreError) {
  use document <- result_guard_document(store, document_id)
  case commands_of(store, document_id) {
    [] -> Error(NothingToUndo)
    commands -> {
      let latest = list_last(commands)
      case latest.verb {
        Undo -> Error(NothingToUndo)
        _ ->
          Ok(commit_command(store, document, Undo, latest.inverse, now)
            |> check_snapshot(document_id, now))
      }
    }
  }
}

pub fn redo(
  store: Store,
  document_id: Id,
  now: Timestamp,
) -> Result(Store, StoreError) {
  use document <- result_guard_document(store, document_id)
  case commands_of(store, document_id) {
    [] -> Error(NothingToRedo)
    commands -> {
      let latest = list_last(commands)
      case latest.verb {
        Undo ->
          Ok(commit_command(store, document, Redo, latest.inverse, now)
            |> check_snapshot(document_id, now))
        _ -> Error(NothingToRedo)
      }
    }
  }
}

/// Surface provides guard: Undo is available iff the log is non-empty and
/// its newest entry is not an undo entry.
pub fn can_undo(store: Store, document_id: Id) -> Bool {
  case commands_of(store, document_id) {
    [] -> False
    commands -> list_last(commands).verb != Undo
  }
}

/// Surface provides guard: Redo is available iff the newest entry is an
/// undo entry (any edit since clears the redo path — linear history).
pub fn can_redo(store: Store, document_id: Id) -> Bool {
  case commands_of(store, document_id) {
    [] -> False
    commands -> list_last(commands).verb == Undo
  }
}

// ---------------------------------------------------------------------------
// Library operations (rules DocumentRenamed, DocumentDuplicated,
// rule DocumentDeleted)
// ---------------------------------------------------------------------------

pub fn rename(
  store: Store,
  document_id: Id,
  name: String,
  now: Timestamp,
) -> Result(Store, StoreError) {
  use document <- result_guard_document(store, document_id)
  case name == "" {
    True -> Error(EmptyName)
    False ->
      Ok(put_document(
        store,
        PatternDocument(..document, name: name, last_edited: now),
      ))
  }
}

pub fn duplicate(
  store: Store,
  document_id: Id,
  now: Timestamp,
) -> Result(#(Store, PatternDocument), StoreError) {
  use document <- result_guard_document(store, document_id)
  let #(store, id) = fresh_id(store, "doc")
  let copy =
    PatternDocument(
      id: id,
      name: document.name <> " (copy)",
      width: document.width,
      height: document.height,
      cells: document.cells,
      palette: document.palette,
      created_at: now,
      last_edited: now,
    )
  Ok(#(put_document(store, copy), copy))
}

pub fn delete(store: Store, document_id: Id) -> Result(Store, StoreError) {
  use _ <- result_guard_document(store, document_id)
  Ok(
    Store(
      ..store,
      documents: list.filter(store.documents, fn(d) { d.id != document_id }),
      commands: list.filter(store.commands, fn(c) {
        c.document_id != document_id
      }),
      snapshots: list.filter(store.snapshots, fn(s) {
        s.document_id != document_id
      }),
      sources: list.filter(store.sources, fn(s) { s.document_id != document_id }),
    )
  )
}

// ---------------------------------------------------------------------------
// Snapshots (rule SnapshotTaken; config.snapshot_interval_commands)
// ---------------------------------------------------------------------------

fn check_snapshot(store: Store, document_id: Id, now: Timestamp) -> Store {
  case pending_snapshot(store, document_id) {
    False -> store
    True -> take_snapshot(store, document_id, now)
  }
}

pub fn take_snapshot(
  store: Store,
  document_id: Id,
  now: Timestamp,
) -> Store {
  case document(store, document_id), commands_of(store, document_id) {
    Ok(document), [_first_command, ..] -> {
      let #(store, id) = fresh_id(store, "snap")
      let snapshot =
        DocumentSnapshot(
          id: id,
          document_id: document_id,
          sequence: list.length(commands_of(store, document_id)),
          cells: document.cells,
          taken_at: now,
        )
      put_snapshot(store, snapshot)
    }
    _, _ -> store
  }
}

/// Derived: commands committed since the latest snapshot.
pub fn commands_since_last_snapshot(store: Store, document_id: Id) -> Int {
  let since = case snapshots_of(store, document_id) {
    [] -> 0
    snapshots -> list_last(snapshots).sequence
  }
  list.length(commands_of(store, document_id)) - since
}

/// Derived: the SnapshotTaken condition.
pub fn pending_snapshot(store: Store, document_id: Id) -> Bool {
  commands_since_last_snapshot(store, document_id)
  >= config.snapshot_interval_commands
}

// ---------------------------------------------------------------------------
// Replay (invariant LogMaterialization)
// ---------------------------------------------------------------------------

/// Fold the command log over the latest snapshot to reconstruct the grid.
pub fn materialize(store: Store, document: PatternDocument) -> List(CellState) {
  let base = case snapshots_of(store, document.id) {
    [] -> empty_grid(document.width, document.height)
    snapshots -> list_last(snapshots).cells
  }
  let since = case snapshots_of(store, document.id) {
    [] -> 0
    snapshots -> list_last(snapshots).sequence
  }
  commands_of(store, document.id)
  |> list.filter(fn(command) { command.sequence > since })
  |> list.fold(base, fn(cells, command) { apply_edit(cells, command.edit) })
}

// ---------------------------------------------------------------------------
// Relationships / queries
// ---------------------------------------------------------------------------

pub fn document(store: Store, document_id: Id) -> Result(PatternDocument, StoreError) {
  case list.find(store.documents, fn(d) { d.id == document_id }) {
    Ok(document) -> Ok(document)
    Error(_) -> Error(DocumentNotFound)
  }
}

pub fn commands_of(store: Store, document_id: Id) -> List(DocumentCommand) {
  store.commands
  |> list.filter(fn(command) { command.document_id == document_id })
  |> list.sort(fn(a, b) { int.compare(a.sequence, b.sequence) })
}

pub fn snapshots_of(store: Store, document_id: Id) -> List(DocumentSnapshot) {
  store.snapshots
  |> list.filter(fn(snapshot) { snapshot.document_id == document_id })
  |> list.sort(fn(a, b) { int.compare(a.sequence, b.sequence) })
}

pub fn source_of(store: Store, document_id: Id) -> Result(SourceImage, StoreError) {
  // M2 marker entries (types.tool_state_source_id: editor tool state;
  // types.pipeline_state_source_id: pipeline op stack;
  // types.symbol_assignment_source_id: color→symbol assignment;
  // types.chart_view_source_id: chart view state) are not
  // source images; the retained-source query must never return them.
  case
    list.find(store.sources, fn(s) {
      s.document_id == document_id
      && s.id != types.tool_state_source_id
      && s.id != types.pipeline_state_source_id
      && s.id != types.symbol_assignment_source_id
      && s.id != types.chart_view_source_id
    })
  {
    Ok(source) -> Ok(source)
    Error(_) -> Error(DocumentNotFound)
  }
}

/// Update only `last_edited` — used by the M2 rules whose ensures touch
/// document.last_edited without committing a grid edit (pipeline ops).
pub fn touch(
  store: Store,
  document_id: Id,
  now: Timestamp,
) -> Result(Store, StoreError) {
  use document <- result_guard_document(store, document_id)
  Ok(put_document(store, PatternDocument(..document, last_edited: now)))
}

pub fn sequences_unique(store: Store, document_id: Id) -> Bool {
  let sequences = list.map(commands_of(store, document_id), fn(c) { c.sequence })
  list.length(sequences) == list.length(list.unique(sequences))
}

// ---------------------------------------------------------------------------
// Surface views (LibraryBrowser exposes, Editor exposes)
// ---------------------------------------------------------------------------

pub type LibraryEntry {
  LibraryEntry(
    document_id: Id,
    name: String,
    thumbnail: Thumbnail,
    last_edited: Timestamp,
  )
}

pub fn library_view(store: Store, now: Timestamp) -> List(LibraryEntry) {
  store.documents
  |> list.map(fn(document) {
    LibraryEntry(
      document_id: document.id,
      name: document.name,
      thumbnail: stub.render_thumbnail(document, now),
      last_edited: document.last_edited,
    )
  })
}

pub type EditorView {
  EditorView(
    document_id: Id,
    name: String,
    width: Int,
    height: Int,
    cells: List(CellState),
    palette: List(PaletteEntry),
  )
}

pub fn editor_view(
  store: Store,
  document_id: Id,
) -> Result(EditorView, StoreError) {
  use document <- result_guard_document(store, document_id)
  Ok(EditorView(
    document_id: document.id,
    name: document.name,
    width: document.width,
    height: document.height,
    cells: document.cells,
    palette: document.palette,
  ))
}

// ---------------------------------------------------------------------------
// App session (rules OfflineIndicatorShown, OnlineIndicatorHidden)
// ---------------------------------------------------------------------------

pub fn new_session(
  session_id: Id,
  started_at: Timestamp,
  network_available: Bool,
) -> AppSession {
  AppSession(
    id: session_id,
    started_at: started_at,
    network_available: network_available,
    offline_notice_shown: False,
  )
}

pub fn offline_detected(session: AppSession) -> AppSession {
  AppSession(..session, network_available: False, offline_notice_shown: True)
}

pub fn online_restored(session: AppSession) -> AppSession {
  AppSession(..session, network_available: True, offline_notice_shown: False)
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

fn commit_command(
  store: Store,
  document: PatternDocument,
  verb: CommandVerb,
  edit: DocumentEdit,
  now: Timestamp,
) -> Store {
  let #(store, command_id) = fresh_id(store, "cmd")
  let command =
    DocumentCommand(
      id: command_id,
      document_id: document.id,
      sequence: list.length(commands_of(store, document.id)) + 1,
      verb: verb,
      edit: edit,
      inverse: stub.inverse_of(document.cells, edit),
      committed_at: now,
    )
  store
  |> put_command(command)
  |> put_document(
    PatternDocument(
      ..document,
      cells: apply_edit(document.cells, edit),
      last_edited: now,
    ),
  )
}

fn fresh_id(store: Store, prefix: String) -> #(Store, Id) {
  let counter = store.counter + 1
  #(Store(..store, counter: counter), prefix <> "-" <> int.to_string(counter))
}

fn put_document(store: Store, document: PatternDocument) -> Store {
  Store(
    ..store,
    documents: [
      document,
      ..list.filter(store.documents, fn(d) { d.id != document.id })
    ],
  )
}

fn put_command(store: Store, command: DocumentCommand) -> Store {
  Store(..store, commands: [command, ..store.commands])
}

fn put_snapshot(store: Store, snapshot: DocumentSnapshot) -> Store {
  Store(..store, snapshots: [snapshot, ..store.snapshots])
}

fn put_source(store: Store, source: SourceImage) -> Store {
  Store(..store, sources: [source, ..store.sources])
}

fn list_last(list: List(a)) -> a {
  let assert Ok(item) = list.last(list)
  item
}

fn result_guard_document(
  store: Store,
  document_id: Id,
  next: fn(PatternDocument) -> Result(a, StoreError),
) -> Result(a, StoreError) {
  case document(store, document_id) {
    Ok(document) -> next(document)
    Error(error) -> Error(error)
  }
}
