import * as $option from "../../gleam_stdlib/gleam/option.mjs";
import * as $should from "../../gleeunit/gleeunit/should.mjs";
import { List$Empty$const as $List$Empty$const, prepend as listPrepend } from "../gleam.mjs";
import * as $stub from "../sng/stub.mjs";
import * as $types from "../sng/types.mjs";

export function cell_position_equality_test() {
  let _pipe = new $types.CellPosition(1, 2);
  $should.equal(_pipe, new $types.CellPosition(1, 2));
  let _pipe$1 = new $types.CellPosition(1, 2);
  return $should.not_equal(_pipe$1, new $types.CellPosition(2, 1));
}

export function cell_state_equality_test() {
  let _pipe = new $types.CellState(
    new $types.CellPosition(0, 0),
    new $option.Some(3),
  );
  $should.equal(
    _pipe,
    new $types.CellState(new $types.CellPosition(0, 0), new $option.Some(3)),
  );
  let _pipe$1 = new $types.CellState(
    new $types.CellPosition(0, 0),
    $option.Option$None$const,
  );
  return $should.not_equal(
    _pipe$1,
    new $types.CellState(new $types.CellPosition(0, 0), new $option.Some(3)),
  );
}

export function cell_change_equality_test() {
  let _pipe = new $types.CellChange(
    new $types.CellPosition(1, 1),
    $option.Option$None$const,
    new $option.Some(2),
  );
  $should.equal(
    _pipe,
    new $types.CellChange(
      new $types.CellPosition(1, 1),
      $option.Option$None$const,
      new $option.Some(2),
    ),
  );
  let _pipe$1 = new $types.CellChange(
    new $types.CellPosition(1, 1),
    $option.Option$None$const,
    new $option.Some(2),
  );
  return $should.not_equal(
    _pipe$1,
    new $types.CellChange(
      new $types.CellPosition(1, 1),
      new $option.Some(2),
      $option.Option$None$const,
    ),
  );
}

export function document_edit_equality_test() {
  let change = new $types.CellChange(
    new $types.CellPosition(0, 0),
    $option.Option$None$const,
    new $option.Some(1),
  );
  let _pipe = new $types.DocumentEdit(listPrepend(change, $List$Empty$const));
  $should.equal(
    _pipe,
    new $types.DocumentEdit(listPrepend(change, $List$Empty$const)),
  );
  let _pipe$1 = new $types.DocumentEdit(listPrepend(change, $List$Empty$const));
  return $should.not_equal(_pipe$1, new $types.DocumentEdit($List$Empty$const));
}

export function palette_entry_equality_test() {
  let _pipe = new $types.PaletteEntry("Stub Red", "#CC0000");
  $should.equal(_pipe, new $types.PaletteEntry("Stub Red", "#CC0000"));
  let _pipe$1 = new $types.PaletteEntry("Stub Red", "#CC0000");
  return $should.not_equal(
    _pipe$1,
    new $types.PaletteEntry("Stub Blue", "#0000CC"),
  );
}

export function thumbnail_equality_test() {
  let _pipe = new $types.Thumbnail("stub-thumbnail:4-x", 1000);
  $should.equal(_pipe, new $types.Thumbnail("stub-thumbnail:4-x", 1000));
  let _pipe$1 = new $types.Thumbnail("stub-thumbnail:4-x", 1000);
  return $should.not_equal(
    _pipe$1,
    new $types.Thumbnail("stub-thumbnail:4-x", 2000),
  );
}

export function stub_grid_equality_test() {
  let palette = $stub.default_stub_palette();
  let cells = $types.empty_grid(2, 2);
  let _pipe = new $stub.StubGrid(2, 2, cells, palette);
  $should.equal(
    _pipe,
    new $stub.StubGrid(
      2,
      2,
      $types.empty_grid(2, 2),
      $stub.default_stub_palette(),
    ),
  );
  let _pipe$1 = new $stub.StubGrid(2, 2, cells, palette);
  return $should.not_equal(
    _pipe$1,
    new $stub.StubGrid(3, 2, $types.empty_grid(3, 2), palette),
  );
}

export function user_fields_and_anonymity_test() {
  let anonymous = new $types.User("device-1", false);
  let _pipe = anonymous.id;
  $should.equal(_pipe, "device-1");
  let _pipe$1 = $types.is_anonymous(anonymous);
  $should.be_true(_pipe$1);
  let signed_in_elsewhere = new $types.User("account-9", true);
  let _pipe$2 = $types.is_anonymous(signed_in_elsewhere);
  return $should.be_false(_pipe$2);
}

export function thumbnail_rendering_is_deterministic_test() {
  let doc = new $types.PatternDocument(
    "doc-1",
    "Rose",
    2,
    2,
    $types.empty_grid(2, 2),
    $stub.default_stub_palette(),
    1000,
    1000,
  );
  let first = $stub.render_thumbnail(doc, 5000);
  let second = $stub.render_thumbnail(doc, 5000);
  let _pipe = first;
  $should.equal(_pipe, second);
  let _pipe$1 = first.generated_at;
  return $should.equal(_pipe$1, 5000);
}

export function empty_grid_shape_test() {
  let grid = $types.empty_grid(3, 2);
  let _pipe = grid;
  return $should.equal(
    _pipe,
    listPrepend(
      new $types.CellState(
        new $types.CellPosition(0, 0),
        $option.Option$None$const,
      ),
      listPrepend(
        new $types.CellState(
          new $types.CellPosition(1, 0),
          $option.Option$None$const,
        ),
        listPrepend(
          new $types.CellState(
            new $types.CellPosition(2, 0),
            $option.Option$None$const,
          ),
          listPrepend(
            new $types.CellState(
              new $types.CellPosition(0, 1),
              $option.Option$None$const,
            ),
            listPrepend(
              new $types.CellState(
                new $types.CellPosition(1, 1),
                $option.Option$None$const,
              ),
              listPrepend(
                new $types.CellState(
                  new $types.CellPosition(2, 1),
                  $option.Option$None$const,
                ),
                $List$Empty$const,
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

export function apply_edit_sets_cells_test() {
  let edit = new $types.DocumentEdit(
    listPrepend(
      new $types.CellChange(
        new $types.CellPosition(1, 0),
        $option.Option$None$const,
        new $option.Some(2),
      ),
      listPrepend(
        new $types.CellChange(
          new $types.CellPosition(0, 1),
          $option.Option$None$const,
          new $option.Some(3),
        ),
        $List$Empty$const,
      ),
    ),
  );
  let updated = $types.apply_edit($types.empty_grid(3, 2), edit);
  let _pipe = $types.cell_at(updated, new $types.CellPosition(1, 0));
  $should.equal(_pipe, new $option.Some(2));
  let _pipe$1 = $types.cell_at(updated, new $types.CellPosition(0, 1));
  $should.equal(_pipe$1, new $option.Some(3));
  let _pipe$2 = $types.cell_at(updated, new $types.CellPosition(0, 0));
  return $should.equal(_pipe$2, $option.Option$None$const);
}
