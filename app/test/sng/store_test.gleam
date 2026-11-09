//// Generated from specs/m1-local-foundation.allium — rules (success, failure,
//// entity creation), invariants, relationships, derived values, and surface
//// provides guards.

import gleam/list
import gleam/option
import gleeunit/should
import sng/config
import sng/store as st
import sng/stub
import sng/types

fn change(x: Int, y: Int, after: Int) -> types.CellChange {
  types.CellChange(types.CellPosition(x, y), option.None, option.Some(after))
}

fn edit(changes: List(types.CellChange)) -> types.DocumentEdit {
  types.DocumentEdit(changes)
}

fn blank(s: st.Store) -> #(st.Store, types.PatternDocument) {
  let assert Ok(pair) = st.create_blank(s, 4, 3, 1000)
  pair
}

// -- rule BlankDocumentCreated ----------------------------------------------

pub fn blank_document_created_test() {
  let #(s, doc) = blank(st.new())
  doc.name |> should.equal("Untitled")
  doc.width |> should.equal(4)
  doc.height |> should.equal(3)
  doc.created_at |> should.equal(1000)
  doc.last_edited |> should.equal(1000)
  doc.palette |> should.not_equal([])
  list.length(s.documents) |> should.equal(1)
}

pub fn blank_document_invalid_dimensions_test() {
  st.create_blank(st.new(), 0, 5, 1000)
  |> should.equal(Error(st.InvalidDimensions))
  st.create_blank(st.new(), 5, 0, 1000)
  |> should.equal(Error(st.InvalidDimensions))
}

// -- rule ImageImportedStub --------------------------------------------------

pub fn image_imported_stub_test() {
  let bytes = [10, 20, 30, 40, 50]
  let assert Ok(#(s, doc)) = st.import_image_stub(st.new(), "photo.png", bytes, 2000)
  doc.name |> should.equal("photo.png")
  doc.width |> should.equal(16)
  doc.height |> should.equal(16)
  // Deterministic stub conversion: cell (0,0) derives from byte 0.
  types.cell_at(doc.cells, types.CellPosition(0, 0))
  |> should.equal(option.Some(10 % list.length(doc.palette)))
  // Source image retained, content-addressed.
  let assert Ok(source) = st.source_of(s, doc.id)
  source.content_hash |> should.equal(stub.content_hash(bytes))
  source.imported_at |> should.equal(2000)
}

pub fn stub_import_is_deterministic_test() {
  let bytes = [1, 2, 3]
  stub.stub_convert(bytes) |> should.equal(stub.stub_convert(bytes))
}

// -- rule StitchesDrawn -------------------------------------------------------

pub fn stitches_drawn_test() {
  let #(s, doc) = blank(st.new())
  let stroke = edit([change(1, 1, 2), change(2, 1, 2)])
  let assert Ok(s) = st.draw(s, doc.id, stroke, 3000)
  let assert Ok(updated) = st.document(s, doc.id)
  types.cell_at(updated.cells, types.CellPosition(1, 1))
  |> should.equal(option.Some(2))
  types.cell_at(updated.cells, types.CellPosition(2, 1))
  |> should.equal(option.Some(2))
  updated.last_edited |> should.equal(3000)

  let commands = st.commands_of(s, doc.id)
  list.length(commands) |> should.equal(1)
  let assert Ok(command) = list.first(commands)
  command.verb |> should.equal(types.Draw)
  command.sequence |> should.equal(1)
  // Inverse restores the pre-draw values (before=drawn color, after=old value).
  command.inverse
  |> should.equal(
    edit([
      types.CellChange(types.CellPosition(1, 1), option.Some(2), option.None),
      types.CellChange(types.CellPosition(2, 1), option.Some(2), option.None),
    ]),
  )
}

pub fn stitches_drawn_empty_palette_fails_test() {
  let doc =
    types.PatternDocument(
      id: "doc-x",
      name: "No colours",
      width: 2,
      height: 2,
      cells: types.empty_grid(2, 2),
      palette: [],
      created_at: 0,
      last_edited: 0,
    )
  let s =
    st.Store(documents: [doc], commands: [], snapshots: [], sources: [], counter: 0)
  st.draw(s, doc.id, edit([change(0, 0, 1)]), 1000)
  |> should.equal(Error(st.EmptyPalette))
}

pub fn stitches_drawn_out_of_bounds_fails_test() {
  let #(s, doc) = blank(st.new())
  // Fully outside
  st.draw(s, doc.id, edit([change(4, 0, 1)]), 1000)
  |> should.equal(Error(st.OutOfBounds))
  // Negative
  st.draw(s, doc.id, edit([change(-1, 0, 1)]), 1000)
  |> should.equal(Error(st.OutOfBounds))
  // One bad cell in a stroke fails the whole gesture atomically, leaving
  // prior committed state untouched.
  let assert Ok(s) = st.draw(s, doc.id, edit([change(0, 0, 1)]), 1000)
  st.draw(s, doc.id, edit([change(0, 0, 2), change(9, 9, 2)]), 1000)
  |> should.equal(Error(st.OutOfBounds))
  let assert Ok(unchanged) = st.document(s, doc.id)
  types.cell_at(unchanged.cells, types.CellPosition(0, 0))
  |> should.equal(option.Some(1))
}

// -- rules EditUndone / EditRedone -------------------------------------------

pub fn edit_undone_test() {
  let #(s, doc) = blank(st.new())
  let stroke = edit([change(0, 0, 1)])
  let assert Ok(s) = st.draw(s, doc.id, stroke, 1000)
  let assert Ok(s) = st.undo(s, doc.id, 2000)
  let assert Ok(updated) = st.document(s, doc.id)
  types.cell_at(updated.cells, types.CellPosition(0, 0))
  |> should.equal(option.None)
  updated.last_edited |> should.equal(2000)

  let commands = st.commands_of(s, doc.id)
  list.length(commands) |> should.equal(2)
  let assert Ok(undo_command) = list.last(commands)
  undo_command.verb |> should.equal(types.Undo)
  // The undo entry carries the draw's inverse as its edit.
  undo_command.edit
  |> should.equal(
    edit([
      types.CellChange(types.CellPosition(0, 0), option.Some(1), option.None),
    ]),
  )
}

pub fn edit_undone_empty_log_fails_test() {
  let #(s, doc) = blank(st.new())
  st.undo(s, doc.id, 1000) |> should.equal(Error(st.NothingToUndo))
}

pub fn edit_undone_twice_fails_test() {
  let #(s, doc) = blank(st.new())
  let assert Ok(s) = st.draw(s, doc.id, edit([change(0, 0, 1)]), 1000)
  let assert Ok(s) = st.undo(s, doc.id, 2000)
  st.undo(s, doc.id, 3000) |> should.equal(Error(st.NothingToUndo))
}

pub fn edit_redone_test() {
  let #(s, doc) = blank(st.new())
  let stroke = edit([change(0, 0, 1)])
  let assert Ok(s) = st.draw(s, doc.id, stroke, 1000)
  let assert Ok(s) = st.undo(s, doc.id, 2000)
  let assert Ok(s) = st.redo(s, doc.id, 3000)
  let assert Ok(updated) = st.document(s, doc.id)
  types.cell_at(updated.cells, types.CellPosition(0, 0))
  |> should.equal(option.Some(1))

  let commands = st.commands_of(s, doc.id)
  let assert Ok(redo_command) = list.last(commands)
  redo_command.verb |> should.equal(types.Redo)
  redo_command.edit |> should.equal(stroke)
}

pub fn edit_redone_without_undo_fails_test() {
  let #(s, doc) = blank(st.new())
  let assert Ok(s) = st.draw(s, doc.id, edit([change(0, 0, 1)]), 1000)
  st.redo(s, doc.id, 2000) |> should.equal(Error(st.NothingToRedo))
}

pub fn edit_redone_empty_log_fails_test() {
  let #(s, doc) = blank(st.new())
  st.redo(s, doc.id, 1000) |> should.equal(Error(st.NothingToRedo))
}

/// Linear-history regression: undo → redo → undo ends back at the empty grid,
/// and every intermediate state replays exactly (invariant LogMaterialization).
pub fn undo_redo_undo_chain_test() {
  let #(s0, doc) = blank(st.new())
  let assert Ok(s1) = st.draw(s0, doc.id, edit([change(0, 0, 1)]), 1000)
  let assert Ok(s2) = st.undo(s1, doc.id, 2000)
  let assert Ok(s3) = st.redo(s2, doc.id, 3000)
  let assert Ok(s4) = st.undo(s3, doc.id, 4000)
  let assert Ok(final) = st.document(s4, doc.id)
  types.cell_at(final.cells, types.CellPosition(0, 0))
  |> should.equal(option.None)
  materialization_holds(s4, doc.id)
}

/// A new edit after undo clears the redo path.
pub fn redo_path_cleared_by_new_edit_test() {
  let #(s0, doc) = blank(st.new())
  let assert Ok(s1) = st.draw(s0, doc.id, edit([change(0, 0, 1)]), 1000)
  let assert Ok(s2) = st.undo(s1, doc.id, 2000)
  let assert Ok(s3) = st.draw(s2, doc.id, edit([change(1, 1, 2)]), 3000)
  st.redo(s3, doc.id, 4000) |> should.equal(Error(st.NothingToRedo))
  let assert Ok(doc3) = st.document(s3, doc.id)
  types.cell_at(doc3.cells, types.CellPosition(0, 0))
  |> should.equal(option.None)
  types.cell_at(doc3.cells, types.CellPosition(1, 1))
  |> should.equal(option.Some(2))
}

// -- rules DocumentRenamed / DocumentDuplicated / DocumentDeleted -------------

pub fn document_renamed_test() {
  let #(s, doc) = blank(st.new())
  let assert Ok(s) = st.rename(s, doc.id, "Sunset", 5000)
  let assert Ok(updated) = st.document(s, doc.id)
  updated.name |> should.equal("Sunset")
  updated.last_edited |> should.equal(5000)
}

pub fn document_renamed_empty_fails_test() {
  let #(s, doc) = blank(st.new())
  st.rename(s, doc.id, "", 1000) |> should.equal(Error(st.EmptyName))
}

pub fn document_duplicated_test() {
  let #(s0, doc) = blank(st.new())
  let assert Ok(s1) = st.draw(s0, doc.id, edit([change(0, 0, 1)]), 1000)
  let assert Ok(#(s2, copy)) = st.duplicate(s1, doc.id, 2000)
  copy.name |> should.equal("Untitled (copy)")
  let assert Ok(original) = st.document(s2, doc.id)
  copy.cells |> should.equal(original.cells)
  copy.palette |> should.equal(original.palette)
  // The copy has a fresh log and no source attachment (AC-F014-02).
  st.commands_of(s2, copy.id) |> should.equal([])
  st.source_of(s2, copy.id) |> should.equal(Error(st.DocumentNotFound))
  list.length(s2.documents) |> should.equal(2)
}

pub fn document_deleted_test() {
  let #(s0, doc) = blank(st.new())
  let assert Ok(s1) = st.draw(s0, doc.id, edit([change(0, 0, 1)]), 1000)
  let s2 = st.take_snapshot(s1, doc.id, 1500)
  let assert Ok(s3) = st.delete(s2, doc.id)
  st.document(s3, doc.id) |> should.equal(Error(st.DocumentNotFound))
  st.commands_of(s3, doc.id) |> should.equal([])
  st.snapshots_of(s3, doc.id) |> should.equal([])
  st.source_of(s3, doc.id) |> should.equal(Error(st.DocumentNotFound))
}

// -- rule SnapshotTaken -------------------------------------------------------

fn draw_n(s: st.Store, doc_id: String, n: Int, from: Int) -> st.Store {
  case n <= 0 {
    True -> s
    False -> {
      let assert Ok(next) = st.draw(s, doc_id, edit([change(0, 0, n)]), from + n)
      draw_n(next, doc_id, n - 1, from)
    }
  }
}

pub fn snapshot_taken_at_interval_test() {
  let #(s, doc) = blank(st.new())
  let s = draw_n(s, doc.id, config.snapshot_interval_commands, 0)
  let snapshots = st.snapshots_of(s, doc.id)
  list.length(snapshots) |> should.equal(1)
  let assert Ok(snapshot) = list.first(snapshots)
  snapshot.sequence |> should.equal(config.snapshot_interval_commands)
  st.commands_since_last_snapshot(s, doc.id) |> should.equal(0)
  st.pending_snapshot(s, doc.id) |> should.be_false
}

pub fn snapshot_not_taken_below_interval_test() {
  let #(s, doc) = blank(st.new())
  let s = draw_n(s, doc.id, config.snapshot_interval_commands - 1, 0)
  st.snapshots_of(s, doc.id) |> should.equal([])
  st.pending_snapshot(s, doc.id) |> should.be_false
}

pub fn snapshot_requires_commands_test() {
  // rule-failure.SnapshotTaken.1: a document with no commands never snapshots.
  let #(s, doc) = blank(st.new())
  let s = st.take_snapshot(s, doc.id, 1000)
  st.snapshots_of(s, doc.id) |> should.equal([])
}

pub fn snapshot_repeats_every_interval_test() {
  let #(s, doc) = blank(st.new())
  let s = draw_n(s, doc.id, config.snapshot_interval_commands * 2, 0)
  list.length(st.snapshots_of(s, doc.id)) |> should.equal(2)
}

// -- rules OfflineIndicatorShown / OnlineIndicatorHidden ----------------------

pub fn offline_indicator_shown_and_hidden_test() {
  let session = st.new_session("session-1", 1000, True)
  session.network_available |> should.be_true
  session.offline_notice_shown |> should.be_false

  let offline = st.offline_detected(session)
  offline.network_available |> should.be_false
  offline.offline_notice_shown |> should.be_true

  let online = st.online_restored(offline)
  online.network_available |> should.be_true
  online.offline_notice_shown |> should.be_false
}

// -- invariants ---------------------------------------------------------------

fn materialization_holds(s: st.Store, doc_id: String) -> Nil {
  let assert Ok(doc) = st.document(s, doc_id)
  st.materialize(s, doc) |> should.equal(doc.cells)
}

pub fn invariant_log_materialization_test() {
  let #(s0, doc) = blank(st.new())
  materialization_holds(s0, doc.id)
  let assert Ok(s1) = st.draw(s0, doc.id, edit([change(0, 0, 1)]), 1000)
  materialization_holds(s1, doc.id)
  let assert Ok(s2) = st.draw(s1, doc.id, edit([change(1, 1, 2)]), 2000)
  materialization_holds(s2, doc.id)
  let assert Ok(s3) = st.undo(s2, doc.id, 3000)
  materialization_holds(s3, doc.id)
  let assert Ok(s4) = st.redo(s3, doc.id, 4000)
  materialization_holds(s4, doc.id)
  let assert Ok(s5) = st.draw(s4, doc.id, edit([change(2, 2, 3)]), 5000)
  materialization_holds(s5, doc.id)
}

pub fn invariant_commands_totally_ordered_test() {
  let #(s, doc) = blank(st.new())
  let s = draw_n(s, doc.id, 25, 0)
  let assert Ok(s) = st.undo(s, doc.id, 100)
  st.sequences_unique(s, doc.id) |> should.be_true
}

// -- surface provides guards ---------------------------------------------------

pub fn can_undo_can_redo_test() {
  let #(s, doc) = blank(st.new())
  st.can_undo(s, doc.id) |> should.be_false
  st.can_redo(s, doc.id) |> should.be_false

  let assert Ok(s) = st.draw(s, doc.id, edit([change(0, 0, 1)]), 1000)
  st.can_undo(s, doc.id) |> should.be_true
  st.can_redo(s, doc.id) |> should.be_false

  let assert Ok(s) = st.undo(s, doc.id, 2000)
  st.can_undo(s, doc.id) |> should.be_false
  st.can_redo(s, doc.id) |> should.be_true

  let assert Ok(s) = st.redo(s, doc.id, 3000)
  st.can_undo(s, doc.id) |> should.be_true
  st.can_redo(s, doc.id) |> should.be_false
}

// -- surface exposures ----------------------------------------------------------

pub fn library_view_exposes_name_thumbnail_last_edited_test() {
  let #(s0, doc) = blank(st.new())
  let assert Ok(s1) = st.rename(s0, doc.id, "Rose", 4000)
  let entries = st.library_view(s1, 9000)
  list.length(entries) |> should.equal(1)
  let assert Ok(entry) = list.first(entries)
  entry.document_id |> should.equal(doc.id)
  entry.name |> should.equal("Rose")
  entry.last_edited |> should.equal(4000)
  entry.thumbnail.generated_at |> should.equal(9000)
}

pub fn editor_view_exposes_document_fields_test() {
  let #(s, doc) = blank(st.new())
  let assert Ok(view) = st.editor_view(s, doc.id)
  view.document_id |> should.equal(doc.id)
  view.name |> should.equal("Untitled")
  view.width |> should.equal(4)
  view.height |> should.equal(3)
  view.cells |> should.equal(doc.cells)
  view.palette |> should.equal(doc.palette)
}

// -- surface actor: anonymous, no identity required ------------------------------

pub fn anonymous_operations_need_no_identity_test() {
  // Every operation is callable with no user, account, or session context —
  // anonymous-mode behaviour (AC-F001-02).
  let #(s0, doc) = blank(st.new())
  let assert Ok(s1) = st.draw(s0, doc.id, edit([change(0, 0, 1)]), 1000)
  let assert Ok(s2) = st.undo(s1, doc.id, 2000)
  let assert Ok(s3) = st.redo(s2, doc.id, 3000)
  let assert Ok(#(s4, _copy)) = st.duplicate(s3, doc.id, 4000)
  let assert Ok(_s5) = st.rename(s4, doc.id, "Free", 5000)
}
