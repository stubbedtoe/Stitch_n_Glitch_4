//// Generated from specs/m1-local-foundation.allium — config defaults and the
//// surface guarantees that flow through persistence:
////   LibraryPersists (AC-F014-01), CrashRecovery (NFR-A3),
////   UndoPersists (AC-F045-04 local half), config defaults.

import gleam/list
import gleam/option
import gleeunit/should
import sng/config
import sng/persist
import sng/store as st
import sng/stub
import sng/types

fn change(x: Int, y: Int, after: Int) -> types.CellChange {
  types.CellChange(types.CellPosition(x, y), option.None, option.Some(after))
}

fn edit(changes: List(types.CellChange)) -> types.DocumentEdit {
  types.DocumentEdit(changes)
}

// -- config defaults ----------------------------------------------------------

pub fn config_defaults_match_spec_test() {
  // config.snapshot_interval_commands = 100
  config.snapshot_interval_commands |> should.equal(100)
  // config.offline_indicator_deadline = 5.seconds
  config.offline_indicator_deadline_ms |> should.equal(5000)
}

// -- guarantee LibraryPersists (AC-F014-01) ------------------------------------

pub fn library_persists_across_restarts_test() {
  let assert Ok(#(s0, doc)) = st.create_blank(st.new(), 4, 3, 1000)
  let assert Ok(s1) = st.rename(s0, doc.id, "Rose", 2000)
  let assert Ok(#(s2, other)) = st.create_blank(s1, 2, 2, 3000)

  // Simulate a browser restart: drop the in-memory store, keep only the
  // persisted payload.
  let payload = persist.serialize(s2)
  let assert Ok(restored) = persist.deserialize(payload)

  let entries = st.library_view(restored, 9000)
  list.length(entries) |> should.equal(2)
  let names = list.map(entries, fn(entry) { entry.name })
  list.contains(names, "Rose") |> should.be_true
  list.contains(names, "Untitled") |> should.be_true
  // Names, thumbnails, and last-edited timestamps all survive.
  let assert Ok(rose_entry) =
    list.find(entries, fn(entry) { entry.document_id == doc.id })
  rose_entry.last_edited |> should.equal(2000)
  rose_entry.thumbnail.generated_at |> should.equal(9000)
  let assert Ok(other_entry) =
    list.find(entries, fn(entry) { entry.document_id == other.id })
  other_entry.last_edited |> should.equal(3000)
}

// -- guarantee CrashRecovery (NFR-A3) ------------------------------------------

pub fn crash_recovery_restores_last_committed_state_test() {
  let assert Ok(#(s0, doc)) = st.create_blank(st.new(), 3, 3, 1000)
  let assert Ok(s1) = st.draw(s0, doc.id, edit([change(0, 0, 1)]), 2000)
  let assert Ok(s2) = st.draw(s1, doc.id, edit([change(1, 1, 2)]), 3000)

  let payload = persist.serialize(s2)
  let assert Ok(restored) = persist.deserialize(payload)
  let assert Ok(doc) = st.document(restored, doc.id)
  // The last committed gesture is present — nothing committed is lost.
  types.cell_at(doc.cells, types.CellPosition(0, 0)) |> should.equal(option.Some(1))
  types.cell_at(doc.cells, types.CellPosition(1, 1)) |> should.equal(option.Some(2))
  // Materialization still holds over the restored log.
  st.materialize(restored, doc) |> should.equal(doc.cells)
}

// -- guarantee UndoPersists (AC-F045-04, local half) ----------------------------

pub fn undo_persists_across_sessions_test() {
  let assert Ok(#(s0, doc)) = st.create_blank(st.new(), 3, 3, 1000)
  let assert Ok(s1) = st.draw(s0, doc.id, edit([change(0, 0, 1)]), 2000)
  let assert Ok(s2) = st.undo(s1, doc.id, 3000)

  let payload = persist.serialize(s2)
  let assert Ok(restored) = persist.deserialize(payload)
  let assert Ok(restored_doc) = st.document(restored, doc.id)
  // The undone state is what survives — the undone edit does not resurrect.
  types.cell_at(restored_doc.cells, types.CellPosition(0, 0))
  |> should.equal(option.None)
  let verbs = list.map(st.commands_of(restored, doc.id), fn(c) { c.verb })
  verbs |> should.equal([types.Draw, types.Undo])
  st.can_redo(restored, doc.id) |> should.be_true
}

// -- source retention through persistence (rule ImageImportedStub) --------------

pub fn source_retained_across_restarts_test() {
  let bytes = [7, 8, 9]
  let assert Ok(#(s0, doc)) = st.import_image_stub(st.new(), "photo.png", bytes, 1000)
  let assert Ok(restored) = persist.deserialize(persist.serialize(s0))
  let assert Ok(source) = st.source_of(restored, doc.id)
  source.content_hash |> should.equal(stub.content_hash(bytes))
}

// -- corrupt payload ------------------------------------------------------------

pub fn corrupt_payload_is_rejected_test() {
  persist.deserialize("this is not json")
  |> should.equal(Error(persist.Corrupt("store payload did not decode")))
}
