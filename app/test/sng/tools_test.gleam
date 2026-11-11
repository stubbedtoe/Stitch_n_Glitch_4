//// Generated from specs/m2-chart-core.allium — slice m2-editor-tools:
//// F-008 editor toolset rules (eraser, flood fill, line, rectangle, ellipse,
//// selection + move, color picker, tool selection / EditorToolState), the
//// EditorTools surface guards, and invariant ToolStateUniquePerDocument.
////
//// RED baseline: the M2 implementation (src/sng/tools.gleam) does not exist
//// yet — the whole suite fails to compile on the missing module. That is the
//// intended tick-1 red state; see test/red-baseline-m2-editor-tools.txt.
////
//// Slice scoping: DocumentViewInitialised also creates ChartView,
//// SymbolAssignment and PipelineOpStack — those ensures clauses belong to
//// later slices and are asserted there, not here. Likewise the EditorTools
//// exposes chart_view.color_usage / assignment.mapping (later slices) and
//// its op-stack provides (pipeline slice); DrawStitches' palette guard is
//// already covered by M1's stitches_drawn_empty_palette_fails_test.
////
//// Rasterization note: the spec pins the region/selection semantics but not
//// the line/rect/ellipse rasterizers. Expected cell sets below are the test
//// author's chosen observable behaviour: Bresenham line, bounding-rectangle
//// outline, midpoint-ellipse outline (degenerate shapes = single cell).

import gleam/list
import gleam/option
import gleeunit/should
import sng/store as st
import sng/tools as tools
import sng/types

fn pos(x: Int, y: Int) -> types.CellPosition {
  types.CellPosition(x, y)
}

fn change(x: Int, y: Int, after: Int) -> types.CellChange {
  types.CellChange(pos(x, y), option.None, option.Some(after))
}

fn edit(changes: List(types.CellChange)) -> types.DocumentEdit {
  types.DocumentEdit(changes)
}

/// Blank 8x6 document with its M2 editor state initialised
/// (rule DocumentViewInitialised, EditorToolState half).
fn blank(s: st.Store) -> #(st.Store, types.PatternDocument) {
  let assert Ok(#(s, doc)) = st.create_blank(s, 8, 6, 1000)
  let assert Ok(s) = tools.initialise_document(s, doc.id, 1000)
  #(s, doc)
}

fn cell(s: st.Store, doc_id: String, x: Int, y: Int) -> option.Option(Int) {
  let assert Ok(doc) = st.document(s, doc_id)
  types.cell_at(doc.cells, pos(x, y))
}

/// One committed gesture = one log entry: the store must hold exactly `seq`
/// commands, the newest a Draw with sequence `seq` committed at `now`.
fn last_gesture_committed(s: st.Store, doc_id: String, seq: Int, now: Int) -> Nil {
  let commands = st.commands_of(s, doc_id)
  list.length(commands) |> should.equal(seq)
  let assert Ok(command) = list.last(commands)
  command.verb |> should.equal(types.Draw)
  command.sequence |> should.equal(seq)
  command.committed_at |> should.equal(now)
}

// -- value-equality / entity-fields: CellRect --------------------------------

pub fn cell_rect_equality_test() {
  tools.CellRect(x: 1, y: 2, width: 3, height: 4)
  |> should.equal(tools.CellRect(x: 1, y: 2, width: 3, height: 4))
  tools.CellRect(x: 1, y: 2, width: 3, height: 4)
  |> should.not_equal(tools.CellRect(x: 2, y: 1, width: 3, height: 4))
  tools.CellRect(x: 1, y: 2, width: 3, height: 4)
  |> should.not_equal(tools.CellRect(x: 1, y: 2, width: 4, height: 3))
}

// -- enum-comparable: EditorTool ----------------------------------------------

pub fn editor_tool_comparable_test() {
  tools.Pencil |> should.equal(tools.Pencil)
  tools.Pencil |> should.not_equal(tools.Eraser)
  tools.FloodFill |> should.not_equal(tools.Line)
  tools.Rectangle |> should.not_equal(tools.Ellipse)
  tools.Select |> should.not_equal(tools.ColorPicker)
}

// -- rule DocumentViewInitialised (EditorToolState ensures clause) --------------

pub fn document_view_initialised_tool_state_test() {
  let assert Ok(#(s, doc)) = st.create_blank(st.new(), 8, 6, 1000)
  let assert Ok(s) = tools.initialise_document(s, doc.id, 1000)
  let assert Ok(state) = tools.tool_state_of(s, doc.id)
  state.document_id |> should.equal(doc.id)
  state.active_tool |> should.equal(tools.Pencil)
  state.active_color_index |> should.equal(option.None)
  state.selection |> should.equal(option.None)
}

// -- invariant ToolStateUniquePerDocument --------------------------------------

pub fn tool_state_unique_per_document_test() {
  // Re-initialising an existing document must not create a second state or
  // reset the existing one.
  let #(s, doc) = blank(st.new())
  let assert Ok(s) = tools.select_tool(s, doc.id, tools.Eraser)
  let assert Ok(s) = tools.initialise_document(s, doc.id, 2000)
  let assert Ok(state) = tools.tool_state_of(s, doc.id)
  state.active_tool |> should.equal(tools.Eraser)
}

// -- rule ToolSelected ----------------------------------------------------------

pub fn tool_selected_test() {
  let #(s, doc) = blank(st.new())
  let assert Ok(state) = tools.tool_state_of(s, doc.id)
  state.active_tool |> should.equal(tools.Pencil)

  let assert Ok(s) = tools.select_tool(s, doc.id, tools.Eraser)
  let assert Ok(state) = tools.tool_state_of(s, doc.id)
  state.active_tool |> should.equal(tools.Eraser)

  let assert Ok(s) = tools.select_tool(s, doc.id, tools.Select)
  let assert Ok(state) = tools.tool_state_of(s, doc.id)
  state.active_tool |> should.equal(tools.Select)
}

// -- rule ColorPicked -----------------------------------------------------------

pub fn color_picked_test() {
  let #(s0, doc) = blank(st.new())
  let assert Ok(s1) = st.draw(s0, doc.id, edit([change(1, 1, 2)]), 2000)
  let before = st.commands_of(s1, doc.id)

  let assert Ok(s2) = tools.pick_color(s1, doc.id, pos(1, 1))
  let assert Ok(state) = tools.tool_state_of(s2, doc.id)
  state.active_color_index |> should.equal(option.Some(2))

  // The picker commits no document edit: the command log and last_edited
  // are untouched.
  st.commands_of(s2, doc.id) |> should.equal(before)
  let assert Ok(updated) = st.document(s2, doc.id)
  updated.last_edited |> should.equal(2000)
}

pub fn color_picked_out_of_bounds_fails_test() {
  let #(s, doc) = blank(st.new())
  tools.pick_color(s, doc.id, pos(8, 0))
  |> should.equal(Error(tools.OutOfBounds))
  tools.pick_color(s, doc.id, pos(-1, 0))
  |> should.equal(Error(tools.OutOfBounds))
}

pub fn color_picked_empty_cell_fails_test() {
  // requires: cell.color_index != null
  let #(s, doc) = blank(st.new())
  tools.pick_color(s, doc.id, pos(0, 0))
  |> should.equal(Error(tools.CellEmpty))
}

// -- rule EraserUsed ------------------------------------------------------------

pub fn eraser_used_test() {
  let #(s0, doc) = blank(st.new())
  let assert Ok(s1) =
    st.draw(
      s0,
      doc.id,
      edit([change(0, 0, 1), change(1, 0, 2), change(2, 0, 3)]),
      2000,
    )

  // One committed gesture = one log entry (AC-F045-05): the whole erase
  // stroke commits as a single command.
  let assert Ok(s2) =
    tools.erase_cells(
      s1,
      doc.id,
      [pos(0, 0), pos(1, 0), pos(2, 0)],
      3000,
    )
  cell(s2, doc.id, 0, 0) |> should.equal(option.None)
  cell(s2, doc.id, 1, 0) |> should.equal(option.None)
  cell(s2, doc.id, 2, 0) |> should.equal(option.None)
  let assert Ok(updated) = st.document(s2, doc.id)
  updated.last_edited |> should.equal(3000)

  last_gesture_committed(s2, doc.id, 2, 3000)
  let assert Ok(command) = list.last(st.commands_of(s2, doc.id))
  // Erased cells get after = null (rule guidance).
  list.map(command.edit.changes, fn(c) { c.after })
  |> should.equal([option.None, option.None, option.None])

  // The committed inverse restores the drawn colours on undo.
  let assert Ok(s3) = st.undo(s2, doc.id, 4000)
  cell(s3, doc.id, 0, 0) |> should.equal(option.Some(1))
  cell(s3, doc.id, 1, 0) |> should.equal(option.Some(2))
  cell(s3, doc.id, 2, 0) |> should.equal(option.Some(3))
}

pub fn eraser_used_out_of_bounds_fails_test() {
  let #(s0, doc) = blank(st.new())
  let assert Ok(s1) = st.draw(s0, doc.id, edit([change(0, 0, 1)]), 2000)
  // Fully outside, and one bad cell in a stroke fails the whole gesture
  // atomically (requires: positions.all within_grid).
  tools.erase_cells(s1, doc.id, [pos(8, 0)], 3000)
  |> should.equal(Error(tools.OutOfBounds))
  tools.erase_cells(s1, doc.id, [pos(0, 0), pos(9, 9)], 3000)
  |> should.equal(Error(tools.OutOfBounds))
  let assert Ok(unchanged) = st.document(s1, doc.id)
  cell(s1, unchanged.id, 0, 0) |> should.equal(option.Some(1))
  st.commands_of(s1, doc.id) |> list.length |> should.equal(1)
}

// -- rule RegionFlooded ---------------------------------------------------------

pub fn region_flooded_test() {
  let #(s0, doc) = blank(st.new())
  let assert Ok(s1) =
    st.draw(
      s0,
      doc.id,
      edit([change(0, 0, 1), change(1, 0, 1), change(2, 0, 1), change(3, 0, 3), change(0, 1, 3)]),
      2000,
    )

  // The contiguous same-color region at the origin is recolored; cells
  // outside the region are untouched. One fill = one log entry.
  let assert Ok(s2) = tools.flood_fill(s1, doc.id, pos(1, 0), 2, 3000)
  cell(s2, doc.id, 0, 0) |> should.equal(option.Some(2))
  cell(s2, doc.id, 1, 0) |> should.equal(option.Some(2))
  cell(s2, doc.id, 2, 0) |> should.equal(option.Some(2))
  cell(s2, doc.id, 3, 0) |> should.equal(option.Some(3))
  cell(s2, doc.id, 0, 1) |> should.equal(option.Some(3))
  last_gesture_committed(s2, doc.id, 2, 3000)

  // Undo restores the region.
  let assert Ok(s3) = st.undo(s2, doc.id, 4000)
  cell(s3, doc.id, 0, 0) |> should.equal(option.Some(1))
  cell(s3, doc.id, 2, 0) |> should.equal(option.Some(1))
}

pub fn region_flooded_same_color_is_single_entry_test() {
  // Filling with the region's own colour changes nothing on the grid but
  // still commits exactly one log entry (the rule fires unconditionally).
  let #(s0, doc) = blank(st.new())
  let assert Ok(s1) = st.draw(s0, doc.id, edit([change(0, 0, 1), change(1, 0, 1)]), 2000)
  let assert Ok(s2) = tools.flood_fill(s1, doc.id, pos(0, 0), 1, 3000)
  cell(s2, doc.id, 0, 0) |> should.equal(option.Some(1))
  cell(s2, doc.id, 1, 0) |> should.equal(option.Some(1))
  last_gesture_committed(s2, doc.id, 2, 3000)
}

pub fn region_flooded_out_of_bounds_fails_test() {
  let #(s, doc) = blank(st.new())
  tools.flood_fill(s, doc.id, pos(8, 0), 1, 3000)
  |> should.equal(Error(tools.OutOfBounds))
}

pub fn region_flooded_invalid_color_fails_test() {
  let #(s, doc) = blank(st.new())
  let assert Ok(doc_now) = st.document(s, doc.id)
  let palette_count = list.length(doc_now.palette)
  tools.flood_fill(s, doc.id, pos(0, 0), palette_count, 3000)
  |> should.equal(Error(tools.InvalidColorIndex))
  tools.flood_fill(s, doc.id, pos(0, 0), -1, 3000)
  |> should.equal(Error(tools.InvalidColorIndex))
}

// -- rule LineDrawn ---------------------------------------------------------------

pub fn line_drawn_test() {
  let #(s0, doc) = blank(st.new())
  let assert Ok(s1) = tools.draw_line(s0, doc.id, pos(0, 0), pos(3, 2), 1, 2000)

  // Bresenham line (0,0)-(3,2).
  cell(s1, doc.id, 0, 0) |> should.equal(option.Some(1))
  cell(s1, doc.id, 1, 1) |> should.equal(option.Some(1))
  cell(s1, doc.id, 2, 1) |> should.equal(option.Some(1))
  cell(s1, doc.id, 3, 2) |> should.equal(option.Some(1))
  // Off-line neighbours are untouched.
  cell(s1, doc.id, 1, 0) |> should.equal(option.None)
  cell(s1, doc.id, 2, 2) |> should.equal(option.None)
  last_gesture_committed(s1, doc.id, 1, 2000)

  let assert Ok(s2) = st.undo(s1, doc.id, 3000)
  cell(s2, doc.id, 0, 0) |> should.equal(option.None)
  cell(s2, doc.id, 3, 2) |> should.equal(option.None)
}

pub fn line_drawn_reversed_endpoints_match_test() {
  // The cell set is independent of drag direction.
  let #(s0, doc) = blank(st.new())
  let assert Ok(forward) = tools.draw_line(s0, doc.id, pos(0, 0), pos(3, 2), 1, 2000)
  let assert Ok(backward) = tools.draw_line(s0, doc.id, pos(3, 2), pos(0, 0), 1, 2000)
  let assert Ok(fdoc) = st.document(forward, doc.id)
  let assert Ok(bdoc) = st.document(backward, doc.id)
  fdoc.cells |> should.equal(bdoc.cells)
}

pub fn line_drawn_degenerate_single_cell_test() {
  let #(s0, doc) = blank(st.new())
  let assert Ok(s1) = tools.draw_line(s0, doc.id, pos(1, 1), pos(1, 1), 2, 2000)
  cell(s1, doc.id, 1, 1) |> should.equal(option.Some(2))
  cell(s1, doc.id, 0, 0) |> should.equal(option.None)
  last_gesture_committed(s1, doc.id, 1, 2000)
}

pub fn line_drawn_out_of_bounds_fails_test() {
  let #(s, doc) = blank(st.new())
  tools.draw_line(s, doc.id, pos(0, 0), pos(8, 0), 1, 2000)
  |> should.equal(Error(tools.OutOfBounds))
  tools.draw_line(s, doc.id, pos(-1, 0), pos(2, 2), 1, 2000)
  |> should.equal(Error(tools.OutOfBounds))
}

pub fn line_drawn_invalid_color_fails_test() {
  let #(s, doc) = blank(st.new())
  let assert Ok(doc_now) = st.document(s, doc.id)
  let palette_count = list.length(doc_now.palette)
  tools.draw_line(s, doc.id, pos(0, 0), pos(3, 2), palette_count, 2000)
  |> should.equal(Error(tools.InvalidColorIndex))
  tools.draw_line(s, doc.id, pos(0, 0), pos(3, 2), -1, 2000)
  |> should.equal(Error(tools.InvalidColorIndex))
}

// -- rule RectangleDrawn -----------------------------------------------------------

pub fn rectangle_drawn_test() {
  let #(s0, doc) = blank(st.new())
  let assert Ok(s1) = tools.draw_rectangle(s0, doc.id, pos(0, 0), pos(3, 2), 1, 2000)

  // Outline stroke of the bounding rectangle (12 cells); interior untouched.
  cell(s1, doc.id, 0, 0) |> should.equal(option.Some(1))
  cell(s1, doc.id, 3, 0) |> should.equal(option.Some(1))
  cell(s1, doc.id, 0, 2) |> should.equal(option.Some(1))
  cell(s1, doc.id, 3, 2) |> should.equal(option.Some(1))
  cell(s1, doc.id, 1, 0) |> should.equal(option.Some(1))
  cell(s1, doc.id, 0, 1) |> should.equal(option.Some(1))
  cell(s1, doc.id, 3, 1) |> should.equal(option.Some(1))
  cell(s1, doc.id, 1, 2) |> should.equal(option.Some(1))
  cell(s1, doc.id, 1, 1) |> should.equal(option.None)
  cell(s1, doc.id, 2, 1) |> should.equal(option.None)
  last_gesture_committed(s1, doc.id, 1, 2000)

  let assert Ok(s2) = st.undo(s1, doc.id, 3000)
  cell(s2, doc.id, 0, 0) |> should.equal(option.None)
  cell(s2, doc.id, 3, 2) |> should.equal(option.None)
}

pub fn rectangle_drawn_reversed_corners_match_test() {
  let #(s0, doc) = blank(st.new())
  let assert Ok(a) = tools.draw_rectangle(s0, doc.id, pos(0, 0), pos(3, 2), 1, 2000)
  let assert Ok(b) = tools.draw_rectangle(s0, doc.id, pos(3, 2), pos(0, 0), 1, 2000)
  let assert Ok(adoc) = st.document(a, doc.id)
  let assert Ok(bdoc) = st.document(b, doc.id)
  adoc.cells |> should.equal(bdoc.cells)
}

pub fn rectangle_drawn_degenerate_single_cell_test() {
  let #(s0, doc) = blank(st.new())
  let assert Ok(s1) = tools.draw_rectangle(s0, doc.id, pos(2, 2), pos(2, 2), 2, 2000)
  cell(s1, doc.id, 2, 2) |> should.equal(option.Some(2))
  cell(s1, doc.id, 2, 1) |> should.equal(option.None)
  last_gesture_committed(s1, doc.id, 1, 2000)
}

pub fn rectangle_drawn_out_of_bounds_fails_test() {
  let #(s, doc) = blank(st.new())
  tools.draw_rectangle(s, doc.id, pos(0, 0), pos(8, 2), 1, 2000)
  |> should.equal(Error(tools.OutOfBounds))
  tools.draw_rectangle(s, doc.id, pos(0, -1), pos(2, 2), 1, 2000)
  |> should.equal(Error(tools.OutOfBounds))
}

pub fn rectangle_drawn_invalid_color_fails_test() {
  let #(s, doc) = blank(st.new())
  let assert Ok(doc_now) = st.document(s, doc.id)
  let palette_count = list.length(doc_now.palette)
  tools.draw_rectangle(s, doc.id, pos(0, 0), pos(3, 2), palette_count, 2000)
  |> should.equal(Error(tools.InvalidColorIndex))
  tools.draw_rectangle(s, doc.id, pos(0, 0), pos(3, 2), -1, 2000)
  |> should.equal(Error(tools.InvalidColorIndex))
}

// -- rule EllipseDrawn ---------------------------------------------------------------

pub fn ellipse_drawn_test() {
  let #(s0, doc) = blank(st.new())
  // Bounding rect (0,0)-(4,2): midpoint-ellipse outline.
  let assert Ok(s1) = tools.draw_ellipse(s0, doc.id, pos(0, 0), pos(4, 2), 1, 2000)

  cell(s1, doc.id, 2, 0) |> should.equal(option.Some(1))
  cell(s1, doc.id, 1, 0) |> should.equal(option.Some(1))
  cell(s1, doc.id, 3, 0) |> should.equal(option.Some(1))
  cell(s1, doc.id, 0, 1) |> should.equal(option.Some(1))
  cell(s1, doc.id, 4, 1) |> should.equal(option.Some(1))
  cell(s1, doc.id, 1, 2) |> should.equal(option.Some(1))
  cell(s1, doc.id, 2, 2) |> should.equal(option.Some(1))
  cell(s1, doc.id, 3, 2) |> should.equal(option.Some(1))
  // Interior and exterior untouched.
  cell(s1, doc.id, 2, 1) |> should.equal(option.None)
  cell(s1, doc.id, 5, 1) |> should.equal(option.None)
  last_gesture_committed(s1, doc.id, 1, 2000)

  let assert Ok(s2) = st.undo(s1, doc.id, 3000)
  cell(s2, doc.id, 2, 0) |> should.equal(option.None)
  cell(s2, doc.id, 0, 1) |> should.equal(option.None)
}

pub fn ellipse_drawn_reversed_corners_match_test() {
  let #(s0, doc) = blank(st.new())
  let assert Ok(a) = tools.draw_ellipse(s0, doc.id, pos(0, 0), pos(4, 2), 1, 2000)
  let assert Ok(b) = tools.draw_ellipse(s0, doc.id, pos(4, 2), pos(0, 0), 1, 2000)
  let assert Ok(adoc) = st.document(a, doc.id)
  let assert Ok(bdoc) = st.document(b, doc.id)
  adoc.cells |> should.equal(bdoc.cells)
}

pub fn ellipse_drawn_degenerate_single_cell_test() {
  let #(s0, doc) = blank(st.new())
  let assert Ok(s1) = tools.draw_ellipse(s0, doc.id, pos(2, 2), pos(2, 2), 2, 2000)
  cell(s1, doc.id, 2, 2) |> should.equal(option.Some(2))
  cell(s1, doc.id, 1, 2) |> should.equal(option.None)
  last_gesture_committed(s1, doc.id, 1, 2000)
}

pub fn ellipse_drawn_out_of_bounds_fails_test() {
  let #(s, doc) = blank(st.new())
  tools.draw_ellipse(s, doc.id, pos(0, 0), pos(4, 6), 1, 2000)
  |> should.equal(Error(tools.OutOfBounds))
  tools.draw_ellipse(s, doc.id, pos(0, 0), pos(2, -1), 1, 2000)
  |> should.equal(Error(tools.OutOfBounds))
}

pub fn ellipse_drawn_invalid_color_fails_test() {
  let #(s, doc) = blank(st.new())
  let assert Ok(doc_now) = st.document(s, doc.id)
  let palette_count = list.length(doc_now.palette)
  tools.draw_ellipse(s, doc.id, pos(0, 0), pos(4, 2), palette_count, 2000)
  |> should.equal(Error(tools.InvalidColorIndex))
  tools.draw_ellipse(s, doc.id, pos(0, 0), pos(4, 2), -1, 2000)
  |> should.equal(Error(tools.InvalidColorIndex))
}

// -- rule SelectionMoved ---------------------------------------------------------------

pub fn selection_moved_test() {
  let #(s0, doc) = blank(st.new())
  let assert Ok(s1) =
    st.draw(
      s0,
      doc.id,
      edit([change(0, 0, 1), change(1, 0, 2), change(0, 1, 1), change(1, 1, 2)]),
      2000,
    )

  let from = tools.CellRect(x: 0, y: 0, width: 2, height: 2)
  let to = tools.CellRect(x: 2, y: 0, width: 2, height: 2)
  let assert Ok(s2) = tools.move_selection(s1, doc.id, from, to, 3000)

  // Source cells are emptied...
  cell(s2, doc.id, 0, 0) |> should.equal(option.None)
  cell(s2, doc.id, 1, 0) |> should.equal(option.None)
  cell(s2, doc.id, 0, 1) |> should.equal(option.None)
  cell(s2, doc.id, 1, 1) |> should.equal(option.None)
  // ...and re-committed at the destination with offsets preserved.
  cell(s2, doc.id, 2, 0) |> should.equal(option.Some(1))
  cell(s2, doc.id, 3, 0) |> should.equal(option.Some(2))
  cell(s2, doc.id, 2, 1) |> should.equal(option.Some(1))
  cell(s2, doc.id, 3, 1) |> should.equal(option.Some(2))
  // One drag = one log entry (AC-F045-05).
  last_gesture_committed(s2, doc.id, 2, 3000)
  // The selection box follows the move.
  let assert Ok(state) = tools.tool_state_of(s2, doc.id)
  state.selection |> should.equal(option.Some(to))

  // Undo lifts the block back.
  let assert Ok(s3) = st.undo(s2, doc.id, 4000)
  cell(s3, doc.id, 0, 0) |> should.equal(option.Some(1))
  cell(s3, doc.id, 2, 0) |> should.equal(option.None)
}

pub fn selection_moved_out_of_bounds_fails_test() {
  let #(s, doc) = blank(st.new())
  // from_rect exceeds the grid (x + width > document.width).
  tools.move_selection(
    s,
    doc.id,
    tools.CellRect(x: 7, y: 0, width: 2, height: 2),
    tools.CellRect(x: 0, y: 0, width: 2, height: 2),
    3000,
  )
  |> should.equal(Error(tools.OutOfBounds))
  tools.move_selection(
    s,
    doc.id,
    tools.CellRect(x: -1, y: 0, width: 2, height: 2),
    tools.CellRect(x: 0, y: 0, width: 2, height: 2),
    3000,
  )
  |> should.equal(Error(tools.OutOfBounds))
}

pub fn selection_moved_to_out_of_bounds_fails_test() {
  let #(s, doc) = blank(st.new())
  // to_rect exceeds the grid.
  tools.move_selection(
    s,
    doc.id,
    tools.CellRect(x: 0, y: 0, width: 2, height: 2),
    tools.CellRect(x: 0, y: 5, width: 2, height: 2),
    3000,
  )
  |> should.equal(Error(tools.OutOfBounds))
}

// -- @guarantee GestureGranularity (AC-F045-05) ------------------------------------------

pub fn one_gesture_one_log_entry_across_tools_test() {
  // Each tool commits exactly one command per committed gesture; sequence
  // numbers advance by one per gesture across all tools.
  let #(s0, doc) = blank(st.new())
  let assert Ok(s1) = tools.draw_line(s0, doc.id, pos(0, 0), pos(3, 0), 1, 1000)
  let assert Ok(s2) = tools.draw_rectangle(s1, doc.id, pos(0, 1), pos(3, 2), 2, 2000)
  let assert Ok(s3) = tools.erase_cells(s2, doc.id, [pos(0, 0)], 3000)
  let assert Ok(s4) = tools.flood_fill(s3, doc.id, pos(1, 1), 3, 4000)

  let commands = st.commands_of(s4, doc.id)
  list.length(commands) |> should.equal(4)
  list.map(commands, fn(c) { c.sequence }) |> should.equal([1, 2, 3, 4])
}

// -- surface exposures / actors -------------------------------------------------------------

pub fn editor_tools_surface_exposure_test() {
  // surface-exposure.EditorTools (this slice's half): document fields via
  // the M1 editor view plus the tool-state fields on the surface. The
  // chart_view.color_usage and assignment.mapping exposures belong to later
  // slices.
  let #(s0, doc) = blank(st.new())
  let assert Ok(s1) = tools.select_tool(s0, doc.id, tools.FloodFill)
  let assert Ok(view) = st.editor_view(s1, doc.id)
  view.document_id |> should.equal(doc.id)
  view.name |> should.equal("Untitled")
  view.width |> should.equal(8)
  view.height |> should.equal(6)
  let assert Ok(doc_now) = st.document(s1, doc.id)
  view.cells |> should.equal(doc_now.cells)
  view.palette |> should.equal(doc_now.palette)

  let assert Ok(state) = tools.tool_state_of(s1, doc.id)
  state.active_tool |> should.equal(tools.FloodFill)
  state.active_color_index |> should.equal(option.None)
}

pub fn editor_tools_anonymous_actor_test() {
  // surface-actor.EditorTools: every F-008 operation is callable with no
  // user, account, or session context (M1 anonymous mode, AC-F001-02).
  let #(s0, doc) = blank(st.new())
  let assert Ok(s1) = tools.select_tool(s0, doc.id, tools.Eraser)
  let assert Ok(s2) = tools.select_tool(s1, doc.id, tools.Pencil)
  let assert Ok(s3) =
    st.draw(s2, doc.id, edit([change(0, 0, 1), change(1, 1, 2)]), 2000)
  let assert Ok(s4) = tools.pick_color(s3, doc.id, pos(0, 0))
  let assert Ok(s5) = tools.erase_cells(s4, doc.id, [pos(0, 0)], 3000)
  let assert Ok(s6) = tools.flood_fill(s5, doc.id, pos(1, 1), 3, 4000)
  let assert Ok(s7) = tools.draw_line(s6, doc.id, pos(0, 0), pos(3, 3), 1, 5000)
  let assert Ok(s8) = tools.draw_rectangle(s7, doc.id, pos(0, 0), pos(2, 2), 2, 6000)
  let assert Ok(s9) = tools.draw_ellipse(s8, doc.id, pos(3, 0), pos(6, 2), 3, 7000)
  let assert Ok(_s10) =
    tools.move_selection(
      s9,
      doc.id,
      tools.CellRect(x: 0, y: 0, width: 2, height: 2),
      tools.CellRect(x: 4, y: 3, width: 2, height: 2),
      8000,
    )
}
