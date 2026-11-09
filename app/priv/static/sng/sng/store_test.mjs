import * as $list from "../../gleam_stdlib/gleam/list.mjs";
import * as $option from "../../gleam_stdlib/gleam/option.mjs";
import * as $should from "../../gleeunit/gleeunit/should.mjs";
import {
  Ok,
  Error,
  List$Empty$const as $List$Empty$const,
  prepend as listPrepend,
  makeError,
  remainderInt,
} from "../gleam.mjs";
import * as $config from "../sng/config.mjs";
import * as $st from "../sng/store.mjs";
import * as $stub from "../sng/stub.mjs";
import * as $types from "../sng/types.mjs";

const FILEPATH = "test/sng/store_test.gleam";

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

function blank(s) {
  let $ = $st.create_blank(s, 4, 3, 1000);
  let pair;
  if ($ instanceof Ok) {
    pair = $[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      22,
      "blank",
      "Pattern match failed, no pattern matched the value.",
      { value: $, start: 622, end: 674, pattern_start: 633, pattern_end: 641 }
    )
  }
  return pair;
}

export function blank_document_created_test() {
  let $ = blank($st.new$());
  let s = $[0];
  let doc = $[1];
  let _pipe = doc.name;
  $should.equal(_pipe, "Untitled");
  let _pipe$1 = doc.width;
  $should.equal(_pipe$1, 4);
  let _pipe$2 = doc.height;
  $should.equal(_pipe$2, 3);
  let _pipe$3 = doc.created_at;
  $should.equal(_pipe$3, 1000);
  let _pipe$4 = doc.last_edited;
  $should.equal(_pipe$4, 1000);
  let _pipe$5 = doc.palette;
  $should.not_equal(_pipe$5, $List$Empty$const);
  let _pipe$6 = $list.length(s.documents);
  return $should.equal(_pipe$6, 1);
}

export function blank_document_invalid_dimensions_test() {
  let _pipe = $st.create_blank($st.new$(), 0, 5, 1000);
  $should.equal(_pipe, new Error($st.StoreError$InvalidDimensions$const));
  let _pipe$1 = $st.create_blank($st.new$(), 5, 0, 1000);
  return $should.equal(
    _pipe$1,
    new Error($st.StoreError$InvalidDimensions$const),
  );
}

export function image_imported_stub_test() {
  let bytes = listPrepend(
    10,
    listPrepend(
      20,
      listPrepend(30, listPrepend(40, listPrepend(50, $List$Empty$const))),
    ),
  );
  let $ = $st.import_image_stub($st.new$(), "photo.png", bytes, 2000);
  let s;
  let doc;
  if ($ instanceof Ok) {
    s = $[0][0];
    doc = $[0][1];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      50,
      "image_imported_stub_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $,
        start: 1487,
        end: 1570,
        pattern_start: 1498,
        pattern_end: 1511
      }
    )
  }
  let _pipe = doc.name;
  $should.equal(_pipe, "photo.png");
  let _pipe$1 = doc.width;
  $should.equal(_pipe$1, 16);
  let _pipe$2 = doc.height;
  $should.equal(_pipe$2, 16);
  let _pipe$3 = $types.cell_at(doc.cells, new $types.CellPosition(0, 0));
  $should.equal(
    _pipe$3,
    new $option.Some(remainderInt(10, $list.length(doc.palette))),
  );
  let $1 = $st.source_of(s, doc.id);
  let source;
  if ($1 instanceof Ok) {
    source = $1[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      58,
      "image_imported_stub_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $1,
        start: 1908,
        end: 1955,
        pattern_start: 1919,
        pattern_end: 1929
      }
    )
  }
  let _pipe$4 = source.content_hash;
  $should.equal(_pipe$4, $stub.content_hash(bytes));
  let _pipe$5 = source.imported_at;
  return $should.equal(_pipe$5, 2000);
}

export function stub_import_is_deterministic_test() {
  let bytes = listPrepend(1, listPrepend(2, listPrepend(3, $List$Empty$const)));
  let _pipe = $stub.stub_convert(bytes);
  return $should.equal(_pipe, $stub.stub_convert(bytes));
}

export function stitches_drawn_test() {
  let $ = blank($st.new$());
  let s = $[0];
  let doc = $[1];
  let stroke = edit(
    listPrepend(
      change(1, 1, 2),
      listPrepend(change(2, 1, 2), $List$Empty$const),
    ),
  );
  let $1 = $st.draw(s, doc.id, stroke, 3000);
  let s$1;
  if ($1 instanceof Ok) {
    s$1 = $1[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      73,
      "stitches_drawn_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $1,
        start: 2412,
        end: 2463,
        pattern_start: 2423,
        pattern_end: 2428
      }
    )
  }
  let $2 = $st.document(s$1, doc.id);
  let updated;
  if ($2 instanceof Ok) {
    updated = $2[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      74,
      "stitches_drawn_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $2,
        start: 2466,
        end: 2513,
        pattern_start: 2477,
        pattern_end: 2488
      }
    )
  }
  let _pipe = $types.cell_at(updated.cells, new $types.CellPosition(1, 1));
  $should.equal(_pipe, new $option.Some(2));
  let _pipe$1 = $types.cell_at(updated.cells, new $types.CellPosition(2, 1));
  $should.equal(_pipe$1, new $option.Some(2));
  let _pipe$2 = updated.last_edited;
  $should.equal(_pipe$2, 3000);
  let commands = $st.commands_of(s$1, doc.id);
  let _pipe$3 = $list.length(commands);
  $should.equal(_pipe$3, 1);
  let $3 = $list.first(commands);
  let command;
  if ($3 instanceof Ok) {
    command = $3[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      83,
      "stitches_drawn_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $3,
        start: 2829,
        end: 2874,
        pattern_start: 2840,
        pattern_end: 2851
      }
    )
  }
  let _pipe$4 = command.verb;
  $should.equal(_pipe$4, $types.CommandVerb$Draw$const);
  let _pipe$5 = command.sequence;
  $should.equal(_pipe$5, 1);
  let _pipe$6 = command.inverse;
  return $should.equal(
    _pipe$6,
    edit(
      listPrepend(
        new $types.CellChange(
          new $types.CellPosition(1, 1),
          new $option.Some(2),
          $option.Option$None$const,
        ),
        listPrepend(
          new $types.CellChange(
            new $types.CellPosition(2, 1),
            new $option.Some(2),
            $option.Option$None$const,
          ),
          $List$Empty$const,
        ),
      ),
    ),
  );
}

export function stitches_drawn_empty_palette_fails_test() {
  let doc = new $types.PatternDocument(
    "doc-x",
    "No colours",
    2,
    2,
    $types.empty_grid(2, 2),
    $List$Empty$const,
    0,
    0,
  );
  let s = new $st.Store(
    listPrepend(doc, $List$Empty$const),
    $List$Empty$const,
    $List$Empty$const,
    $List$Empty$const,
    0,
  );
  let _pipe = $st.draw(
    s,
    doc.id,
    edit(listPrepend(change(0, 0, 1), $List$Empty$const)),
    1000,
  );
  return $should.equal(_pipe, new Error($st.StoreError$EmptyPalette$const));
}

export function stitches_drawn_out_of_bounds_fails_test() {
  let $ = blank($st.new$());
  let s = $[0];
  let doc = $[1];
  let _pipe = $st.draw(
    s,
    doc.id,
    edit(listPrepend(change(4, 0, 1), $List$Empty$const)),
    1000,
  );
  $should.equal(_pipe, new Error($st.StoreError$OutOfBounds$const));
  let _pipe$1 = $st.draw(
    s,
    doc.id,
    edit(listPrepend(change(-1, 0, 1), $List$Empty$const)),
    1000,
  );
  $should.equal(_pipe$1, new Error($st.StoreError$OutOfBounds$const));
  let $1 = $st.draw(
    s,
    doc.id,
    edit(listPrepend(change(0, 0, 1), $List$Empty$const)),
    1000,
  );
  let s$1;
  if ($1 instanceof Ok) {
    s$1 = $1[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      124,
      "stitches_drawn_out_of_bounds_fails_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $1,
        start: 4142,
        end: 4210,
        pattern_start: 4153,
        pattern_end: 4158
      }
    )
  }
  let _pipe$2 = $st.draw(
    s$1,
    doc.id,
    edit(
      listPrepend(
        change(0, 0, 2),
        listPrepend(change(9, 9, 2), $List$Empty$const),
      ),
    ),
    1000,
  );
  $should.equal(_pipe$2, new Error($st.StoreError$OutOfBounds$const));
  let $2 = $st.document(s$1, doc.id);
  let unchanged;
  if ($2 instanceof Ok) {
    unchanged = $2[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      127,
      "stitches_drawn_out_of_bounds_fails_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $2,
        start: 4323,
        end: 4372,
        pattern_start: 4334,
        pattern_end: 4347
      }
    )
  }
  let _pipe$3 = $types.cell_at(unchanged.cells, new $types.CellPosition(0, 0));
  return $should.equal(_pipe$3, new $option.Some(1));
}

export function edit_undone_test() {
  let $ = blank($st.new$());
  let s = $[0];
  let doc = $[1];
  let stroke = edit(listPrepend(change(0, 0, 1), $List$Empty$const));
  let $1 = $st.draw(s, doc.id, stroke, 1000);
  let s$1;
  if ($1 instanceof Ok) {
    s$1 = $1[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      137,
      "edit_undone_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $1,
        start: 4653,
        end: 4704,
        pattern_start: 4664,
        pattern_end: 4669
      }
    )
  }
  let $2 = $st.undo(s$1, doc.id, 2000);
  let s$2;
  if ($2 instanceof Ok) {
    s$2 = $2[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      138,
      "edit_undone_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $2,
        start: 4707,
        end: 4750,
        pattern_start: 4718,
        pattern_end: 4723
      }
    )
  }
  let $3 = $st.document(s$2, doc.id);
  let updated;
  if ($3 instanceof Ok) {
    updated = $3[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      139,
      "edit_undone_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $3,
        start: 4753,
        end: 4800,
        pattern_start: 4764,
        pattern_end: 4775
      }
    )
  }
  let _pipe = $types.cell_at(updated.cells, new $types.CellPosition(0, 0));
  $should.equal(_pipe, $option.Option$None$const);
  let _pipe$1 = updated.last_edited;
  $should.equal(_pipe$1, 2000);
  let commands = $st.commands_of(s$2, doc.id);
  let _pipe$2 = $list.length(commands);
  $should.equal(_pipe$2, 2);
  let $4 = $list.last(commands);
  let undo_command;
  if ($4 instanceof Ok) {
    undo_command = $4[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      146,
      "edit_undone_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $4,
        start: 5022,
        end: 5071,
        pattern_start: 5033,
        pattern_end: 5049
      }
    )
  }
  let _pipe$3 = undo_command.verb;
  $should.equal(_pipe$3, $types.CommandVerb$Undo$const);
  let _pipe$4 = undo_command.edit;
  return $should.equal(
    _pipe$4,
    edit(
      listPrepend(
        new $types.CellChange(
          new $types.CellPosition(0, 0),
          new $option.Some(1),
          $option.Option$None$const,
        ),
        $List$Empty$const,
      ),
    ),
  );
}

export function edit_undone_empty_log_fails_test() {
  let $ = blank($st.new$());
  let s = $[0];
  let doc = $[1];
  let _pipe = $st.undo(s, doc.id, 1000);
  return $should.equal(_pipe, new Error($st.StoreError$NothingToUndo$const));
}

export function edit_undone_twice_fails_test() {
  let $ = blank($st.new$());
  let s = $[0];
  let doc = $[1];
  let $1 = $st.draw(
    s,
    doc.id,
    edit(listPrepend(change(0, 0, 1), $List$Empty$const)),
    1000,
  );
  let s$1;
  if ($1 instanceof Ok) {
    s$1 = $1[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      164,
      "edit_undone_twice_fails_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $1,
        start: 5549,
        end: 5617,
        pattern_start: 5560,
        pattern_end: 5565
      }
    )
  }
  let $2 = $st.undo(s$1, doc.id, 2000);
  let s$2;
  if ($2 instanceof Ok) {
    s$2 = $2[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      165,
      "edit_undone_twice_fails_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $2,
        start: 5620,
        end: 5663,
        pattern_start: 5631,
        pattern_end: 5636
      }
    )
  }
  let _pipe = $st.undo(s$2, doc.id, 3000);
  return $should.equal(_pipe, new Error($st.StoreError$NothingToUndo$const));
}

export function edit_redone_test() {
  let $ = blank($st.new$());
  let s = $[0];
  let doc = $[1];
  let stroke = edit(listPrepend(change(0, 0, 1), $List$Empty$const));
  let $1 = $st.draw(s, doc.id, stroke, 1000);
  let s$1;
  if ($1 instanceof Ok) {
    s$1 = $1[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      172,
      "edit_redone_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $1,
        start: 5838,
        end: 5889,
        pattern_start: 5849,
        pattern_end: 5854
      }
    )
  }
  let $2 = $st.undo(s$1, doc.id, 2000);
  let s$2;
  if ($2 instanceof Ok) {
    s$2 = $2[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      173,
      "edit_redone_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $2,
        start: 5892,
        end: 5935,
        pattern_start: 5903,
        pattern_end: 5908
      }
    )
  }
  let $3 = $st.redo(s$2, doc.id, 3000);
  let s$3;
  if ($3 instanceof Ok) {
    s$3 = $3[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      174,
      "edit_redone_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $3,
        start: 5938,
        end: 5981,
        pattern_start: 5949,
        pattern_end: 5954
      }
    )
  }
  let $4 = $st.document(s$3, doc.id);
  let updated;
  if ($4 instanceof Ok) {
    updated = $4[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      175,
      "edit_redone_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $4,
        start: 5984,
        end: 6031,
        pattern_start: 5995,
        pattern_end: 6006
      }
    )
  }
  let _pipe = $types.cell_at(updated.cells, new $types.CellPosition(0, 0));
  $should.equal(_pipe, new $option.Some(1));
  let commands = $st.commands_of(s$3, doc.id);
  let $5 = $list.last(commands);
  let redo_command;
  if ($5 instanceof Ok) {
    redo_command = $5[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      180,
      "edit_redone_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $5,
        start: 6169,
        end: 6218,
        pattern_start: 6180,
        pattern_end: 6196
      }
    )
  }
  let _pipe$1 = redo_command.verb;
  $should.equal(_pipe$1, $types.CommandVerb$Redo$const);
  let _pipe$2 = redo_command.edit;
  return $should.equal(_pipe$2, stroke);
}

export function edit_redone_without_undo_fails_test() {
  let $ = blank($st.new$());
  let s = $[0];
  let doc = $[1];
  let $1 = $st.draw(
    s,
    doc.id,
    edit(listPrepend(change(0, 0, 1), $List$Empty$const)),
    1000,
  );
  let s$1;
  if ($1 instanceof Ok) {
    s$1 = $1[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      187,
      "edit_redone_without_undo_fails_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $1,
        start: 6397,
        end: 6465,
        pattern_start: 6408,
        pattern_end: 6413
      }
    )
  }
  let _pipe = $st.redo(s$1, doc.id, 2000);
  return $should.equal(_pipe, new Error($st.StoreError$NothingToRedo$const));
}

export function edit_redone_empty_log_fails_test() {
  let $ = blank($st.new$());
  let s = $[0];
  let doc = $[1];
  let _pipe = $st.redo(s, doc.id, 1000);
  return $should.equal(_pipe, new Error($st.StoreError$NothingToRedo$const));
}

function materialization_holds(s, doc_id) {
  let $ = $st.document(s, doc_id);
  let doc;
  if ($ instanceof Ok) {
    doc = $[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      326,
      "materialization_holds",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $,
        start: 11788,
        end: 11831,
        pattern_start: 11799,
        pattern_end: 11806
      }
    )
  }
  let _pipe = $st.materialize(s, doc);
  return $should.equal(_pipe, doc.cells);
}

/**
 * Linear-history regression: undo → redo → undo ends back at the empty grid,
 * and every intermediate state replays exactly (invariant LogMaterialization).
 */
export function undo_redo_undo_chain_test() {
  let $ = blank($st.new$());
  let s0 = $[0];
  let doc = $[1];
  let $1 = $st.draw(
    s0,
    doc.id,
    edit(listPrepend(change(0, 0, 1), $List$Empty$const)),
    1000,
  );
  let s1;
  if ($1 instanceof Ok) {
    s1 = $1[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      200,
      "undo_redo_undo_chain_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $1,
        start: 6924,
        end: 6994,
        pattern_start: 6935,
        pattern_end: 6941
      }
    )
  }
  let $2 = $st.undo(s1, doc.id, 2000);
  let s2;
  if ($2 instanceof Ok) {
    s2 = $2[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      201,
      "undo_redo_undo_chain_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $2,
        start: 6997,
        end: 7042,
        pattern_start: 7008,
        pattern_end: 7014
      }
    )
  }
  let $3 = $st.redo(s2, doc.id, 3000);
  let s3;
  if ($3 instanceof Ok) {
    s3 = $3[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      202,
      "undo_redo_undo_chain_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $3,
        start: 7045,
        end: 7090,
        pattern_start: 7056,
        pattern_end: 7062
      }
    )
  }
  let $4 = $st.undo(s3, doc.id, 4000);
  let s4;
  if ($4 instanceof Ok) {
    s4 = $4[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      203,
      "undo_redo_undo_chain_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $4,
        start: 7093,
        end: 7138,
        pattern_start: 7104,
        pattern_end: 7110
      }
    )
  }
  let $5 = $st.document(s4, doc.id);
  let final;
  if ($5 instanceof Ok) {
    final = $5[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      204,
      "undo_redo_undo_chain_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $5,
        start: 7141,
        end: 7187,
        pattern_start: 7152,
        pattern_end: 7161
      }
    )
  }
  let _pipe = $types.cell_at(final.cells, new $types.CellPosition(0, 0));
  $should.equal(_pipe, $option.Option$None$const);
  return materialization_holds(s4, doc.id);
}

/**
 * A new edit after undo clears the redo path.
 */
export function redo_path_cleared_by_new_edit_test() {
  let $ = blank($st.new$());
  let s0 = $[0];
  let doc = $[1];
  let $1 = $st.draw(
    s0,
    doc.id,
    edit(listPrepend(change(0, 0, 1), $List$Empty$const)),
    1000,
  );
  let s1;
  if ($1 instanceof Ok) {
    s1 = $1[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      213,
      "redo_path_cleared_by_new_edit_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $1,
        start: 7444,
        end: 7514,
        pattern_start: 7455,
        pattern_end: 7461
      }
    )
  }
  let $2 = $st.undo(s1, doc.id, 2000);
  let s2;
  if ($2 instanceof Ok) {
    s2 = $2[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      214,
      "redo_path_cleared_by_new_edit_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $2,
        start: 7517,
        end: 7562,
        pattern_start: 7528,
        pattern_end: 7534
      }
    )
  }
  let $3 = $st.draw(
    s2,
    doc.id,
    edit(listPrepend(change(1, 1, 2), $List$Empty$const)),
    3000,
  );
  let s3;
  if ($3 instanceof Ok) {
    s3 = $3[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      215,
      "redo_path_cleared_by_new_edit_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $3,
        start: 7565,
        end: 7635,
        pattern_start: 7576,
        pattern_end: 7582
      }
    )
  }
  let _pipe = $st.redo(s3, doc.id, 4000);
  $should.equal(_pipe, new Error($st.StoreError$NothingToRedo$const));
  let $4 = $st.document(s3, doc.id);
  let doc3;
  if ($4 instanceof Ok) {
    doc3 = $4[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      217,
      "redo_path_cleared_by_new_edit_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $4,
        start: 7707,
        end: 7752,
        pattern_start: 7718,
        pattern_end: 7726
      }
    )
  }
  let _pipe$1 = $types.cell_at(doc3.cells, new $types.CellPosition(0, 0));
  $should.equal(_pipe$1, $option.Option$None$const);
  let _pipe$2 = $types.cell_at(doc3.cells, new $types.CellPosition(1, 1));
  return $should.equal(_pipe$2, new $option.Some(2));
}

export function document_renamed_test() {
  let $ = blank($st.new$());
  let s = $[0];
  let doc = $[1];
  let $1 = $st.rename(s, doc.id, "Sunset", 5000);
  let s$1;
  if ($1 instanceof Ok) {
    s$1 = $1[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      228,
      "document_renamed_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $1,
        start: 8080,
        end: 8135,
        pattern_start: 8091,
        pattern_end: 8096
      }
    )
  }
  let $2 = $st.document(s$1, doc.id);
  let updated;
  if ($2 instanceof Ok) {
    updated = $2[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      229,
      "document_renamed_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $2,
        start: 8138,
        end: 8185,
        pattern_start: 8149,
        pattern_end: 8160
      }
    )
  }
  let _pipe = updated.name;
  $should.equal(_pipe, "Sunset");
  let _pipe$1 = updated.last_edited;
  return $should.equal(_pipe$1, 5000);
}

export function document_renamed_empty_fails_test() {
  let $ = blank($st.new$());
  let s = $[0];
  let doc = $[1];
  let _pipe = $st.rename(s, doc.id, "", 1000);
  return $should.equal(_pipe, new Error($st.StoreError$EmptyName$const));
}

export function document_duplicated_test() {
  let $ = blank($st.new$());
  let s0 = $[0];
  let doc = $[1];
  let $1 = $st.draw(
    s0,
    doc.id,
    edit(listPrepend(change(0, 0, 1), $List$Empty$const)),
    1000,
  );
  let s1;
  if ($1 instanceof Ok) {
    s1 = $1[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      241,
      "document_duplicated_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $1,
        start: 8499,
        end: 8569,
        pattern_start: 8510,
        pattern_end: 8516
      }
    )
  }
  let $2 = $st.duplicate(s1, doc.id, 2000);
  let s2;
  let copy;
  if ($2 instanceof Ok) {
    s2 = $2[0][0];
    copy = $2[0][1];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      242,
      "document_duplicated_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $2,
        start: 8572,
        end: 8631,
        pattern_start: 8583,
        pattern_end: 8598
      }
    )
  }
  let _pipe = copy.name;
  $should.equal(_pipe, "Untitled (copy)");
  let $3 = $st.document(s2, doc.id);
  let original;
  if ($3 instanceof Ok) {
    original = $3[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      244,
      "document_duplicated_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $3,
        start: 8681,
        end: 8730,
        pattern_start: 8692,
        pattern_end: 8704
      }
    )
  }
  let _pipe$1 = copy.cells;
  $should.equal(_pipe$1, original.cells);
  let _pipe$2 = copy.palette;
  $should.equal(_pipe$2, original.palette);
  let _pipe$3 = $st.commands_of(s2, copy.id);
  $should.equal(_pipe$3, $List$Empty$const);
  let _pipe$4 = $st.source_of(s2, copy.id);
  $should.equal(_pipe$4, new Error($st.StoreError$DocumentNotFound$const));
  let _pipe$5 = $list.length(s2.documents);
  return $should.equal(_pipe$5, 2);
}

export function document_deleted_test() {
  let $ = blank($st.new$());
  let s0 = $[0];
  let doc = $[1];
  let $1 = $st.draw(
    s0,
    doc.id,
    edit(listPrepend(change(0, 0, 1), $List$Empty$const)),
    1000,
  );
  let s1;
  if ($1 instanceof Ok) {
    s1 = $1[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      255,
      "document_deleted_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $1,
        start: 9136,
        end: 9206,
        pattern_start: 9147,
        pattern_end: 9153
      }
    )
  }
  let s2 = $st.take_snapshot(s1, doc.id, 1500);
  let $2 = $st.delete$(s2, doc.id);
  let s3;
  if ($2 instanceof Ok) {
    s3 = $2[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      257,
      "document_deleted_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $2,
        start: 9255,
        end: 9296,
        pattern_start: 9266,
        pattern_end: 9272
      }
    )
  }
  let _pipe = $st.document(s3, doc.id);
  $should.equal(_pipe, new Error($st.StoreError$DocumentNotFound$const));
  let _pipe$1 = $st.commands_of(s3, doc.id);
  $should.equal(_pipe$1, $List$Empty$const);
  let _pipe$2 = $st.snapshots_of(s3, doc.id);
  $should.equal(_pipe$2, $List$Empty$const);
  let _pipe$3 = $st.source_of(s3, doc.id);
  return $should.equal(
    _pipe$3,
    new Error($st.StoreError$DocumentNotFound$const),
  );
}

function draw_n(loop$s, loop$doc_id, loop$n, loop$from) {
  while (true) {
    let s = loop$s;
    let doc_id = loop$doc_id;
    let n = loop$n;
    let from = loop$from;
    let $ = n <= 0;
    if ($) {
      return s;
    } else {
      let $1 = $st.draw(
        s,
        doc_id,
        edit(listPrepend(change(0, 0, n), $List$Empty$const)),
        from + n,
      );
      let next;
      if ($1 instanceof Ok) {
        next = $1[0];
      } else {
        throw makeError(
          "let_assert",
          FILEPATH,
          "sng/store_test",
          270,
          "draw_n",
          "Pattern match failed, no pattern matched the value.",
          {
            value: $1,
            start: 9745,
            end: 9820,
            pattern_start: 9756,
            pattern_end: 9764
          }
        )
      }
      loop$s = next;
      loop$doc_id = doc_id;
      loop$n = n - 1;
      loop$from = from;
    }
  }
}

export function snapshot_taken_at_interval_test() {
  let $ = blank($st.new$());
  let s = $[0];
  let doc = $[1];
  let s$1 = draw_n(s, doc.id, $config.snapshot_interval_commands, 0);
  let snapshots = $st.snapshots_of(s$1, doc.id);
  let _pipe = $list.length(snapshots);
  $should.equal(_pipe, 1);
  let $1 = $list.first(snapshots);
  let snapshot;
  if ($1 instanceof Ok) {
    snapshot = $1[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      281,
      "snapshot_taken_at_interval_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $1,
        start: 10108,
        end: 10155,
        pattern_start: 10119,
        pattern_end: 10131
      }
    )
  }
  let _pipe$1 = snapshot.sequence;
  $should.equal(_pipe$1, $config.snapshot_interval_commands);
  let _pipe$2 = $st.commands_since_last_snapshot(s$1, doc.id);
  $should.equal(_pipe$2, 0);
  let _pipe$3 = $st.pending_snapshot(s$1, doc.id);
  return $should.be_false(_pipe$3);
}

export function snapshot_not_taken_below_interval_test() {
  let $ = blank($st.new$());
  let s = $[0];
  let doc = $[1];
  let s$1 = draw_n(s, doc.id, $config.snapshot_interval_commands - 1, 0);
  let _pipe = $st.snapshots_of(s$1, doc.id);
  $should.equal(_pipe, $List$Empty$const);
  let _pipe$1 = $st.pending_snapshot(s$1, doc.id);
  return $should.be_false(_pipe$1);
}

export function snapshot_requires_commands_test() {
  let $ = blank($st.new$());
  let s = $[0];
  let doc = $[1];
  let s$1 = $st.take_snapshot(s, doc.id, 1000);
  let _pipe = $st.snapshots_of(s$1, doc.id);
  return $should.equal(_pipe, $List$Empty$const);
}

export function snapshot_repeats_every_interval_test() {
  let $ = blank($st.new$());
  let s = $[0];
  let doc = $[1];
  let s$1 = draw_n(s, doc.id, $config.snapshot_interval_commands * 2, 0);
  let _pipe = $list.length($st.snapshots_of(s$1, doc.id));
  return $should.equal(_pipe, 2);
}

export function offline_indicator_shown_and_hidden_test() {
  let session = $st.new_session("session-1", 1000, true);
  let _pipe = session.network_available;
  $should.be_true(_pipe);
  let _pipe$1 = session.offline_notice_shown;
  $should.be_false(_pipe$1);
  let offline = $st.offline_detected(session);
  let _pipe$2 = offline.network_available;
  $should.be_false(_pipe$2);
  let _pipe$3 = offline.offline_notice_shown;
  $should.be_true(_pipe$3);
  let online = $st.online_restored(offline);
  let _pipe$4 = online.network_available;
  $should.be_true(_pipe$4);
  let _pipe$5 = online.offline_notice_shown;
  return $should.be_false(_pipe$5);
}

export function invariant_log_materialization_test() {
  let $ = blank($st.new$());
  let s0 = $[0];
  let doc = $[1];
  materialization_holds(s0, doc.id);
  let $1 = $st.draw(
    s0,
    doc.id,
    edit(listPrepend(change(0, 0, 1), $List$Empty$const)),
    1000,
  );
  let s1;
  if ($1 instanceof Ok) {
    s1 = $1[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      333,
      "invariant_log_materialization_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $1,
        start: 12006,
        end: 12076,
        pattern_start: 12017,
        pattern_end: 12023
      }
    )
  }
  materialization_holds(s1, doc.id);
  let $2 = $st.draw(
    s1,
    doc.id,
    edit(listPrepend(change(1, 1, 2), $List$Empty$const)),
    2000,
  );
  let s2;
  if ($2 instanceof Ok) {
    s2 = $2[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      335,
      "invariant_log_materialization_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $2,
        start: 12115,
        end: 12185,
        pattern_start: 12126,
        pattern_end: 12132
      }
    )
  }
  materialization_holds(s2, doc.id);
  let $3 = $st.undo(s2, doc.id, 3000);
  let s3;
  if ($3 instanceof Ok) {
    s3 = $3[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      337,
      "invariant_log_materialization_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $3,
        start: 12224,
        end: 12269,
        pattern_start: 12235,
        pattern_end: 12241
      }
    )
  }
  materialization_holds(s3, doc.id);
  let $4 = $st.redo(s3, doc.id, 4000);
  let s4;
  if ($4 instanceof Ok) {
    s4 = $4[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      339,
      "invariant_log_materialization_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $4,
        start: 12308,
        end: 12353,
        pattern_start: 12319,
        pattern_end: 12325
      }
    )
  }
  materialization_holds(s4, doc.id);
  let $5 = $st.draw(
    s4,
    doc.id,
    edit(listPrepend(change(2, 2, 3), $List$Empty$const)),
    5000,
  );
  let s5;
  if ($5 instanceof Ok) {
    s5 = $5[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      341,
      "invariant_log_materialization_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $5,
        start: 12392,
        end: 12462,
        pattern_start: 12403,
        pattern_end: 12409
      }
    )
  }
  return materialization_holds(s5, doc.id);
}

export function invariant_commands_totally_ordered_test() {
  let $ = blank($st.new$());
  let s = $[0];
  let doc = $[1];
  let s$1 = draw_n(s, doc.id, 25, 0);
  let $1 = $st.undo(s$1, doc.id, 100);
  let s$2;
  if ($1 instanceof Ok) {
    s$2 = $1[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      348,
      "invariant_commands_totally_ordered_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $1,
        start: 12624,
        end: 12666,
        pattern_start: 12635,
        pattern_end: 12640
      }
    )
  }
  let _pipe = $st.sequences_unique(s$2, doc.id);
  return $should.be_true(_pipe);
}

export function can_undo_can_redo_test() {
  let $ = blank($st.new$());
  let s = $[0];
  let doc = $[1];
  let _pipe = $st.can_undo(s, doc.id);
  $should.be_false(_pipe);
  let _pipe$1 = $st.can_redo(s, doc.id);
  $should.be_false(_pipe$1);
  let $1 = $st.draw(
    s,
    doc.id,
    edit(listPrepend(change(0, 0, 1), $List$Empty$const)),
    1000,
  );
  let s$1;
  if ($1 instanceof Ok) {
    s$1 = $1[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      359,
      "can_undo_can_redo_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $1,
        start: 12963,
        end: 13031,
        pattern_start: 12974,
        pattern_end: 12979
      }
    )
  }
  let _pipe$2 = $st.can_undo(s$1, doc.id);
  $should.be_true(_pipe$2);
  let _pipe$3 = $st.can_redo(s$1, doc.id);
  $should.be_false(_pipe$3);
  let $2 = $st.undo(s$1, doc.id, 2000);
  let s$2;
  if ($2 instanceof Ok) {
    s$2 = $2[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      363,
      "can_undo_can_redo_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $2,
        start: 13122,
        end: 13165,
        pattern_start: 13133,
        pattern_end: 13138
      }
    )
  }
  let _pipe$4 = $st.can_undo(s$2, doc.id);
  $should.be_false(_pipe$4);
  let _pipe$5 = $st.can_redo(s$2, doc.id);
  $should.be_true(_pipe$5);
  let $3 = $st.redo(s$2, doc.id, 3000);
  let s$3;
  if ($3 instanceof Ok) {
    s$3 = $3[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      367,
      "can_undo_can_redo_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $3,
        start: 13256,
        end: 13299,
        pattern_start: 13267,
        pattern_end: 13272
      }
    )
  }
  let _pipe$6 = $st.can_undo(s$3, doc.id);
  $should.be_true(_pipe$6);
  let _pipe$7 = $st.can_redo(s$3, doc.id);
  return $should.be_false(_pipe$7);
}

export function library_view_exposes_name_thumbnail_last_edited_test() {
  let $ = blank($st.new$());
  let s0 = $[0];
  let doc = $[1];
  let $1 = $st.rename(s0, doc.id, "Rose", 4000);
  let s1;
  if ($1 instanceof Ok) {
    s1 = $1[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      376,
      "library_view_exposes_name_thumbnail_last_edited_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $1,
        start: 13575,
        end: 13630,
        pattern_start: 13586,
        pattern_end: 13592
      }
    )
  }
  let entries = $st.library_view(s1, 9000);
  let _pipe = $list.length(entries);
  $should.equal(_pipe, 1);
  let $2 = $list.first(entries);
  let entry;
  if ($2 instanceof Ok) {
    entry = $2[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      379,
      "library_view_exposes_name_thumbnail_last_edited_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $2,
        start: 13717,
        end: 13759,
        pattern_start: 13728,
        pattern_end: 13737
      }
    )
  }
  let _pipe$1 = entry.document_id;
  $should.equal(_pipe$1, doc.id);
  let _pipe$2 = entry.name;
  $should.equal(_pipe$2, "Rose");
  let _pipe$3 = entry.last_edited;
  $should.equal(_pipe$3, 4000);
  let _pipe$4 = entry.thumbnail.generated_at;
  return $should.equal(_pipe$4, 9000);
}

export function editor_view_exposes_document_fields_test() {
  let $ = blank($st.new$());
  let s = $[0];
  let doc = $[1];
  let $1 = $st.editor_view(s, doc.id);
  let view;
  if ($1 instanceof Ok) {
    view = $1[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      388,
      "editor_view_exposes_document_fields_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $1,
        start: 14027,
        end: 14074,
        pattern_start: 14038,
        pattern_end: 14046
      }
    )
  }
  let _pipe = view.document_id;
  $should.equal(_pipe, doc.id);
  let _pipe$1 = view.name;
  $should.equal(_pipe$1, "Untitled");
  let _pipe$2 = view.width;
  $should.equal(_pipe$2, 4);
  let _pipe$3 = view.height;
  $should.equal(_pipe$3, 3);
  let _pipe$4 = view.cells;
  $should.equal(_pipe$4, doc.cells);
  let _pipe$5 = view.palette;
  return $should.equal(_pipe$5, doc.palette);
}

export function anonymous_operations_need_no_identity_test() {
  let $ = blank($st.new$());
  let s0 = $[0];
  let doc = $[1];
  let $1 = $st.draw(
    s0,
    doc.id,
    edit(listPrepend(change(0, 0, 1), $List$Empty$const)),
    1000,
  );
  let s1;
  if ($1 instanceof Ok) {
    s1 = $1[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      403,
      "anonymous_operations_need_no_identity_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $1,
        start: 14609,
        end: 14679,
        pattern_start: 14620,
        pattern_end: 14626
      }
    )
  }
  let $2 = $st.undo(s1, doc.id, 2000);
  let s2;
  if ($2 instanceof Ok) {
    s2 = $2[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      404,
      "anonymous_operations_need_no_identity_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $2,
        start: 14682,
        end: 14727,
        pattern_start: 14693,
        pattern_end: 14699
      }
    )
  }
  let $3 = $st.redo(s2, doc.id, 3000);
  let s3;
  if ($3 instanceof Ok) {
    s3 = $3[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      405,
      "anonymous_operations_need_no_identity_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $3,
        start: 14730,
        end: 14775,
        pattern_start: 14741,
        pattern_end: 14747
      }
    )
  }
  let $4 = $st.duplicate(s3, doc.id, 4000);
  let s4;
  if ($4 instanceof Ok) {
    s4 = $4[0][0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      406,
      "anonymous_operations_need_no_identity_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $4,
        start: 14778,
        end: 14838,
        pattern_start: 14789,
        pattern_end: 14805
      }
    )
  }
  let $5 = $st.rename(s4, doc.id, "Free", 5000);
  if (!($5 instanceof Ok)) {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store_test",
      407,
      "anonymous_operations_need_no_identity_test",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $5,
        start: 14841,
        end: 14897,
        pattern_start: 14852,
        pattern_end: 14859
      }
    )
  }
  return $5;
}
