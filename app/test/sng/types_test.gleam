//// Generated from specs/m1-local-foundation.allium — value types, entity
//// fields, and derived values (value-equality.*, entity-fields.*,
//// derived.User.is_anonymous, derived.PatternDocument.thumbnail).

import gleam/option
import gleeunit/should
import sng/stub
import sng/types

// -- value-equality / entity-fields -----------------------------------------

pub fn cell_position_equality_test() {
  types.CellPosition(1, 2) |> should.equal(types.CellPosition(1, 2))
  types.CellPosition(1, 2) |> should.not_equal(types.CellPosition(2, 1))
}

pub fn cell_state_equality_test() {
  types.CellState(types.CellPosition(0, 0), option.Some(3))
  |> should.equal(types.CellState(types.CellPosition(0, 0), option.Some(3)))
  types.CellState(types.CellPosition(0, 0), option.None)
  |> should.not_equal(types.CellState(types.CellPosition(0, 0), option.Some(3)))
}

pub fn cell_change_equality_test() {
  types.CellChange(types.CellPosition(1, 1), option.None, option.Some(2))
  |> should.equal(types.CellChange(
    types.CellPosition(1, 1),
    option.None,
    option.Some(2),
  ))
  types.CellChange(types.CellPosition(1, 1), option.None, option.Some(2))
  |> should.not_equal(types.CellChange(
    types.CellPosition(1, 1),
    option.Some(2),
    option.None,
  ))
}

pub fn document_edit_equality_test() {
  let change = types.CellChange(types.CellPosition(0, 0), option.None, option.Some(1))
  types.DocumentEdit([change]) |> should.equal(types.DocumentEdit([change]))
  types.DocumentEdit([change]) |> should.not_equal(types.DocumentEdit([]))
}

pub fn palette_entry_equality_test() {
  types.PaletteEntry("Stub Red", "#CC0000")
  |> should.equal(types.PaletteEntry("Stub Red", "#CC0000"))
  types.PaletteEntry("Stub Red", "#CC0000")
  |> should.not_equal(types.PaletteEntry("Stub Blue", "#0000CC"))
}

pub fn thumbnail_equality_test() {
  types.Thumbnail("stub-thumbnail:4-x", 1000)
  |> should.equal(types.Thumbnail("stub-thumbnail:4-x", 1000))
  types.Thumbnail("stub-thumbnail:4-x", 1000)
  |> should.not_equal(types.Thumbnail("stub-thumbnail:4-x", 2000))
}

pub fn stub_grid_equality_test() {
  let palette = stub.default_stub_palette()
  let cells = types.empty_grid(2, 2)
  stub.StubGrid(2, 2, cells, palette)
  |> should.equal(stub.StubGrid(
    2,
    2,
    types.empty_grid(2, 2),
    stub.default_stub_palette(),
  ))
  stub.StubGrid(2, 2, cells, palette)
  |> should.not_equal(stub.StubGrid(3, 2, types.empty_grid(3, 2), palette))
}

// -- entity fields -----------------------------------------------------------

pub fn user_fields_and_anonymity_test() {
  let anonymous = types.User(id: "device-1", has_account: False)
  anonymous.id |> should.equal("device-1")
  types.is_anonymous(anonymous) |> should.be_true

  let signed_in_elsewhere = types.User(id: "account-9", has_account: True)
  types.is_anonymous(signed_in_elsewhere) |> should.be_false
}

// -- derived: thumbnail ------------------------------------------------------

pub fn thumbnail_rendering_is_deterministic_test() {
  let doc =
    types.PatternDocument(
      id: "doc-1",
      name: "Rose",
      width: 2,
      height: 2,
      cells: types.empty_grid(2, 2),
      palette: stub.default_stub_palette(),
      created_at: 1000,
      last_edited: 1000,
    )
  let first = stub.render_thumbnail(doc, 5000)
  let second = stub.render_thumbnail(doc, 5000)
  first |> should.equal(second)
  first.generated_at |> should.equal(5000)
}

// -- grid helpers ------------------------------------------------------------

pub fn empty_grid_shape_test() {
  let grid = types.empty_grid(3, 2)
  grid
  |> should.equal([
    types.CellState(types.CellPosition(0, 0), option.None),
    types.CellState(types.CellPosition(1, 0), option.None),
    types.CellState(types.CellPosition(2, 0), option.None),
    types.CellState(types.CellPosition(0, 1), option.None),
    types.CellState(types.CellPosition(1, 1), option.None),
    types.CellState(types.CellPosition(2, 1), option.None),
  ])
}

pub fn apply_edit_sets_cells_test() {
  let edit =
    types.DocumentEdit([
      types.CellChange(types.CellPosition(1, 0), option.None, option.Some(2)),
      types.CellChange(types.CellPosition(0, 1), option.None, option.Some(3)),
    ])
  let updated = types.apply_edit(types.empty_grid(3, 2), edit)
  types.cell_at(updated, types.CellPosition(1, 0))
  |> should.equal(option.Some(2))
  types.cell_at(updated, types.CellPosition(0, 1))
  |> should.equal(option.Some(3))
  types.cell_at(updated, types.CellPosition(0, 0))
  |> should.equal(option.None)
}
