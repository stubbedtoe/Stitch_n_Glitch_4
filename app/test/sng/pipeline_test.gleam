//// Generated from specs/m2-chart-core.allium — slice m2-pipeline-undo:
//// F-045 pt 2 per-document pipeline-op stack harness: entities PipelineOpStack,
//// PipelineOp, PipelineOpLog, BakedImage; rules StubToneShiftCommitted /
//// StubToneShiftEdited / StubToneShiftRemoved / PipelineBaked /
//// PipelineOpUndone / PipelineOpRedone plus the unified-gesture family-1
//// dispatch (DocumentEditUndone / DocumentEditRedone); invariants
//// OpStackUniquePerDocument, OpStackBounded, OpLogTotallyOrdered,
//// SourceRetainedWhileOpsActive; contract DeterministicPipelineOp; the
//// op-stack provides guards of the EditorTools surface.
////
//// RED baseline: the M2 harness (src/sng/pipeline.gleam) does not exist yet —
//// the whole suite fails to compile on the unknown module. That is the
//// intended red state; see test/red-baseline-m2-pipeline-undo.txt.
////
//// Storage constraint (matters for the implement phase): M1's generated tests
//// pin the st.Store record shape (store_test constructs Store literally), so
//// the harness must ride inside Store.sources via reserved-id marker entries
//// — the same convention as sng/tools' toolstate marker — never by adding
//// fields to Store. Marker entries must be skipped by store.source_of.
////
//// SourceImage note: EditorToolState rides as a marker SourceImage with id
//// "toolstate" which store.source_of already skips, so "exists
//// SourceImage{document}" is false for blank documents. Every op rule's
//// "requires: exists m1/SourceImage" is therefore tested against documents
//// created by st.import_image_stub (a real retained source).
////
//// Binding decisions encoded here (PRD §7.7, AC-F045-01/02/03/05):
////   - undo of a pipeline op = op removal/re-edit over the retained source
////     bitmap; the working image is recomputed by materialize(source, ops)
////     — no inverse function exists or is needed;
////   - re-apply is deterministic: same parameters + seed + retained source
////     => byte-identical materialized result;
////   - bake/flatten requires explicit confirmation (confirmed: Bool); after
////     confirm the op stack collapses (all active ops removed, BakedImage
////     created) and undo-after-bake restores the pre-bake state from the
////     append-only op log;
////   - one committed slider/param gesture = exactly one op-log entry;
////   - the op stack is bounded by config.max_pipeline_ops;
////   - the unified undo/redo gesture dispatches on the newest history entry
////     (op log vs M1 command log, compared by committed_at): family 2 (ops)
////     or family 1 (document edits, delegated to M1's append-only log).
////     Tests always use strictly increasing timestamps so the dispatch is
////     deterministic.

import gleam/list
import gleam/option
import gleeunit/should
import sng/config
import sng/pipeline
import sng/store as st
import sng/types

fn pos(x: Int, y: Int) -> types.CellPosition {
  types.CellPosition(x, y)
}

fn change(x: Int, y: Int, after: Int) -> types.CellChange {
  types.CellChange(pos(x, y), option.None, option.Some(after))
}

/// Inclusive integer range [a, .., b]. Identical to the author's list.range.
fn range_inclusive(a: Int, b: Int) -> List(Int) {
  case a > b {
    True -> []
    False -> [a, ..range_inclusive(a + 1, b)]
  }
}

fn edit(changes: List(types.CellChange)) -> types.DocumentEdit {
  types.DocumentEdit(changes)
}

/// Blank 8x6 document with its op stack initialised (rule
/// DocumentViewInitialised, PipelineOpStack ensures clause) but no real
/// retained source.
fn blank(s: st.Store) -> #(st.Store, types.PatternDocument) {
  let assert Ok(#(s, doc)) = st.create_blank(s, 8, 6, 1000)
  let assert Ok(s) = pipeline.initialise_stack(s, doc.id, 1000)
  #(s, doc)
}

/// Document imported via M1's stub import — has a real retained SourceImage —
/// with its op stack initialised.
fn imported(s: st.Store) -> #(st.Store, types.PatternDocument) {
  let assert Ok(#(s, doc)) =
    st.import_image_stub(s, "photo.png", range_inclusive(1, 16), 1000)
  let assert Ok(s) = pipeline.initialise_stack(s, doc.id, 1000)
  #(s, doc)
}

fn stack(s: st.Store, doc_id: String) -> pipeline.PipelineOpStack {
  let assert Ok(stack) = pipeline.stack_of(s, doc_id)
  stack
}

fn newest_log(s: st.Store, doc_id: String) -> pipeline.PipelineOpLog {
  let assert Ok(entry) = list.last(stack(s, doc_id).logs)
  entry
}

fn newest_active_op(s: st.Store, doc_id: String) -> pipeline.PipelineOp {
  let assert Ok(op) = list.last(stack(s, doc_id).active_ops)
  op
}

// -- enum-comparable: OpVerb --------------------------------------------------

pub fn op_verb_comparable_test() {
  pipeline.AddOp |> should.equal(pipeline.AddOp)
  pipeline.AddOp |> should.not_equal(pipeline.RemoveOp)
  pipeline.EditOp |> should.not_equal(pipeline.BakeOp)
}

// -- config defaults (spec config block: no magic numbers in tests) ------------

pub fn pipeline_config_defaults_test() {
  config.max_pipeline_ops |> should.equal(16)
  config.stub_tone_amount_bound |> should.equal(100)
}

// -- rule DocumentViewInitialised (PipelineOpStack ensures clause) --------------
// -- entity-fields / relationships / projection: PipelineOpStack ---------------

pub fn document_view_initialised_op_stack_test() {
  let assert Ok(#(s, doc)) = st.create_blank(st.new(), 8, 6, 1000)
  let assert Ok(s) = pipeline.initialise_stack(s, doc.id, 1000)
  let snap = stack(s, doc.id)
  snap.document_id |> should.equal(doc.id)
  snap.ops |> should.equal([])
  snap.logs |> should.equal([])
  snap.active_ops |> should.equal([])
}

// -- invariant OpStackUniquePerDocument -----------------------------------------

pub fn op_stack_unique_per_document_test() {
  // Re-initialising must not create a second stack or reset the existing one.
  let #(s, doc) = imported(st.new())
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 10, 1, 2000)
  let assert Ok(s) = pipeline.initialise_stack(s, doc.id, 3000)
  let snap = stack(s, doc.id)
  snap.ops |> list.length |> should.equal(1)
  snap.logs |> list.length |> should.equal(1)
}

// -- rule StubToneShiftCommitted -------------------------------------------------
// -- entity-fields: PipelineOp; rule-entity-creation: op + log entry ------------

pub fn stub_tone_shift_committed_test() {
  let #(s, doc) = imported(st.new())
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 25, 42, 2000)

  let snap = stack(s, doc.id)
  snap.ops |> list.length |> should.equal(1)
  let assert Ok(op) = list.first(snap.ops)
  op.kind |> should.equal(pipeline.StubToneShift)
  op.amount |> should.equal(25)
  op.seed |> should.equal(42)
  op.position |> should.equal(1)
  op.removed |> should.equal(False)
  op.committed_at |> should.equal(2000)
  // projection active_ops: ops where removed = false
  snap.active_ops |> should.equal(snap.ops)

  // op-log entry mirrors M1's DocumentCommand shape: a pure append.
  snap.logs |> list.length |> should.equal(1)
  let assert Ok(entry) = list.first(snap.logs)
  entry.sequence |> should.equal(1)
  entry.verb |> should.equal(pipeline.LogAdd)
  entry.origin |> should.equal(pipeline.Direct)
  entry.op_id |> should.equal(op.id)
  entry.prior_amount |> should.equal(option.None)
  entry.baked_hash |> should.equal(option.None)
  entry.collapsed_op_ids |> should.equal([])
  entry.undone_verb |> should.equal(option.Some(pipeline.AddOp))
  entry.committed_at |> should.equal(2000)

  // rule ensures: document.last_edited = now
  let assert Ok(now_doc) = st.document(s, doc.id)
  now_doc.last_edited |> should.equal(2000)
}

pub fn stub_tone_shift_committed_requires_source_test() {
  // requires: exists m1/SourceImage{document}. A blank document has no real
  // retained source (the toolstate marker is skipped by store.source_of).
  let #(s, doc) = blank(st.new())
  pipeline.apply_stub_tone_shift(s, doc.id, 10, 1, 2000)
  |> should.equal(Error(pipeline.SourceNotRetained))
  // Rejected rules append nothing.
  stack(s, doc.id).logs |> should.equal([])
  stack(s, doc.id).ops |> should.equal([])
}

pub fn stub_tone_shift_committed_amount_bounds_test() {
  let #(s, doc) = imported(st.new())
  // requires: -config.stub_tone_amount_bound <= amount <= bound
  pipeline.apply_stub_tone_shift(
    s,
    doc.id,
    config.stub_tone_amount_bound + 1,
    1,
    2000,
  )
  |> should.equal(Error(pipeline.AmountOutOfBounds))
  pipeline.apply_stub_tone_shift(
    s,
    doc.id,
    -config.stub_tone_amount_bound - 1,
    1,
    2000,
  )
  |> should.equal(Error(pipeline.AmountOutOfBounds))
  // The bound itself is inclusive.
  let assert Ok(s) =
    pipeline.apply_stub_tone_shift(
      s,
      doc.id,
      config.stub_tone_amount_bound,
      1,
      2000,
    )
  let assert Ok(s) =
    pipeline.apply_stub_tone_shift(
      s,
      doc.id,
      -config.stub_tone_amount_bound,
      1,
      3000,
    )
  stack(s, doc.id).active_ops |> list.length |> should.equal(2)
}

// -- invariant OpStackBounded ----------------------------------------------------

pub fn stub_tone_shift_committed_stack_bounded_test() {
  let #(s, doc) = imported(st.new())
  let s =
    list.fold(range_inclusive(1, config.max_pipeline_ops), s, fn(acc, i) {
      let assert Ok(acc) =
        pipeline.apply_stub_tone_shift(acc, doc.id, i, 7, 2000 + i)
      acc
    })
  // invariant OpStackBounded: active_ops.count <= config.max_pipeline_ops
  stack(s, doc.id).active_ops
  |> list.length
  |> should.equal(config.max_pipeline_ops)
  // requires: stack.active_ops.count < config.max_pipeline_ops — the next op
  // is rejected, not silently dropped.
  pipeline.apply_stub_tone_shift(s, doc.id, 5, 7, 3000)
  |> should.equal(Error(pipeline.OpStackFull))
  // Undoing one op re-opens a slot (recompute cost stays bounded).
  let assert Ok(s) = pipeline.undo(s, doc.id, 4000)
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 5, 7, 5000)
  stack(s, doc.id).active_ops
  |> list.length
  |> should.equal(config.max_pipeline_ops)
}

// -- rule StubToneShiftEdited -----------------------------------------------------

pub fn stub_tone_shift_edited_test() {
  let #(s, doc) = imported(st.new())
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 10, 7, 2000)
  let assert Ok(s) = pipeline.edit_stub_tone_shift(s, doc.id, 30, 3000)

  let op = newest_active_op(s, doc.id)
  op.amount |> should.equal(30)

  // One committed gesture = one log entry (AC-F045-05): a slider drag
  // through intermediate values commits once on release — the log holds the
  // apply entry plus exactly one edit entry.
  let snap = stack(s, doc.id)
  snap.logs |> list.length |> should.equal(2)
  let assert Ok(entry) = list.last(snap.logs)
  entry.sequence |> should.equal(2)
  entry.verb |> should.equal(pipeline.LogEdit)
  entry.origin |> should.equal(pipeline.Direct)
  entry.op_id |> should.equal(op.id)
  entry.prior_amount |> should.equal(option.Some(10))
  entry.baked_hash |> should.equal(option.None)
  entry.collapsed_op_ids |> should.equal([])
  entry.undone_verb |> should.equal(option.Some(pipeline.EditOp))
  entry.committed_at |> should.equal(3000)

  let assert Ok(now_doc) = st.document(s, doc.id)
  now_doc.last_edited |> should.equal(3000)
}

pub fn stub_tone_shift_edited_requires_test() {
  // requires: exists m1/SourceImage{document}
  let #(s, doc) = blank(st.new())
  pipeline.edit_stub_tone_shift(s, doc.id, 5, 2000)
  |> should.equal(Error(pipeline.SourceNotRetained))
  // requires: stack.active_ops.count > 0
  let #(s, doc) = imported(st.new())
  pipeline.edit_stub_tone_shift(s, doc.id, 5, 2000)
  |> should.equal(Error(pipeline.OpStackEmpty))
}

pub fn stub_tone_shift_edited_amount_bounds_test() {
  let #(s, doc) = imported(st.new())
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 10, 7, 2000)
  pipeline.edit_stub_tone_shift(
    s,
    doc.id,
    config.stub_tone_amount_bound + 1,
    3000,
  )
  |> should.equal(Error(pipeline.AmountOutOfBounds))
  pipeline.edit_stub_tone_shift(
    s,
    doc.id,
    -config.stub_tone_amount_bound - 1,
    3000,
  )
  |> should.equal(Error(pipeline.AmountOutOfBounds))
  // Rejected edit leaves the op and the log untouched.
  let op = newest_active_op(s, doc.id)
  op.amount |> should.equal(10)
  stack(s, doc.id).logs |> list.length |> should.equal(1)
  // The bound itself is inclusive.
  let assert Ok(s) =
    pipeline.edit_stub_tone_shift(
      s,
      doc.id,
      config.stub_tone_amount_bound,
      3000,
    )
  newest_active_op(s, doc.id).amount
  |> should.equal(config.stub_tone_amount_bound)
}

pub fn stub_tone_shift_edits_newest_active_op_test() {
  let #(s, doc) = imported(st.new())
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 10, 1, 2000)
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 20, 2, 3000)
  let assert Ok(s) = pipeline.edit_stub_tone_shift(s, doc.id, 30, 4000)

  let snap = stack(s, doc.id)
  // The newest active op is re-edited over the retained source...
  let assert Ok(edited) = list.last(snap.active_ops)
  edited.amount |> should.equal(30)
  // ...earlier ops are untouched.
  let assert Ok(first) = list.first(snap.active_ops)
  first.amount |> should.equal(10)
  snap.logs |> list.length |> should.equal(3)
}

// -- rule StubToneShiftRemoved ------------------------------------------------------

pub fn stub_tone_shift_removed_test() {
  let #(s, doc) = imported(st.new())
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 10, 7, 2000)
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 20, 8, 3000)
  let victim = newest_active_op(s, doc.id)
  let assert Ok(s) = pipeline.remove_op(s, doc.id, victim.id, 4000)

  let snap = stack(s, doc.id)
  // The op is removed from the active stack but stays in the log's ops.
  snap.active_ops |> list.length |> should.equal(1)
  snap.ops |> list.length |> should.equal(2)
  let removed = list.filter(snap.ops, fn(op) { op.id == victim.id })
  removed |> list.length |> should.equal(1)
  let assert Ok(removed_op) = list.first(removed)
  removed_op.removed |> should.equal(True)

  snap.logs |> list.length |> should.equal(3)
  let entry = newest_log(s, doc.id)
  entry.verb |> should.equal(pipeline.LogRemove)
  entry.origin |> should.equal(pipeline.Direct)
  entry.op_id |> should.equal(victim.id)
  entry.prior_amount |> should.equal(option.None)
  entry.baked_hash |> should.equal(option.None)
  entry.collapsed_op_ids |> should.equal([])
  entry.undone_verb |> should.equal(option.Some(pipeline.RemoveOp))
  entry.committed_at |> should.equal(4000)

  let assert Ok(now_doc) = st.document(s, doc.id)
  now_doc.last_edited |> should.equal(4000)
}

pub fn stub_tone_shift_removed_requires_test() {
  // requires: exists m1/SourceImage{document}
  let #(s, doc) = blank(st.new())
  pipeline.remove_op(s, doc.id, "op-1", 2000)
  |> should.equal(Error(pipeline.SourceNotRetained))
  // requires: op in stack.active_ops — a removed op is not active.
  let #(s, doc) = imported(st.new())
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 10, 7, 2000)
  let op = newest_active_op(s, doc.id)
  let assert Ok(s) = pipeline.remove_op(s, doc.id, op.id, 3000)
  pipeline.remove_op(s, doc.id, op.id, 4000)
  |> should.equal(Error(pipeline.OpNotActive))
}

pub fn op_position_counts_all_ops_test() {
  // position = stack.ops.count + 1 over ALL ops ever, including removed ones.
  let #(s, doc) = imported(st.new())
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 10, 1, 2000)
  let first = newest_active_op(s, doc.id)
  first.position |> should.equal(1)
  let assert Ok(s) = pipeline.remove_op(s, doc.id, first.id, 3000)
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 20, 2, 4000)
  newest_active_op(s, doc.id).position |> should.equal(2)
}

// -- rule PipelineBaked (AC-F045-03) -------------------------------------------------

pub fn pipeline_bake_requires_confirmation_test() {
  // Bake/flatten is the single explicitly destructive step (PRD §7.7): the
  // confirmation gate precedes the trigger. Without confirmation nothing
  // happens — no log entry, no BakedImage, ops stay active.
  let #(s, doc) = imported(st.new())
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 10, 7, 2000)
  pipeline.bake_pipeline(s, doc.id, False, 3000)
  |> should.equal(Error(pipeline.BakeNotConfirmed))
  let snap = stack(s, doc.id)
  snap.logs |> list.length |> should.equal(1)
  snap.active_ops |> list.length |> should.equal(1)
  pipeline.baked_image_of(s, doc.id)
  |> should.equal(Error(pipeline.NotBaked))
}

pub fn pipeline_baked_test() {
  let #(s, doc) = imported(st.new())
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 10, 1, 2000)
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 20, 2, 3000)
  let assert Ok(source) = st.source_of(s, doc.id)
  let pre_bake_ops = stack(s, doc.id).active_ops
  let pre_bake_hash = pipeline.materialize(source, pre_bake_ops)

  let assert Ok(s) = pipeline.bake_pipeline(s, doc.id, True, 4000)

  // Bake log entry: references the newest active op, carries the collapsed
  // stack and the materialized hash. The op it references is NOT affected.
  let assert Ok(last_pre_bake_op) = list.last(pre_bake_ops)
  let entry = newest_log(s, doc.id)
  entry.sequence |> should.equal(3)
  entry.verb |> should.equal(pipeline.LogBake)
  entry.origin |> should.equal(pipeline.Direct)
  entry.op_id |> should.equal(last_pre_bake_op.id)
  entry.prior_amount |> should.equal(option.None)
  entry.baked_hash |> should.equal(option.Some(pre_bake_hash))
  entry.collapsed_op_ids
  |> should.equal(list.map(pre_bake_ops, fn(op) { op.id }))
  entry.undone_verb |> should.equal(option.Some(pipeline.BakeOp))
  entry.committed_at |> should.equal(4000)

  // BakedImage becomes the working base; the stack collapses.
  let assert Ok(baked) = pipeline.baked_image_of(s, doc.id)
  baked.document_id |> should.equal(doc.id)
  baked.content_hash |> should.equal(pre_bake_hash)
  baked.collapsed_ops |> should.equal(2)
  baked.baked_at |> should.equal(4000)

  let snap = stack(s, doc.id)
  snap.active_ops |> should.equal([])
  list.all(snap.ops, fn(op) { op.removed }) |> should.be_true

  // The retained source survives the bake (post-bake undo input).
  st.source_of(s, doc.id) |> should.equal(Ok(source))
  let assert Ok(now_doc) = st.document(s, doc.id)
  now_doc.last_edited |> should.equal(4000)
}

pub fn pipeline_bake_requires_test() {
  // requires: stack.active_ops.count > 0
  let #(s, doc) = imported(st.new())
  pipeline.bake_pipeline(s, doc.id, True, 2000)
  |> should.equal(Error(pipeline.OpStackEmpty))
  // requires: exists m1/SourceImage{document}
  let #(s, doc) = blank(st.new())
  pipeline.bake_pipeline(s, doc.id, True, 2000)
  |> should.equal(Error(pipeline.SourceNotRetained))
}

// -- rule PipelineOpUndone (AC-F045-01 shape, proven against the stub) ---------------

pub fn undo_add_restores_source_framing_test() {
  let #(s, doc) = imported(st.new())
  let assert Ok(source) = st.source_of(s, doc.id)
  let base = pipeline.materialize(source, [])

  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 10, 7, 2000)
  let with_op = pipeline.materialize(source, stack(s, doc.id).active_ops)
  // The stub op has a materializable effect over the retained source.
  with_op |> should.not_equal(base)

  // Undo of an op = removal/re-edit over the retained source: the undo entry
  // is a pure append and the op leaves the active stack.
  let assert Ok(s) = pipeline.undo(s, doc.id, 3000)
  let entry = newest_log(s, doc.id)
  entry.verb |> should.equal(pipeline.LogUndo)
  entry.origin |> should.equal(pipeline.ByUndo)
  entry.op_id |> should.equal(newest_op_id(s, doc.id))
  entry.prior_amount |> should.equal(option.Some(10))
  entry.baked_hash |> should.equal(option.None)
  entry.collapsed_op_ids |> should.equal([])
  entry.undone_verb |> should.equal(option.Some(pipeline.AddOp))
  entry.committed_at |> should.equal(3000)

  let snap = stack(s, doc.id)
  snap.active_ops |> should.equal([])
  list.all(snap.ops, fn(op) { op.removed }) |> should.be_true
  // The working image recomputes from the retained source — no inverse
  // function exists or is needed; the restored framing is byte-identical to
  // the pre-op materialization.
  pipeline.materialize(source, snap.active_ops) |> should.equal(base)
}

fn newest_op_id(s: st.Store, doc_id: String) -> String {
  let assert Ok(op) = list.last(stack(s, doc_id).ops)
  op.id
}

pub fn undo_op_requires_op_history_test() {
  // requires: stack.logs.count > 0 — nothing to undo on a fresh document.
  let #(s, doc) = imported(st.new())
  pipeline.undo(s, doc.id, 2000) |> should.equal(Error(pipeline.NothingToUndo))
}

pub fn undo_after_undo_fails_test() {
  // requires: entry.verb != undo — undoing twice in a row is rejected.
  let #(s, doc) = imported(st.new())
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 10, 7, 2000)
  let assert Ok(s) = pipeline.undo(s, doc.id, 3000)
  pipeline.undo(s, doc.id, 4000) |> should.equal(Error(pipeline.NothingToUndo))
}

pub fn undo_dispatches_on_newest_history_entry_test() {
  // The unified gesture (PRD §7.7) covers both families: the newest history
  // entry decides. A document edit committed after the op undoes first.
  let #(s, doc) = imported(st.new())
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 10, 7, 2000)
  let original_cell = types.cell_at(doc.cells, pos(0, 0))
  let assert Ok(s) = st.draw(s, doc.id, edit([change(0, 0, 2)]), 3000)

  // Newest entry is the draw (family 1): the grid edit is undone via M1's
  // append-only command log; the op stays active.
  let assert Ok(s) = pipeline.undo(s, doc.id, 4000)
  let assert Ok(after_doc) = st.document(s, doc.id)
  types.cell_at(after_doc.cells, pos(0, 0)) |> should.equal(original_cell)
  stack(s, doc.id).active_ops |> list.length |> should.equal(1)
  stack(s, doc.id).logs |> list.length |> should.equal(1)
  let commands = st.commands_of(s, doc.id)
  let assert Ok(last_command) = list.last(commands)
  last_command.verb |> should.equal(types.Undo)

  // Now the newest entry is the op (family 2): the op is undone.
  let assert Ok(s) = pipeline.undo(s, doc.id, 5000)
  stack(s, doc.id).active_ops |> should.equal([])
}

pub fn undo_redo_edit_entry_test() {
  let #(s, doc) = imported(st.new())
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 10, 7, 2000)
  let assert Ok(s) = pipeline.edit_stub_tone_shift(s, doc.id, 30, 3000)

  // Undo of an edit entry restores the prior amount (re-edit over the
  // retained source, not an inverse).
  let assert Ok(s) = pipeline.undo(s, doc.id, 4000)
  newest_active_op(s, doc.id).amount |> should.equal(10)
  let entry = newest_log(s, doc.id)
  entry.verb |> should.equal(pipeline.LogUndo)
  entry.origin |> should.equal(pipeline.ByUndo)
  entry.undone_verb |> should.equal(option.Some(pipeline.EditOp))

  // Redo of the edit entry re-applies the edited amount.
  let assert Ok(s) = pipeline.redo(s, doc.id, 5000)
  newest_active_op(s, doc.id).amount |> should.equal(30)
  let entry = newest_log(s, doc.id)
  entry.verb |> should.equal(pipeline.LogRedo)
  entry.origin |> should.equal(pipeline.ByRedo)
  entry.undone_verb |> should.equal(option.Some(pipeline.EditOp))
}

pub fn undo_redo_remove_entry_test() {
  let #(s, doc) = imported(st.new())
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 10, 7, 2000)
  let op = newest_active_op(s, doc.id)
  let assert Ok(s) = pipeline.remove_op(s, doc.id, op.id, 3000)

  // Undo of a remove entry restores the op to the active stack.
  let assert Ok(s) = pipeline.undo(s, doc.id, 4000)
  stack(s, doc.id).active_ops |> list.length |> should.equal(1)
  newest_log(s, doc.id).undone_verb
  |> should.equal(option.Some(pipeline.RemoveOp))

  // Redo of the remove entry removes it again.
  let assert Ok(s) = pipeline.redo(s, doc.id, 5000)
  stack(s, doc.id).active_ops |> should.equal([])
  newest_log(s, doc.id).undone_verb
  |> should.equal(option.Some(pipeline.RemoveOp))
}

// -- rule PipelineOpRedone (AC-F045-02 shape) ------------------------------------------

pub fn redo_add_reapply_is_deterministic_test() {
  let #(s, doc) = imported(st.new())
  let assert Ok(source) = st.source_of(s, doc.id)
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 10, 7, 2000)
  let before = pipeline.materialize(source, stack(s, doc.id).active_ops)

  let assert Ok(s) = pipeline.undo(s, doc.id, 3000)
  let assert Ok(s) = pipeline.redo(s, doc.id, 4000)

  // Deterministic re-apply: same parameters + seed + retained source =>
  // byte-identical working image.
  let after = pipeline.materialize(source, stack(s, doc.id).active_ops)
  after |> should.equal(before)
  stack(s, doc.id).active_ops |> list.length |> should.equal(1)
  let op = newest_active_op(s, doc.id)
  op.removed |> should.equal(False)
  op.amount |> should.equal(10)
  op.seed |> should.equal(7)

  let entry = newest_log(s, doc.id)
  entry.verb |> should.equal(pipeline.LogRedo)
  entry.origin |> should.equal(pipeline.ByRedo)
  entry.prior_amount |> should.equal(option.Some(10))
  entry.undone_verb |> should.equal(option.Some(pipeline.AddOp))
}

pub fn redo_requires_undo_entry_test() {
  // requires: entry.verb = undo
  let #(s, doc) = imported(st.new())
  // (a) no history at all
  pipeline.redo(s, doc.id, 2000) |> should.equal(Error(pipeline.NothingToRedo))
  // (b) newest history entry is an op but its newest entry is not an undo
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 10, 7, 2000)
  pipeline.redo(s, doc.id, 3000) |> should.equal(Error(pipeline.NothingToRedo))
  // (c) newest history entry is a document command not preceded by an undo
  let assert Ok(s) = st.draw(s, doc.id, edit([change(0, 0, 2)]), 4000)
  pipeline.redo(s, doc.id, 5000) |> should.equal(Error(pipeline.NothingToRedo))
}

// -- rule PipelineOpUndone on bake entries (AC-F045-03) ---------------------------------

pub fn undo_bake_restores_pre_bake_state_test() {
  let #(s, doc) = imported(st.new())
  let assert Ok(source) = st.source_of(s, doc.id)
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 10, 1, 2000)
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 20, 2, 3000)
  let pre_bake_ops = stack(s, doc.id).active_ops
  let pre_bake_hash = pipeline.materialize(source, pre_bake_ops)
  let assert Ok(s) = pipeline.bake_pipeline(s, doc.id, True, 4000)
  pipeline.baked_image_of(s, doc.id) |> should.be_ok

  // Undo-after-bake restores the pre-bake state from history (the bake is a
  // log append, not a destruction of history).
  let assert Ok(s) = pipeline.undo(s, doc.id, 5000)
  pipeline.baked_image_of(s, doc.id) |> should.equal(Error(pipeline.NotBaked))
  let snap = stack(s, doc.id)
  // The collapsed ops are restored to the active snap.
  snap.active_ops |> list.length |> should.equal(2)
  snap.active_ops |> should.equal(pre_bake_ops)
  let entry = newest_log(s, doc.id)
  entry.verb |> should.equal(pipeline.LogUndo)
  entry.origin |> should.equal(pipeline.ByUndo)
  entry.baked_hash |> should.equal(option.Some(pre_bake_hash))
  entry.collapsed_op_ids
  |> should.equal(list.map(pre_bake_ops, fn(op) { op.id }))
  entry.undone_verb |> should.equal(option.Some(pipeline.BakeOp))
  // The restored working image is byte-identical to the pre-bake image.
  pipeline.materialize(source, snap.active_ops) |> should.equal(pre_bake_hash)
}

pub fn redo_bake_recreates_baked_image_test() {
  let #(s, doc) = imported(st.new())
  let assert Ok(source) = st.source_of(s, doc.id)
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 10, 1, 2000)
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 20, 2, 3000)
  let pre_bake_hash = pipeline.materialize(source, stack(s, doc.id).active_ops)
  let assert Ok(s) = pipeline.bake_pipeline(s, doc.id, True, 4000)
  let assert Ok(s) = pipeline.undo(s, doc.id, 5000)

  // Redo of the bake re-creates the BakedImage with the same content hash
  // and collapses the stack again.
  let assert Ok(s) = pipeline.redo(s, doc.id, 6000)
  let assert Ok(baked) = pipeline.baked_image_of(s, doc.id)
  baked.content_hash |> should.equal(pre_bake_hash)
  baked.collapsed_ops |> should.equal(2)
  let snap = stack(s, doc.id)
  snap.active_ops |> should.equal([])
  let entry = newest_log(s, doc.id)
  entry.verb |> should.equal(pipeline.LogRedo)
  entry.origin |> should.equal(pipeline.ByRedo)
  entry.baked_hash |> should.equal(option.Some(pre_bake_hash))
  entry.undone_verb |> should.equal(option.Some(pipeline.BakeOp))
}

// -- unified gesture family 1: DocumentEditUndone / DocumentEditRedone ---------------------

pub fn undo_document_edit_family_one_test() {
  let #(s, doc) = imported(st.new())
  let original_cell = types.cell_at(doc.cells, pos(0, 0))
  let assert Ok(s) = st.draw(s, doc.id, edit([change(0, 0, 2)]), 2000)

  // Newest entry is a document command: the unified gesture undoes it by
  // appending the precomputed inverse to M1's command log — M1's exact
  // EditUndone semantics.
  let assert Ok(s) = pipeline.undo(s, doc.id, 3000)
  let commands = st.commands_of(s, doc.id)
  commands |> list.length |> should.equal(2)
  let assert Ok(last_command) = list.last(commands)
  last_command.verb |> should.equal(types.Undo)
  last_command.sequence |> should.equal(2)
  let assert Ok(after_doc) = st.document(s, doc.id)
  types.cell_at(after_doc.cells, pos(0, 0)) |> should.equal(original_cell)
  after_doc.last_edited |> should.equal(3000)
}

pub fn undo_document_edit_requires_history_test() {
  // requires: document.commands.count > 0 and newest entry not an undo
  let #(s, doc) = imported(st.new())
  pipeline.undo(s, doc.id, 2000) |> should.equal(Error(pipeline.NothingToUndo))
  let assert Ok(s) = st.draw(s, doc.id, edit([change(0, 0, 2)]), 2000)
  let assert Ok(s) = pipeline.undo(s, doc.id, 3000)
  pipeline.undo(s, doc.id, 4000) |> should.equal(Error(pipeline.NothingToUndo))
}

pub fn redo_document_edit_family_one_test() {
  let #(s, doc) = imported(st.new())
  let assert Ok(s) = st.draw(s, doc.id, edit([change(0, 0, 2)]), 2000)
  let assert Ok(s) = pipeline.undo(s, doc.id, 3000)
  let assert Ok(s) = pipeline.redo(s, doc.id, 4000)

  let commands = st.commands_of(s, doc.id)
  let assert Ok(last_command) = list.last(commands)
  last_command.verb |> should.equal(types.Redo)
  let assert Ok(after_doc) = st.document(s, doc.id)
  types.cell_at(after_doc.cells, pos(0, 0)) |> should.equal(option.Some(2))
}

// -- invariant OpLogTotallyOrdered ----------------------------------------------------------

pub fn op_log_totally_ordered_test() {
  let #(s, doc) = imported(st.new())
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 10, 1, 2000)
  let assert Ok(s) = pipeline.edit_stub_tone_shift(s, doc.id, 20, 3000)
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 30, 2, 4000)
  let op = newest_active_op(s, doc.id)
  let assert Ok(s) = pipeline.remove_op(s, doc.id, op.id, 5000)
  let assert Ok(s) = pipeline.undo(s, doc.id, 6000)
  let assert Ok(s) = pipeline.redo(s, doc.id, 7000)

  let sequences =
    stack(s, doc.id).logs |> list.map(fn(entry) { entry.sequence })
  // Every sequence is unique and dense: 1..n in commit order.
  sequences |> should.equal(range_inclusive(1, 6))
  list.unique(sequences) |> list.length |> should.equal(6)
}

// -- entity-optional: PipelineOpLog prior_amount / baked_hash / undone_verb ------------------

pub fn op_log_optional_fields_test() {
  let #(s, doc) = imported(st.new())
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 10, 1, 2000)
  let assert Ok(add_entry) = list.first(stack(s, doc.id).logs)
  add_entry.prior_amount |> should.equal(option.None)
  add_entry.baked_hash |> should.equal(option.None)
  // undone_verb is populated on direct entries too: the verb the entry
  // reverses when undone.
  add_entry.undone_verb |> should.equal(option.Some(pipeline.AddOp))

  let assert Ok(s) = pipeline.edit_stub_tone_shift(s, doc.id, 20, 3000)
  let edit_entry = newest_log(s, doc.id)
  edit_entry.prior_amount |> should.equal(option.Some(10))
  edit_entry.baked_hash |> should.equal(option.None)
  edit_entry.undone_verb |> should.equal(option.Some(pipeline.EditOp))

  let assert Ok(s) = pipeline.bake_pipeline(s, doc.id, True, 4000)
  let bake_entry = newest_log(s, doc.id)
  let assert option.Some(hash) = bake_entry.baked_hash
  hash |> should.not_equal("")
  bake_entry.undone_verb |> should.equal(option.Some(pipeline.BakeOp))
}

// -- contract DeterministicPipelineOp ---------------------------------------------------------

pub fn materialize_is_deterministic_test() {
  let #(s, doc) = imported(st.new())
  let assert Ok(source) = st.source_of(s, doc.id)
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 10, 7, 2000)
  let ops = stack(s, doc.id).active_ops

  // SameParamsSameResult (AC-F045-02 shape): same parameters + seed + source
  // => byte-identical result. materialize is a pure function of its inputs
  // (no store, no clock — PureAndLocal, NFR-PR1).
  pipeline.materialize(source, ops)
  |> should.equal(pipeline.materialize(source, ops))

  // A different seed is a different op => different materialization.
  let other_source = types.SourceImage(..source, content_hash: "other-source")
  pipeline.materialize(other_source, ops)
  |> should.not_equal(pipeline.materialize(source, ops))
}

// -- invariant SourceRetainedWhileOpsActive -----------------------------------------------------

pub fn source_retained_while_ops_active_test() {
  let #(s, doc) = imported(st.new())
  let assert Ok(source) = st.source_of(s, doc.id)
  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 10, 7, 2000)
  // An active op stack requires the retained source bitmap: the source is
  // still there, unchanged, while ops are active — through undo/redo too.
  st.source_of(s, doc.id) |> should.equal(Ok(source))
  stack(s, doc.id).active_ops |> list.length |> should.equal(1)
  let assert Ok(s) = pipeline.undo(s, doc.id, 3000)
  let assert Ok(s) = pipeline.redo(s, doc.id, 4000)
  st.source_of(s, doc.id) |> should.equal(Ok(source))
}

// -- EditorTools surface provides guards (op stack half) -----------------------------------------

pub fn surface_provides_guards_test() {
  let #(s, doc) = imported(st.new())
  // ApplyStubToneShift when active_ops < max; Edit/Remove/Bake when an op is
  // active; UndoGesture when either log is non-empty.
  pipeline.can_apply(s, doc.id) |> should.be_true
  pipeline.can_edit(s, doc.id) |> should.be_false
  pipeline.can_bake(s, doc.id) |> should.be_false
  pipeline.can_undo(s, doc.id) |> should.be_false
  pipeline.can_redo(s, doc.id) |> should.be_false

  let assert Ok(s) = pipeline.apply_stub_tone_shift(s, doc.id, 10, 7, 2000)
  pipeline.can_apply(s, doc.id) |> should.be_true
  pipeline.can_edit(s, doc.id) |> should.be_true
  pipeline.can_bake(s, doc.id) |> should.be_true
  pipeline.can_undo(s, doc.id) |> should.be_true
  pipeline.can_redo(s, doc.id) |> should.be_false

  // Undo gesture is also available for family 1 (document command log).
  let #(s2, doc2) = imported(st.new())
  let assert Ok(s2) = st.draw(s2, doc2.id, edit([change(0, 0, 2)]), 2000)
  pipeline.can_undo(s2, doc2.id) |> should.be_true

  let assert Ok(s) = pipeline.undo(s, doc.id, 3000)
  pipeline.can_redo(s, doc.id) |> should.be_true

  // At the bound, ApplyStubToneShift is hidden.
  let #(s3, doc3) = imported(st.new())
  let s3 =
    list.fold(range_inclusive(1, config.max_pipeline_ops), s3, fn(acc, i) {
      let assert Ok(acc) =
        pipeline.apply_stub_tone_shift(acc, doc3.id, i, 7, 2000 + i)
      acc
    })
  pipeline.can_apply(s3, doc3.id) |> should.be_false

  // After a bake the active stack is empty: Edit/Bake hidden, Undo still
  // offered (undo-after-bake restores from history).
  let assert Ok(s3) = pipeline.bake_pipeline(s3, doc3.id, True, 3000)
  pipeline.can_edit(s3, doc3.id) |> should.be_false
  pipeline.can_bake(s3, doc3.id) |> should.be_false
  pipeline.can_apply(s3, doc3.id) |> should.be_true
  pipeline.can_undo(s3, doc3.id) |> should.be_true
}
