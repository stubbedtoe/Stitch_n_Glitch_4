//// M2 F-045 pt 2 per-document pipeline-op stack harness (specs/
//// m2-chart-core.allium): entities PipelineOpStack / PipelineOp /
//// PipelineOpLog / BakedImage, rules StubToneShiftCommitted /
//// StubToneShiftEdited / StubToneShiftRemoved / PipelineBaked /
//// PipelineOpUndone / PipelineOpRedone, invariants OpStackUniquePerDocument,
//// OpStackBounded, OpLogTotallyOrdered, SourceRetainedWhileOpsActive, and
//// contract DeterministicPipelineOp (PRD §7.7 part 2).
////
//// Undo model (PRD §7.7): pipeline ops undo by removal/re-edit over the
//// RETAINED M1 SourceImage — no inverse function exists or is needed; the
//// working image is recomputed on demand by materialize(source, ops). Undo
//// and redo are pure appends to the op log, so history persists and
//// undo-after-bake restores the pre-bake state (AC-F045-03). Bake/flatten is
//// the single explicitly destructive step and demands explicit confirmation
//// (bake_pipeline confirmed: Bool). Re-apply is deterministic: same
//// parameters + seed + retained source => byte-identical result
//// (AC-F045-02 shape).
////
//// PipelineOpStack storage: the M1 Store record shape is pinned by M1's
//// generated tests, so the op stack rides inside Store.sources as a marker
//// SourceImage (id = types.pipeline_state_source_id) whose content_hash
//// carries the JSON-encoded state — the same convention as sng/tools'
//// toolstate marker. store.source_of skips the marker, and store.delete
//// drops it with the document.
////
//// M2 ships only the stub op (StubToneShift), mirroring M1's stub pattern:
//// a minimal deterministic transform with parameters. Real ops (F-041 crop,
//// F-042 tonal, F-030 databend) plug into this harness in M3/M4.

import gleam/dynamic/decode.{type Decoder}
import gleam/int
import gleam/json
import gleam/list
import gleam/option.{type Option, None, Some}
import sng/config
import sng/store as st
import sng/types.{
  type Id, type SourceImage, type Timestamp, SourceImage,
  pipeline_state_source_id,
}

// ---------------------------------------------------------------------------
// Value types, enumerations, entities (spec: m2-chart-core.allium)
// ---------------------------------------------------------------------------

/// -- enum OpVerb: verbs that carry materializable pipeline effects.
/// Undo/redo log entries name the verb they reverse via `undone_verb`.
pub type OpVerb {
  AddOp
  RemoveOp
  EditOp
  BakeOp
}

/// -- enum LogVerb: the op-log entry verb (undo/redo are entries too).
pub type LogVerb {
  LogAdd
  LogRemove
  LogEdit
  LogBake
  LogUndo
  LogRedo
}

/// -- enum LogOrigin: who committed the entry.
pub type LogOrigin {
  Direct
  ByUndo
  ByRedo
}

/// -- entity PipelineOp (M2 ships only the stub variant).
pub type PipelineOp {
  PipelineOp(
    id: Id,
    kind: OpKind,
    amount: Int,
    seed: Int,
    position: Int,
    removed: Bool,
    committed_at: Timestamp,
  )
}

pub type OpKind {
  StubToneShift
}

/// -- entity PipelineOpLog: append-only op history mirroring M1's
/// DocumentCommand shape — undo/redo are themselves entries, so op history
/// persists across sessions and undo-after-bake restores from history.
pub type PipelineOpLog {
  PipelineOpLog(
    sequence: Int,
    verb: LogVerb,
    origin: LogOrigin,
    op_id: Id,
    prior_amount: Option(Int),
    baked_hash: Option(String),
    collapsed_op_ids: List(Id),
    undone_verb: Option(OpVerb),
    committed_at: Timestamp,
  )
}

/// -- entity BakedImage: working base produced by a confirmed bake. The
/// retained original source and the op log both survive the bake — that is
/// what keeps post-bake undo possible.
pub type BakedImage {
  BakedImage(
    document_id: Id,
    content_hash: String,
    collapsed_ops: Int,
    baked_at: Timestamp,
  )
}

/// -- entity PipelineOpStack (snapshot). `active_ops` is the spec projection
/// ops where removed = false.
pub type PipelineOpStack {
  PipelineOpStack(
    document_id: Id,
    ops: List(PipelineOp),
    logs: List(PipelineOpLog),
    active_ops: List(PipelineOp),
  )
}

pub type PipelineError {
  DocumentNotFound
  StackNotInitialised
  CorruptState
  SourceNotRetained
  AmountOutOfBounds
  OpStackFull
  OpStackEmpty
  OpNotActive
  BakeNotConfirmed
  NotBaked
  NothingToUndo
  NothingToRedo
}

// ---------------------------------------------------------------------------
// rule DocumentViewInitialised (PipelineOpStack ensures clause) + invariant
// OpStackUniquePerDocument
// ---------------------------------------------------------------------------

/// Idempotent initialisation: exactly one op stack per document, created
/// empty; re-initialising never creates a second stack or resets the
/// existing one (invariant OpStackUniquePerDocument).
pub fn initialise_stack(
  store: st.Store,
  document_id: Id,
  now: Timestamp,
) -> Result(st.Store, PipelineError) {
  case st.document(store, document_id) {
    Error(_) -> Error(DocumentNotFound)
    Ok(_) ->
      case find_marker(store, document_id) {
        Ok(_) -> Ok(store)
        Error(_) ->
          Ok(
            st.Store(..store, sources: [
              marker_entry(document_id, empty_state(), now),
              ..store.sources
            ]),
          )
      }
  }
}

pub fn stack_of(
  store: st.Store,
  document_id: Id,
) -> Result(PipelineOpStack, PipelineError) {
  case st.document(store, document_id) {
    Error(_) -> Error(DocumentNotFound)
    Ok(_) ->
      case find_marker(store, document_id) {
        Error(_) -> Error(StackNotInitialised)
        Ok(entry) ->
          case decode_state(entry.content_hash) {
            Error(_) -> Error(CorruptState)
            Ok(state) ->
              Ok(PipelineOpStack(
                document_id: document_id,
                ops: state.ops,
                logs: state.logs,
                active_ops: list.filter(state.ops, fn(op) { !op.removed }),
              ))
          }
      }
  }
}

// ---------------------------------------------------------------------------
// rule StubToneShiftCommitted — one gesture = one op + one op-log entry
// (AC-F045-05). Requires the retained source (invariant
// SourceRetainedWhileOpsActive) and the amount bound; the stack is bounded
// (invariant OpStackBounded).
// ---------------------------------------------------------------------------

pub fn apply_stub_tone_shift(
  store: st.Store,
  document_id: Id,
  amount: Int,
  seed: Int,
  now: Timestamp,
) -> Result(st.Store, PipelineError) {
  use state <- require_state(store, document_id)
  use _ <- require_source(store, document_id)
  use <- require_amount_bound(amount)
  let active = list.filter(state.ops, fn(op) { !op.removed })
  use <- require_stack_room(active)
  let op =
    PipelineOp(
      id: op_id(document_id, list.length(state.ops) + 1),
      kind: StubToneShift,
      amount: amount,
      seed: seed,
      // position = stack.ops.count + 1 over ALL ops ever, removed included.
      position: list.length(state.ops) + 1,
      removed: False,
      committed_at: now,
    )
  let entry =
    PipelineOpLog(
      sequence: list.length(state.logs) + 1,
      verb: LogAdd,
      origin: Direct,
      op_id: op.id,
      prior_amount: None,
      baked_hash: None,
      collapsed_op_ids: [],
      undone_verb: Some(AddOp),
      committed_at: now,
    )
  store
  |> replace_state(document_id, PipelineState(
    ops: list.append(state.ops, [op]),
    logs: list.append(state.logs, [entry]),
    baked: state.baked,
  ))
  |> touch_document(document_id, now)
}

// ---------------------------------------------------------------------------
// rule StubToneShiftEdited — re-edit over the retained source; one committed
// slider/param gesture = exactly one op-log entry (AC-F045-05).
// ---------------------------------------------------------------------------

pub fn edit_stub_tone_shift(
  store: st.Store,
  document_id: Id,
  amount: Int,
  now: Timestamp,
) -> Result(st.Store, PipelineError) {
  use state <- require_state(store, document_id)
  use _ <- require_source(store, document_id)
  let active = list.filter(state.ops, fn(op) { !op.removed })
  use <- require_active_ops(active)
  use <- require_amount_bound(amount)
  let assert Ok(op) = list.last(active)
  let entry =
    PipelineOpLog(
      sequence: list.length(state.logs) + 1,
      verb: LogEdit,
      origin: Direct,
      op_id: op.id,
      prior_amount: Some(op.amount),
      baked_hash: None,
      collapsed_op_ids: [],
      undone_verb: Some(EditOp),
      committed_at: now,
    )
  store
  |> replace_state(document_id, PipelineState(
    ops: update_op(state.ops, op.id, fn(o) {
      PipelineOp(..o, amount: amount)
    }),
    logs: list.append(state.logs, [entry]),
    baked: state.baked,
  ))
  |> touch_document(document_id, now)
}

// ---------------------------------------------------------------------------
// rule StubToneShiftRemoved — direct op removal ("removes the crop op from
// the pipeline" half of AC-F045-01, exercised against the stub in M2).
// ---------------------------------------------------------------------------

pub fn remove_op(
  store: st.Store,
  document_id: Id,
  op_id: Id,
  now: Timestamp,
) -> Result(st.Store, PipelineError) {
  use state <- require_state(store, document_id)
  use _ <- require_source(store, document_id)
  let active = list.filter(state.ops, fn(op) { !op.removed })
  use victim <- require_active_op(active, op_id)
  let entry =
    PipelineOpLog(
      sequence: list.length(state.logs) + 1,
      verb: LogRemove,
      origin: Direct,
      op_id: victim.id,
      prior_amount: None,
      baked_hash: None,
      collapsed_op_ids: [],
      undone_verb: Some(RemoveOp),
      committed_at: now,
    )
  store
  |> replace_state(document_id, PipelineState(
    ops: update_op(state.ops, victim.id, fn(o) {
      PipelineOp(..o, removed: True)
    }),
    logs: list.append(state.logs, [entry]),
    baked: state.baked,
  ))
  |> touch_document(document_id, now)
}

// ---------------------------------------------------------------------------
// rule PipelineBaked (AC-F045-03) — the single explicitly destructive step
// (PRD §7.7). The confirmation gate precedes the trigger; the bake is an
// append to the log, so undo-after-bake restores the pre-bake state.
// ---------------------------------------------------------------------------

pub fn bake_pipeline(
  store: st.Store,
  document_id: Id,
  confirmed: Bool,
  now: Timestamp,
) -> Result(st.Store, PipelineError) {
  use state <- require_state(store, document_id)
  use source <- require_source(store, document_id)
  let active = list.filter(state.ops, fn(op) { !op.removed })
  use <- require_active_ops(active)
  use <- require_confirmed(confirmed)
  let assert Ok(last_op) = list.last(active)
  let hash = materialize(source, active)
  let entry =
    PipelineOpLog(
      sequence: list.length(state.logs) + 1,
      verb: LogBake,
      origin: Direct,
      op_id: last_op.id,
      prior_amount: None,
      baked_hash: Some(hash),
      collapsed_op_ids: list.map(active, fn(op) { op.id }),
      undone_verb: Some(BakeOp),
      committed_at: now,
    )
  let baked = BakedImage(
    document_id: document_id,
    content_hash: hash,
    collapsed_ops: list.length(active),
    baked_at: now,
  )
  let collapsed = fn(op: PipelineOp) { PipelineOp(..op, removed: True) }
  store
  |> replace_state(document_id, PipelineState(
    ops: list.map(state.ops, fn(op) {
      case list.contains(entry.collapsed_op_ids, op.id) {
        True -> collapsed(op)
        False -> op
      }
    }),
    logs: list.append(state.logs, [entry]),
    baked: Some(baked),
  ))
  |> touch_document(document_id, now)
}

// ---------------------------------------------------------------------------
// Unified undo/redo gesture (PRD §7.7) — one gesture covers both families:
// family 1 (document edits, M1's append-only command log) and family 2
// (pipeline ops, the op log). The dispatch picks the family whose newest
// entry is newest by committed_at among the entries that are undoable
// (redoable) right now; an entry that cannot fire (e.g. M1's newest entry
// is already an undo) is passed over.
// ---------------------------------------------------------------------------

pub fn undo(
  store: st.Store,
  document_id: Id,
  now: Timestamp,
) -> Result(st.Store, PipelineError) {
  use _ <- require_document(store, document_id)
  let commands = st.commands_of(store, document_id)
  let op_logs = op_logs_of(store, document_id)
  let cmd_entry = newest_undoable_command(commands)
  let op_entry = newest_undoable_op(op_logs)
  case cmd_entry, op_entry {
    Error(_), Error(_) -> Error(NothingToUndo)
    Ok(command), Error(_) -> undo_document_edit(store, document_id, command, now)
    Error(_), Ok(entry) -> undo_op_entry(store, document_id, op_logs, entry, now)
    Ok(command), Ok(entry) ->
      case entry.committed_at > command.committed_at {
        True -> undo_op_entry(store, document_id, op_logs, entry, now)
        False -> undo_document_edit(store, document_id, command, now)
      }
  }
}

pub fn redo(
  store: st.Store,
  document_id: Id,
  now: Timestamp,
) -> Result(st.Store, PipelineError) {
  use _ <- require_document(store, document_id)
  let commands = st.commands_of(store, document_id)
  let op_logs = op_logs_of(store, document_id)
  let cmd_entry = newest_redoable_command(commands)
  let op_entry = newest_redoable_op(op_logs)
  case cmd_entry, op_entry {
    Error(_), Error(_) -> Error(NothingToRedo)
    Ok(command), Error(_) -> redo_document_edit(store, document_id, command, now)
    Error(_), Ok(entry) -> redo_op_entry(store, document_id, op_logs, entry, now)
    Ok(command), Ok(entry) ->
      case entry.committed_at > command.committed_at {
        True -> redo_op_entry(store, document_id, op_logs, entry, now)
        False -> redo_document_edit(store, document_id, command, now)
      }
  }
}

// ---------------------------------------------------------------------------
// rule PipelineOpUndone — family 2 undo: removal/re-edit over the retained
// source, a pure append. Undo of add/edit/remove/bake per the spec's
// conditionals; undoing a bake drops the BakedImage and restores the
// collapsed ops (AC-F045-03).
// ---------------------------------------------------------------------------

fn undo_op_entry(
  store: st.Store,
  document_id: Id,
  logs: List(PipelineOpLog),
  entry: PipelineOpLog,
  now: Timestamp,
) -> Result(st.Store, PipelineError) {
  use state <- require_state(store, document_id)
  let undo_entry =
    PipelineOpLog(
      sequence: list.length(logs) + 1,
      verb: LogUndo,
      origin: ByUndo,
      op_id: entry.op_id,
      // The undo entry records the op's amount at undo time (what a redo
      // re-applies for edit entries).
      prior_amount: op_amount(state.ops, entry.op_id),
      baked_hash: entry.baked_hash,
      collapsed_op_ids: entry.collapsed_op_ids,
      undone_verb: entry.undone_verb,
      committed_at: now,
    )
  let ops = case entry.verb {
    LogAdd -> update_op(state.ops, entry.op_id, fn(op) {
      PipelineOp(..op, removed: True)
    })
    LogRemove -> update_op(state.ops, entry.op_id, fn(op) {
      PipelineOp(..op, removed: False)
    })
    LogEdit ->
      case entry.prior_amount {
        Some(prior) ->
          update_op(state.ops, entry.op_id, fn(op) {
            PipelineOp(..op, amount: prior)
          })
        None -> state.ops
      }
    LogBake ->
      list.map(state.ops, fn(op) {
        case list.contains(entry.collapsed_op_ids, op.id) {
          True -> PipelineOp(..op, removed: False)
          False -> op
        }
      })
    _ -> state.ops
  }
  let baked = case entry.verb {
    LogBake -> None
    _ -> state.baked
  }
  store
  |> replace_state(document_id, PipelineState(
    ops: ops,
    logs: list.append(logs, [undo_entry]),
    baked: baked,
  ))
  |> touch_document(document_id, now)
}

// ---------------------------------------------------------------------------
// rule PipelineOpRedone — family 2 redo: deterministic re-apply (same
// parameters + seed + retained source => identical result, AC-F045-02
// shape). Redo of a bake re-creates the BakedImage with the same content
// hash and collapses the stack again.
// ---------------------------------------------------------------------------

fn redo_op_entry(
  store: st.Store,
  document_id: Id,
  logs: List(PipelineOpLog),
  entry: PipelineOpLog,
  now: Timestamp,
) -> Result(st.Store, PipelineError) {
  use state <- require_state(store, document_id)
  let redo_entry =
    PipelineOpLog(
      sequence: list.length(logs) + 1,
      verb: LogRedo,
      origin: ByRedo,
      op_id: entry.op_id,
      prior_amount: entry.prior_amount,
      baked_hash: entry.baked_hash,
      collapsed_op_ids: entry.collapsed_op_ids,
      undone_verb: entry.undone_verb,
      committed_at: now,
    )
  let #(ops, baked) = case entry.undone_verb {
    Some(AddOp) -> #(
      update_op(state.ops, entry.op_id, fn(op) {
        PipelineOp(..op, removed: False)
      }),
      state.baked,
    )
    Some(RemoveOp) -> #(
      update_op(state.ops, entry.op_id, fn(op) {
        PipelineOp(..op, removed: True)
      }),
      state.baked,
    )
    Some(EditOp) -> {
      let ops = case entry.prior_amount {
        Some(amount) ->
          update_op(state.ops, entry.op_id, fn(op) {
            PipelineOp(..op, amount: amount)
          })
        None -> state.ops
      }
      #(ops, state.baked)
    }
    Some(BakeOp) -> {
      let ops =
        list.map(state.ops, fn(op) {
          case list.contains(entry.collapsed_op_ids, op.id) {
            True -> PipelineOp(..op, removed: True)
            False -> op
          }
        })
      let baked = case entry.baked_hash {
        Some(hash) ->
          Some(BakedImage(
            document_id: document_id,
            content_hash: hash,
            collapsed_ops: list.length(entry.collapsed_op_ids),
            baked_at: now,
          ))
        None -> None
      }
      #(ops, baked)
    }
    None -> #(state.ops, state.baked)
  }
  store
  |> replace_state(document_id, PipelineState(
    ops: ops,
    logs: list.append(logs, [redo_entry]),
    baked: baked,
  ))
  |> touch_document(document_id, now)
}

// ---------------------------------------------------------------------------
// Family 1 delegation: M1's exact EditUndone / EditRedone semantics — the
// newest command's precomputed inverse is appended to the command log.
// ---------------------------------------------------------------------------

fn undo_document_edit(
  store: st.Store,
  document_id: Id,
  _command: types.DocumentCommand,
  now: Timestamp,
) -> Result(st.Store, PipelineError) {
  case st.undo(store, document_id, now) {
    Ok(store) -> Ok(store)
    Error(st.NothingToUndo) -> Error(NothingToUndo)
    Error(st.DocumentNotFound) -> Error(DocumentNotFound)
    Error(_) -> Error(NothingToUndo)
  }
}

fn redo_document_edit(
  store: st.Store,
  document_id: Id,
  _command: types.DocumentCommand,
  now: Timestamp,
) -> Result(st.Store, PipelineError) {
  case st.redo(store, document_id, now) {
    Ok(store) -> Ok(store)
    Error(st.NothingToRedo) -> Error(NothingToRedo)
    Error(st.DocumentNotFound) -> Error(DocumentNotFound)
    Error(_) -> Error(NothingToRedo)
  }
}

fn newest_undoable_command(
  commands: List(types.DocumentCommand),
) -> Result(types.DocumentCommand, Nil) {
  case list.last(commands) {
    Ok(command) if command.verb != types.Undo -> Ok(command)
    _ -> Error(Nil)
  }
}

fn newest_redoable_command(
  commands: List(types.DocumentCommand),
) -> Result(types.DocumentCommand, Nil) {
  case list.last(commands) {
    Ok(command) if command.verb == types.Undo -> Ok(command)
    _ -> Error(Nil)
  }
}

fn newest_undoable_op(
  logs: List(PipelineOpLog),
) -> Result(PipelineOpLog, Nil) {
  case list.last(logs) {
    Ok(entry) if entry.verb != LogUndo -> Ok(entry)
    _ -> Error(Nil)
  }
}

fn newest_redoable_op(logs: List(PipelineOpLog)) -> Result(PipelineOpLog, Nil) {
  case list.last(logs) {
    Ok(entry) if entry.verb == LogUndo -> Ok(entry)
    _ -> Error(Nil)
  }
}

// ---------------------------------------------------------------------------
// EditorTools surface op-provides guards (spec surface provides list)
// ---------------------------------------------------------------------------

/// ApplyStubToneShift when active_ops < config.max_pipeline_ops.
pub fn can_apply(store: st.Store, document_id: Id) -> Bool {
  case stack_of(store, document_id) {
    Error(_) -> False
    Ok(stack) ->
      list.length(stack.active_ops) < config.max_pipeline_ops
  }
}

/// EditStubToneShift / BakePipeline when an op is active.
pub fn can_edit(store: st.Store, document_id: Id) -> Bool {
  case stack_of(store, document_id) {
    Error(_) -> False
    Ok(stack) -> !list.is_empty(stack.active_ops)
  }
}

/// BakePipeline when stack.active_ops.count > 0.
pub fn can_bake(store: st.Store, document_id: Id) -> Bool {
  can_edit(store, document_id)
}

/// UndoGesture when either log can undo right now.
pub fn can_undo(store: st.Store, document_id: Id) -> Bool {
  st.can_undo(store, document_id)
  || newest_undoable_op(op_logs_of(store, document_id)) |> result_is_ok
}

/// RedoGesture when either log can redo right now.
pub fn can_redo(store: st.Store, document_id: Id) -> Bool {
  st.can_redo(store, document_id)
  || newest_redoable_op(op_logs_of(store, document_id)) |> result_is_ok
}

// ---------------------------------------------------------------------------
// contract DeterministicPipelineOp: materialize is a pure function of the
// retained source and the ops (no store, no clock — PureAndLocal, NFR-PR1).
// SameParamsSameResult: identical parameters + seed + source => identical
// result (AC-F045-02 shape).
// ---------------------------------------------------------------------------

pub fn materialize(source: SourceImage, ops: List(PipelineOp)) -> String {
  list.fold(ops, source.content_hash, fn(acc, op) {
    acc
    <> "|"
    <> int.to_string(op.amount)
    <> ","
    <> int.to_string(op.seed)
    <> ","
    <> int.to_string(op.position)
  })
}

pub fn baked_image_of(
  store: st.Store,
  document_id: Id,
) -> Result(BakedImage, PipelineError) {
  use state <- require_state(store, document_id)
  case state.baked {
    Some(baked) -> Ok(baked)
    None -> Error(NotBaked)
  }
}

// ---------------------------------------------------------------------------
// Internals: guards, dispatch helpers
// ---------------------------------------------------------------------------

fn require_document(
  store: st.Store,
  document_id: Id,
  next: fn(types.PatternDocument) -> Result(a, PipelineError),
) -> Result(a, PipelineError) {
  case st.document(store, document_id) {
    Error(_) -> Error(DocumentNotFound)
    Ok(document) -> next(document)
  }
}

fn require_state(
  store: st.Store,
  document_id: Id,
  next: fn(PipelineState) -> Result(a, PipelineError),
) -> Result(a, PipelineError) {
  case find_marker(store, document_id) {
    Error(_) ->
      case st.document(store, document_id) {
        Error(_) -> Error(DocumentNotFound)
        Ok(_) -> Error(StackNotInitialised)
      }
    Ok(entry) ->
      case decode_state(entry.content_hash) {
        Error(_) -> Error(CorruptState)
        Ok(state) -> next(state)
      }
  }
}

fn require_source(
  store: st.Store,
  document_id: Id,
  next: fn(SourceImage) -> Result(a, PipelineError),
) -> Result(a, PipelineError) {
  // requires: exists m1/SourceImage{document} — the retained source bitmap.
  // Marker entries are skipped by store.source_of, so a blank document
  // genuinely has no retained source.
  case st.source_of(store, document_id) {
    Error(_) -> Error(SourceNotRetained)
    Ok(source) -> next(source)
  }
}

fn require_amount_bound(
  amount: Int,
  next: fn() -> Result(a, PipelineError),
) -> Result(a, PipelineError) {
  case amount >= -config.stub_tone_amount_bound
    && amount <= config.stub_tone_amount_bound {
    True -> next()
    False -> Error(AmountOutOfBounds)
  }
}

fn require_stack_room(
  active: List(PipelineOp),
  next: fn() -> Result(a, PipelineError),
) -> Result(a, PipelineError) {
  case list.length(active) < config.max_pipeline_ops {
    True -> next()
    False -> Error(OpStackFull)
  }
}

fn require_active_ops(
  active: List(PipelineOp),
  next: fn() -> Result(a, PipelineError),
) -> Result(a, PipelineError) {
  case list.is_empty(active) {
    True -> Error(OpStackEmpty)
    False -> next()
  }
}

fn require_active_op(
  active: List(PipelineOp),
  op_id: Id,
  next: fn(PipelineOp) -> Result(a, PipelineError),
) -> Result(a, PipelineError) {
  case list.find(active, fn(op) { op.id == op_id }) {
    Ok(op) -> next(op)
    Error(_) -> Error(OpNotActive)
  }
}

fn require_confirmed(
  confirmed: Bool,
  next: fn() -> Result(a, PipelineError),
) -> Result(a, PipelineError) {
  case confirmed {
    True -> next()
    False -> Error(BakeNotConfirmed)
  }
}

fn op_logs_of(store: st.Store, document_id: Id) -> List(PipelineOpLog) {
  case stack_of(store, document_id) {
    Ok(stack) -> stack.logs
    Error(_) -> []
  }
}

fn op_amount(ops: List(PipelineOp), op_id: Id) -> Option(Int) {
  case list.find(ops, fn(op) { op.id == op_id }) {
    Ok(op) -> Some(op.amount)
    Error(_) -> None
  }
}

fn update_op(
  ops: List(PipelineOp),
  op_id: Id,
  update: fn(PipelineOp) -> PipelineOp,
) -> List(PipelineOp) {
  list.map(ops, fn(op) {
    case op.id == op_id {
      True -> update(op)
      False -> op
    }
  })
}

fn touch_document(
  store: st.Store,
  document_id: Id,
  now: Timestamp,
) -> Result(st.Store, PipelineError) {
  case st.touch(store, document_id, now) {
    Ok(store) -> Ok(store)
    Error(_) -> Error(DocumentNotFound)
  }
}

fn op_id(document_id: Id, n: Int) -> Id {
  document_id <> "#op-" <> int.to_string(n)
}

fn result_is_ok(result: Result(a, e)) -> Bool {
  case result {
    Ok(_) -> True
    Error(_) -> False
  }
}

// ---------------------------------------------------------------------------
// PipelineOpStack storage (marker SourceImage in Store.sources)
// ---------------------------------------------------------------------------

type PipelineState {
  PipelineState(
    ops: List(PipelineOp),
    logs: List(PipelineOpLog),
    baked: Option(BakedImage),
  )
}

fn empty_state() -> PipelineState {
  PipelineState(ops: [], logs: [], baked: None)
}

fn find_marker(store: st.Store, document_id: Id) -> Result(SourceImage, Nil) {
  list.find(store.sources, fn(source) {
    source.id == pipeline_state_source_id && source.document_id == document_id
  })
}

fn marker_entry(
  document_id: Id,
  state: PipelineState,
  now: Timestamp,
) -> SourceImage {
  SourceImage(
    id: pipeline_state_source_id,
    document_id: document_id,
    content_hash: encode_state(state),
    imported_at: now,
  )
}

fn replace_state(
  store: st.Store,
  document_id: Id,
  state: PipelineState,
) -> st.Store {
  st.Store(..store, sources: list.map(store.sources, fn(source) {
    case
      source.id == pipeline_state_source_id
      && source.document_id == document_id
    {
      True -> SourceImage(..source, content_hash: encode_state(state))
      False -> source
    }
  }))
}

// ---------------------------------------------------------------------------
// JSON codec for the marker content_hash
// ---------------------------------------------------------------------------

fn encode_state(state: PipelineState) -> String {
  json.to_string(json.object([
    #("ops", json.array(state.ops, encode_op)),
    #("logs", json.array(state.logs, encode_log)),
    #("baked", case state.baked {
      None -> json.null()
      Some(baked) -> encode_baked(baked)
    }),
  ]))
}

fn encode_op(op: PipelineOp) -> json.Json {
  json.object([
    #("id", json.string(op.id)),
    #("kind", json.string("stub_tone_shift")),
    #("amount", json.int(op.amount)),
    #("seed", json.int(op.seed)),
    #("position", json.int(op.position)),
    #("removed", json.bool(op.removed)),
    #("committed_at", json.int(op.committed_at)),
  ])
}

fn encode_log(entry: PipelineOpLog) -> json.Json {
  json.object([
    #("sequence", json.int(entry.sequence)),
    #("verb", json.string(log_verb_token(entry.verb))),
    #("origin", json.string(log_origin_token(entry.origin))),
    #("op_id", json.string(entry.op_id)),
    #("prior_amount", encode_optional_int(entry.prior_amount)),
    #("baked_hash", encode_optional_string(entry.baked_hash)),
    #("collapsed_op_ids", json.array(entry.collapsed_op_ids, json.string)),
    #("undone_verb", encode_optional_verb(entry.undone_verb)),
    #("committed_at", json.int(entry.committed_at)),
  ])
}

fn encode_baked(baked: BakedImage) -> json.Json {
  json.object([
    #("document_id", json.string(baked.document_id)),
    #("content_hash", json.string(baked.content_hash)),
    #("collapsed_ops", json.int(baked.collapsed_ops)),
    #("baked_at", json.int(baked.baked_at)),
  ])
}

fn encode_optional_int(value: Option(Int)) -> json.Json {
  case value {
    Some(i) -> json.int(i)
    None -> json.null()
  }
}

fn encode_optional_string(value: Option(String)) -> json.Json {
  case value {
    Some(s) -> json.string(s)
    None -> json.null()
  }
}

fn encode_optional_verb(value: Option(OpVerb)) -> json.Json {
  case value {
    Some(verb) -> json.string(op_verb_token(verb))
    None -> json.null()
  }
}

fn decode_state(payload: String) -> Result(PipelineState, Nil) {
  case json.parse(payload, using: state_decoder()) {
    Ok(state) -> Ok(state)
    Error(_) -> Error(Nil)
  }
}

fn state_decoder() -> Decoder(PipelineState) {
  use ops <- decode.field("ops", decode.list(op_decoder()))
  use logs <- decode.field("logs", decode.list(log_decoder()))
  use baked <- decode.field("baked", decode.optional(baked_decoder()))
  decode.success(PipelineState(ops:, logs:, baked:))
}

fn op_decoder() -> Decoder(PipelineOp) {
  use id <- decode.field("id", decode.string)
  use kind <- decode.field("kind", decode.string)
  use amount <- decode.field("amount", decode.int)
  use seed <- decode.field("seed", decode.int)
  use position <- decode.field("position", decode.int)
  use removed <- decode.field("removed", decode.bool)
  use committed_at <- decode.field("committed_at", decode.int)
  case kind {
    "stub_tone_shift" ->
      decode.success(PipelineOp(
        id:,
        kind: StubToneShift,
        amount:,
        seed:,
        position:,
        removed:,
        committed_at:,
      ))
    _ ->
      decode.failure(
        PipelineOp(
          id:,
          kind: StubToneShift,
          amount:,
          seed:,
          position:,
          removed:,
          committed_at:,
        ),
        "pipeline op kind",
      )
  }
}

fn log_decoder() -> Decoder(PipelineOpLog) {
  use sequence <- decode.field("sequence", decode.int)
  use verb <- decode.field("verb", decode.string)
  use origin <- decode.field("origin", decode.string)
  use op_id <- decode.field("op_id", decode.string)
  use prior_amount <- decode.field("prior_amount", decode.optional(decode.int))
  use baked_hash <- decode.field(
    "baked_hash",
    decode.optional(decode.string),
  )
  use collapsed_op_ids <- decode.field(
    "collapsed_op_ids",
    decode.list(decode.string),
  )
  use undone_verb <- decode.field("undone_verb", decode.optional(decode.string))
  use committed_at <- decode.field("committed_at", decode.int)
  case parse_log_verb(verb), parse_log_origin(origin) {
    Some(verb), Some(origin) ->
      decode.success(PipelineOpLog(
        sequence:,
        verb:,
        origin:,
        op_id:,
        prior_amount:,
        baked_hash:,
        collapsed_op_ids:,
        undone_verb: parse_optional_op_verb(undone_verb),
        committed_at:,
      ))
    _, _ ->
      decode.failure(
        PipelineOpLog(
          sequence:,
          verb: LogAdd,
          origin: Direct,
          op_id:,
          prior_amount:,
          baked_hash:,
          collapsed_op_ids:,
          undone_verb: None,
          committed_at:,
        ),
        "pipeline log verb or origin",
      )
  }
}

fn baked_decoder() -> Decoder(BakedImage) {
  use document_id <- decode.field("document_id", decode.string)
  use content_hash <- decode.field("content_hash", decode.string)
  use collapsed_ops <- decode.field("collapsed_ops", decode.int)
  use baked_at <- decode.field("baked_at", decode.int)
  decode.success(BakedImage(
    document_id:,
    content_hash:,
    collapsed_ops:,
    baked_at:,
  ))
}

fn parse_optional_op_verb(token: Option(String)) -> Option(OpVerb) {
  case token {
    Some(value) -> option.from_result(parse_op_verb(value))
    None -> None
  }
}

fn op_verb_token(verb: OpVerb) -> String {
  case verb {
    AddOp -> "add"
    RemoveOp -> "remove"
    EditOp -> "edit"
    BakeOp -> "bake"
  }
}

fn parse_op_verb(token: String) -> Result(OpVerb, Nil) {
  case token {
    "add" -> Ok(AddOp)
    "remove" -> Ok(RemoveOp)
    "edit" -> Ok(EditOp)
    "bake" -> Ok(BakeOp)
    _ -> Error(Nil)
  }
}

fn log_verb_token(verb: LogVerb) -> String {
  case verb {
    LogAdd -> "add"
    LogRemove -> "remove"
    LogEdit -> "edit"
    LogBake -> "bake"
    LogUndo -> "undo"
    LogRedo -> "redo"
  }
}

fn parse_log_verb(token: String) -> Option(LogVerb) {
  case token {
    "add" -> Some(LogAdd)
    "remove" -> Some(LogRemove)
    "edit" -> Some(LogEdit)
    "bake" -> Some(LogBake)
    "undo" -> Some(LogUndo)
    "redo" -> Some(LogRedo)
    _ -> None
  }
}

fn log_origin_token(origin: LogOrigin) -> String {
  case origin {
    Direct -> "direct"
    ByUndo -> "undo"
    ByRedo -> "redo"
  }
}

fn parse_log_origin(token: String) -> Option(LogOrigin) {
  case token {
    "direct" -> Some(Direct)
    "undo" -> Some(ByUndo)
    "redo" -> Some(ByRedo)
    _ -> None
  }
}
