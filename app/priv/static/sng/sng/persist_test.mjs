import * as $list from "../../gleam_stdlib/gleam/list.mjs";
import * as $option from "../../gleam_stdlib/gleam/option.mjs";
import * as $should from "../../gleeunit/gleeunit/should.mjs";
import {
  Ok,
  Error,
  List$Empty$const as $List$Empty$const,
  prepend as listPrepend,
  makeError,
} from "../gleam.mjs";
import * as $config from "../sng/config.mjs";
import * as $persist from "../sng/persist.mjs";
import * as $st from "../sng/store.mjs";
import * as $stub from "../sng/stub.mjs";
import * as $types from "../sng/types.mjs";

const FILEPATH = "test/sng/persist_test.gleam";

function change(x, y, after) {
  return new $types.CellChange(
    new $types.CellPosition(x, y),
    $option.Option$None$const,
    new $option.Some(after),
  );
}

function edit(changes) {
  return new $types.DocumentEdit(changes);
}

export function config_defaults_match_spec_test() {
  let _pipe = $config.snapshot_interval_commands;
  $should.equal(_pipe, 100);
  let _pipe$1 = $config.offline_indicator_deadline_ms;
  return $should.equal(_pipe$1, 5000);
}

export function library_persists_across_restarts_test() {
  let $ = $st.create_blank($st.new$(), 4, 3, 1000);
  let s0;
  let doc;
  if ($ instanceof Ok) {
    s0 = $[0][0];
    doc = $[0][1];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/persist_test",
      35,
      "library_persists_across_restarts_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $,
        start: 1130,
        end: 1195,
        pattern_start: 1141,
        pattern_end: 1155
      }
    )
  }
  let $1 = $st.rename(s0, doc.id, "Rose", 2000);
  let s1;
  if ($1 instanceof Ok) {
    s1 = $1[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/persist_test",
      36,
      "library_persists_across_restarts_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $1,
        start: 1198,
        end: 1253,
        pattern_start: 1209,
        pattern_end: 1215
      }
    )
  }
  let $2 = $st.create_blank(s1, 2, 2, 3000);
  let s2;
  let other;
  if ($2 instanceof Ok) {
    s2 = $2[0][0];
    other = $2[0][1];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/persist_test",
      37,
      "library_persists_across_restarts_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $2,
        start: 1256,
        end: 1317,
        pattern_start: 1267,
        pattern_end: 1283
      }
    )
  }
  let payload = $persist.serialize(s2);
  let $3 = $persist.deserialize(payload);
  let restored;
  if ($3 instanceof Ok) {
    restored = $3[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/persist_test",
      42,
      "library_persists_across_restarts_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $3,
        start: 1456,
        end: 1510,
        pattern_start: 1467,
        pattern_end: 1479
      }
    )
  }
  let entries = $st.library_view(restored, 9000);
  let _pipe = $list.length(entries);
  $should.equal(_pipe, 2);
  let names = $list.map(entries, (entry) => { return entry.name; });
  let _pipe$1 = $list.contains(names, "Rose");
  $should.be_true(_pipe$1);
  let _pipe$2 = $list.contains(names, "Untitled");
  $should.be_true(_pipe$2);
  let $4 = $list.find(
    entries,
    (entry) => { return entry.document_id === doc.id; },
  );
  let rose_entry;
  if ($4 instanceof Ok) {
    rose_entry = $4[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/persist_test",
      50,
      "library_persists_across_restarts_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $4,
        start: 1828,
        end: 1921,
        pattern_start: 1839,
        pattern_end: 1853
      }
    )
  }
  let _pipe$3 = rose_entry.last_edited;
  $should.equal(_pipe$3, 2000);
  let _pipe$4 = rose_entry.thumbnail.generated_at;
  $should.equal(_pipe$4, 9000);
  let $5 = $list.find(
    entries,
    (entry) => { return entry.document_id === other.id; },
  );
  let other_entry;
  if ($5 instanceof Ok) {
    other_entry = $5[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/persist_test",
      54,
      "library_persists_across_restarts_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $5,
        start: 2029,
        end: 2125,
        pattern_start: 2040,
        pattern_end: 2055
      }
    )
  }
  let _pipe$5 = other_entry.last_edited;
  return $should.equal(_pipe$5, 3000);
}

export function crash_recovery_restores_last_committed_state_test() {
  let $ = $st.create_blank($st.new$(), 3, 3, 1000);
  let s0;
  let doc;
  if ($ instanceof Ok) {
    s0 = $[0][0];
    doc = $[0][1];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/persist_test",
      62,
      "crash_recovery_restores_last_committed_state_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $,
        start: 2323,
        end: 2388,
        pattern_start: 2334,
        pattern_end: 2348
      }
    )
  }
  let $1 = $st.draw(
    s0,
    doc.id,
    edit(listPrepend(change(0, 0, 1), $List$Empty$const)),
    2000,
  );
  let s1;
  if ($1 instanceof Ok) {
    s1 = $1[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/persist_test",
      63,
      "crash_recovery_restores_last_committed_state_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $1,
        start: 2391,
        end: 2461,
        pattern_start: 2402,
        pattern_end: 2408
      }
    )
  }
  let $2 = $st.draw(
    s1,
    doc.id,
    edit(listPrepend(change(1, 1, 2), $List$Empty$const)),
    3000,
  );
  let s2;
  if ($2 instanceof Ok) {
    s2 = $2[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/persist_test",
      64,
      "crash_recovery_restores_last_committed_state_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $2,
        start: 2464,
        end: 2534,
        pattern_start: 2475,
        pattern_end: 2481
      }
    )
  }
  let payload = $persist.serialize(s2);
  let $3 = $persist.deserialize(payload);
  let restored;
  if ($3 instanceof Ok) {
    restored = $3[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/persist_test",
      67,
      "crash_recovery_restores_last_committed_state_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $3,
        start: 2576,
        end: 2630,
        pattern_start: 2587,
        pattern_end: 2599
      }
    )
  }
  let $4 = $st.document(restored, doc.id);
  let doc$1;
  if ($4 instanceof Ok) {
    doc$1 = $4[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/persist_test",
      68,
      "crash_recovery_restores_last_committed_state_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $4,
        start: 2633,
        end: 2683,
        pattern_start: 2644,
        pattern_end: 2651
      }
    )
  }
  let _pipe = $types.cell_at(doc$1.cells, new $types.CellPosition(0, 0));
  $should.equal(_pipe, new $option.Some(1));
  let _pipe$1 = $types.cell_at(doc$1.cells, new $types.CellPosition(1, 1));
  $should.equal(_pipe$1, new $option.Some(2));
  let _pipe$2 = $st.materialize(restored, doc$1);
  return $should.equal(_pipe$2, doc$1.cells);
}

export function undo_persists_across_sessions_test() {
  let $ = $st.create_blank($st.new$(), 3, 3, 1000);
  let s0;
  let doc;
  if ($ instanceof Ok) {
    s0 = $[0][0];
    doc = $[0][1];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/persist_test",
      79,
      "undo_persists_across_sessions_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $,
        start: 3178,
        end: 3243,
        pattern_start: 3189,
        pattern_end: 3203
      }
    )
  }
  let $1 = $st.draw(
    s0,
    doc.id,
    edit(listPrepend(change(0, 0, 1), $List$Empty$const)),
    2000,
  );
  let s1;
  if ($1 instanceof Ok) {
    s1 = $1[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/persist_test",
      80,
      "undo_persists_across_sessions_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $1,
        start: 3246,
        end: 3316,
        pattern_start: 3257,
        pattern_end: 3263
      }
    )
  }
  let $2 = $st.undo(s1, doc.id, 3000);
  let s2;
  if ($2 instanceof Ok) {
    s2 = $2[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/persist_test",
      81,
      "undo_persists_across_sessions_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $2,
        start: 3319,
        end: 3364,
        pattern_start: 3330,
        pattern_end: 3336
      }
    )
  }
  let payload = $persist.serialize(s2);
  let $3 = $persist.deserialize(payload);
  let restored;
  if ($3 instanceof Ok) {
    restored = $3[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/persist_test",
      84,
      "undo_persists_across_sessions_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $3,
        start: 3406,
        end: 3460,
        pattern_start: 3417,
        pattern_end: 3429
      }
    )
  }
  let $4 = $st.document(restored, doc.id);
  let restored_doc;
  if ($4 instanceof Ok) {
    restored_doc = $4[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/persist_test",
      85,
      "undo_persists_across_sessions_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $4,
        start: 3463,
        end: 3522,
        pattern_start: 3474,
        pattern_end: 3490
      }
    )
  }
  let _pipe = $types.cell_at(restored_doc.cells, new $types.CellPosition(0, 0));
  $should.equal(_pipe, $option.Option$None$const);
  let verbs = $list.map(
    $st.commands_of(restored, doc.id),
    (c) => { return c.verb; },
  );
  let _pipe$1 = verbs;
  $should.equal(
    _pipe$1,
    listPrepend(
      $types.CommandVerb$Draw$const,
      listPrepend($types.CommandVerb$Undo$const, $List$Empty$const),
    ),
  );
  let _pipe$2 = $st.can_redo(restored, doc.id);
  return $should.be_true(_pipe$2);
}

export function source_retained_across_restarts_test() {
  let bytes = listPrepend(7, listPrepend(8, listPrepend(9, $List$Empty$const)));
  let $ = $st.import_image_stub($st.new$(), "photo.png", bytes, 1000);
  let s0;
  let doc;
  if ($ instanceof Ok) {
    s0 = $[0][0];
    doc = $[0][1];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/persist_test",
      98,
      "source_retained_across_restarts_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $,
        start: 4031,
        end: 4115,
        pattern_start: 4042,
        pattern_end: 4056
      }
    )
  }
  let $1 = $persist.deserialize($persist.serialize(s0));
  let restored;
  if ($1 instanceof Ok) {
    restored = $1[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/persist_test",
      99,
      "source_retained_across_restarts_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $1,
        start: 4118,
        end: 4186,
        pattern_start: 4129,
        pattern_end: 4141
      }
    )
  }
  let $2 = $st.source_of(restored, doc.id);
  let source;
  if ($2 instanceof Ok) {
    source = $2[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/persist_test",
      100,
      "source_retained_across_restarts_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $2,
        start: 4189,
        end: 4243,
        pattern_start: 4200,
        pattern_end: 4210
      }
    )
  }
  let _pipe = source.content_hash;
  return $should.equal(_pipe, $stub.content_hash(bytes));
}

export function corrupt_payload_is_rejected_test() {
  let _pipe = $persist.deserialize("this is not json");
  return $should.equal(
    _pipe,
    new Error(new $persist.Corrupt("store payload did not decode")),
  );
}
