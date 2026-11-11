//// Generated from specs/m2-chart-core.allium — slice m2-chart-rendering
//// (domain half): entity ChartView with its three derived fields
//// (grid_visible, rendered_cell_size, color_usage), rules ChartStyleSelected /
//// ChartZoomed / ChartPanned, invariants ChartViewUniquePerDocument and
//// StyleMappingConsistency, the ChartViewControls surface, and the seven
//// chart config defaults (min_zoom_pct, max_zoom_pct,
//// grid_auto_hide_below_zoom_pct, min_cell_px_at_100pct, min_pan_zoom_fps,
//// p2_benchmark_chart_width, p2_benchmark_chart_height).
////
//// RED baseline: src/sng/chart.gleam does not exist yet — the whole suite
//// fails to compile on the unknown module. That is the intended red state;
//// see test/red-baseline-m2-chart-domain.txt.
////
//// Storage constraint (same convention as sng/tools, sng/pipeline and
//// sng/symbols): the M1 Store record shape is pinned by M1's generated
//// tests, so ChartView rides inside Store.sources as a marker SourceImage
//// whose content_hash carries its encoding. The implement phase must make
//// store.source_of skip the chart marker (as it already skips "toolstate",
//// "pipeline-state" and "symbol-assignment"), so "exists
//// SourceImage{document}" stays false for blank documents;
//// chart_marker_not_a_retained_source_test pins that.
////
//// Binding decisions encoded here:
////   - grid_center(document) = CellPosition(width / 2, height / 2) — integer
////     division, so the initial pan center is always a real cell.
////   - clamp_center(document, center) clamps to the canvas cell bounds:
////     x to [0, width - 1], y to [0, height - 1] (rule ChartPanned's
////     @guidance: panning can never leave the document bounds, AC-F009-02).
////   - rendered_cell_px(zoom_pct) = zoom_pct * min_cell_px_at_100pct / 100 —
////     the 16px-cell-at-100% binding (S5, PRD v1.15). All config values are
////     read from sng/config; no magic numbers.
////   - usage_counts(document) is indexed by palette color: a list of
////     palette.count entries, entry i = committed cells with color_index i;
////     empty cells contribute nothing (ChartView.color_usage, AC-F008-01's
////     immediate-update half is pinned by tools_test; here the derivation
////     from committed cells is pinned, including undo).
////   - ChartView.symbol_set follows the document's SymbolAssignment: the
////     view exposes the set the chart actually renders with (the renderer
////     consumes only `mapping`; the e2e suite pins the same consistency at
////     the canvas level via data-symbol-set).
////   - StyleMappingConsistency (AC-F009-04): style is a render mode over the
////     one SymbolAssignment — selecting any of the three styles must leave
////     the mapping byte-identical.

import gleam/int
import gleam/list
import gleam/option.{None, Some}
import gleeunit/should
import sng/chart
import sng/config
import sng/store as st
import sng/symbols
import sng/types.{type CellChange, CellChange, CellPosition, DocumentEdit}

/// Inclusive integer range [a, .., b]. Identical to the author's list.range.
fn range_inclusive(a: Int, b: Int) -> List(Int) {
  case a > b {
    True -> []
    False -> [a, ..range_inclusive(a + 1, b)]
  }
}

/// Blank 8x6 document with its chart view initialised (rule
/// DocumentViewInitialised, ChartView ensures clause).
fn blank(s: st.Store) -> #(st.Store, types.PatternDocument) {
  let assert Ok(#(s, doc)) = st.create_blank(s, 8, 6, 1000)
  let assert Ok(s) = chart.initialise_chart_view(s, doc.id, 1000)
  #(s, doc)
}

/// Blank 8x6 document with chart view AND symbol assignment initialised
/// (whole of rule DocumentViewInitialised), for mapping-consistency tests.
fn fully_initialised(s: st.Store) -> #(st.Store, types.PatternDocument) {
  let #(s, doc) = blank(s)
  let assert Ok(s) = symbols.initialise_assignment(s, doc.id, 1000)
  #(s, doc)
}

fn view(s: st.Store, doc_id: String) -> chart.ChartView {
  let assert Ok(v) = chart.chart_view_of(s, doc_id)
  v
}

/// Commit one edit through M1's store.draw (the only way cells become
/// committed). `before` values are recomputed by the store, so None is fine.
fn paint(s: st.Store, doc_id: String, changes: List(CellChange), now: Int) -> st.Store {
  let assert Ok(s) = st.draw(s, doc_id, DocumentEdit(changes), now)
  s
}

// -- enum: ChartStyle ---------------------------------------------------------------

pub fn chart_style_variants_test() {
  // enum comparability across the three named styles (spec enum ChartStyle).
  chart.SymbolsOnColoredBackground
  |> should.not_equal(chart.ColoredSymbolsOnly)
  chart.SymbolsOnColoredBackground
  |> should.not_equal(chart.BlackAndWhiteSymbolsOnly)
  chart.ColoredSymbolsOnly
  |> should.not_equal(chart.BlackAndWhiteSymbolsOnly)
  chart.ColoredSymbolsOnly |> should.equal(chart.ColoredSymbolsOnly)
}

// -- config defaults (spec config block: no magic numbers in tests) --------------------

pub fn chart_config_defaults_test() {
  // Every chart config parameter carries the spec's value (config block of
  // specs/m2-chart-core.allium).
  config.min_zoom_pct |> should.equal(10)
  config.max_zoom_pct |> should.equal(4000)
  config.grid_auto_hide_below_zoom_pct |> should.equal(25)
  config.min_cell_px_at_100pct |> should.equal(16)
  config.min_pan_zoom_fps |> should.equal(55)
  config.p2_benchmark_chart_width |> should.equal(1000)
  config.p2_benchmark_chart_height |> should.equal(1000)
}

// -- entity fields: ChartView ----------------------------------------------------------

pub fn chart_view_fields_test() {
  // entity-fields.ChartView: document, style, symbol_set, zoom_pct, center —
  // every stored field populated by DocumentViewInitialised.
  let #(s, doc) = blank(st.new())
  let v = view(s, doc.id)
  v.document_id |> should.equal(doc.id)
  v.style |> should.equal(chart.SymbolsOnColoredBackground)
  v.symbol_set |> should.equal(symbols.primary_symbol_set())
  v.zoom_pct |> should.equal(100)
  v.center |> should.equal(types.CellPosition(4, 3))
}

// -- rule DocumentViewInitialised (ChartView ensures clause) ----------------------------

pub fn document_view_initialised_chart_view_test() {
  // Every document gets its chart view at creation: default style
  // (symbols_on_colored_background), the primary symbol set, zoom 100, the
  // grid center, grid_visible = true, rendered_cell_size =
  // rendered_cell_px(100), color_usage = usage_counts(doc).
  let assert Ok(#(s, doc)) = st.create_blank(st.new(), 8, 6, 1000)
  let assert Ok(s) = chart.initialise_chart_view(s, doc.id, 1000)
  let v = view(s, doc.id)
  v.style |> should.equal(chart.SymbolsOnColoredBackground)
  v.symbol_set |> should.equal(symbols.primary_symbol_set())
  v.zoom_pct |> should.equal(100)
  v.center |> should.equal(chart.grid_center(doc))
  chart.grid_visible(v) |> should.be_true
  chart.rendered_cell_px(v.zoom_pct)
  |> should.equal(chart.rendered_cell_px(100))
  chart.usage_counts(doc) |> should.equal(range_inclusive(1, 4) |> list.map(fn(_) { 0 }))
}

pub fn initialise_chart_view_unknown_document_test() {
  chart.initialise_chart_view(st.new(), "doc-1", 1000)
  |> should.equal(Error(chart.DocumentNotFound))
}

// -- derived: grid_center / clamp_center (binding decisions) ----------------------------

pub fn grid_center_test() {
  // Binding: grid_center(document) = CellPosition(width / 2, height / 2),
  // integer division — a real cell for even and odd dimensions.
  let assert Ok(#(_s, even)) = st.create_blank(st.new(), 8, 6, 1000)
  chart.grid_center(even) |> should.equal(types.CellPosition(4, 3))
  let assert Ok(#(_s, odd)) = st.create_blank(st.new(), 7, 5, 1000)
  chart.grid_center(odd) |> should.equal(types.CellPosition(3, 2))
}

pub fn clamp_center_bounds_test() {
  // Binding: clamp_center keeps the viewport on the canvas — x in
  // [0, width - 1], y in [0, height - 1] — pure, no store needed.
  let assert Ok(#(_s, doc)) = st.create_blank(st.new(), 8, 6, 1000)
  chart.clamp_center(doc, types.CellPosition(-3, -1))
  |> should.equal(types.CellPosition(0, 0))
  chart.clamp_center(doc, types.CellPosition(99, 99))
  |> should.equal(types.CellPosition(7, 5))
  chart.clamp_center(doc, types.CellPosition(2, 3))
  |> should.equal(types.CellPosition(2, 3))
}

// -- derived: rendered_cell_size --------------------------------------------------------

pub fn rendered_cell_px_binding_test() {
  // ChartView.rendered_cell_size = rendered_cell_px(zoom_pct), pinned to
  // the config binding: zoom_pct * min_cell_px_at_100pct / 100. At 100% the
  // rendered cell is exactly config.min_cell_px_at_100pct device px (16 px
  // per S5, PRD v1.15).
  chart.rendered_cell_px(100)
  |> should.equal(int.to_float(config.min_cell_px_at_100pct))
  list.each([10, 25, 50, 200, 1000, 4000], fn(zoom) {
    chart.rendered_cell_px(zoom)
    |> should.equal(
      int.to_float(zoom) *. int.to_float(config.min_cell_px_at_100pct) /. 100.0,
    )
  })
}

// -- derived: grid_visible ----------------------------------------------------------------

pub fn grid_visible_boundary_test() {
  // ChartView.grid_visible = zoom_pct >= config.grid_auto_hide_below_zoom_pct
  // (25): visible at and above the threshold, hidden below (AC-F009-02).
  // Exercised through rule ChartZoomed so the derived field is read off
  // resulting state.
  let #(s, doc) = blank(st.new())
  let assert Ok(s) = chart.zoom_chart(s, doc.id, 25)
  view(s, doc.id).zoom_pct |> should.equal(25)
  view(s, doc.id) |> chart.grid_visible |> should.be_true

  let assert Ok(s) = chart.zoom_chart(s, doc.id, 24)
  view(s, doc.id).zoom_pct |> should.equal(24)
  view(s, doc.id) |> chart.grid_visible |> should.be_false

  // At the minimum zoom the grid is hidden too.
  let assert Ok(s) = chart.zoom_chart(s, doc.id, config.min_zoom_pct)
  view(s, doc.id) |> chart.grid_visible |> should.be_false
}

pub fn initial_grid_visible_test() {
  // DocumentViewInitialised pins grid_visible = true at the initial zoom.
  let #(s, doc) = blank(st.new())
  view(s, doc.id) |> chart.grid_visible |> should.be_true
}

// -- rule ChartZoomed -----------------------------------------------------------------------

pub fn chart_zoomed_clamps_to_minimum_test() {
  // rule-success.ChartZoomed: below config.min_zoom_pct the zoom clamps to
  // the minimum (10 %).
  let #(s, doc) = blank(st.new())
  let assert Ok(s) = chart.zoom_chart(s, doc.id, 5)
  view(s, doc.id).zoom_pct |> should.equal(config.min_zoom_pct)
}

pub fn chart_zoomed_clamps_to_maximum_test() {
  // rule-success.ChartZoomed: above config.max_zoom_pct the zoom clamps to
  // the maximum (4000 %).
  let #(s, doc) = blank(st.new())
  let assert Ok(s) = chart.zoom_chart(s, doc.id, 5000)
  view(s, doc.id).zoom_pct |> should.equal(config.max_zoom_pct)
}

pub fn chart_zoomed_within_bounds_unchanged_test() {
  // rule-success.ChartZoomed: inside the bounds the requested zoom is kept,
  // boundaries included (clamp is inclusive).
  let #(s, doc) = blank(st.new())
  let assert Ok(s) = chart.zoom_chart(s, doc.id, 250)
  view(s, doc.id).zoom_pct |> should.equal(250)
  let assert Ok(s) = chart.zoom_chart(s, doc.id, config.min_zoom_pct)
  view(s, doc.id).zoom_pct |> should.equal(config.min_zoom_pct)
  let assert Ok(s) = chart.zoom_chart(s, doc.id, config.max_zoom_pct)
  view(s, doc.id).zoom_pct |> should.equal(config.max_zoom_pct)
}

// -- rule ChartPanned -------------------------------------------------------------------------

pub fn chart_panned_within_bounds_test() {
  // rule-success.ChartPanned: an in-bounds center is kept.
  let #(s, doc) = blank(st.new())
  let assert Ok(s) = chart.pan_chart(s, doc.id, types.CellPosition(2, 3))
  view(s, doc.id).center |> should.equal(types.CellPosition(2, 3))
}

pub fn chart_panned_clamped_low_test() {
  // rule ChartPanned: clamp_center keeps the viewport on the canvas — a
  // below-origin center clamps to the origin corner.
  let #(s, doc) = blank(st.new())
  let assert Ok(s) = chart.pan_chart(s, doc.id, types.CellPosition(-3, -1))
  view(s, doc.id).center |> should.equal(types.CellPosition(0, 0))
}

pub fn chart_panned_clamped_high_test() {
  // ...and a far-beyond center clamps to the opposite corner (width - 1,
  // height - 1) — panning can never leave the document bounds (AC-F009-02).
  let #(s, doc) = blank(st.new())
  let assert Ok(s) = chart.pan_chart(s, doc.id, types.CellPosition(99, 99))
  view(s, doc.id).center |> should.equal(types.CellPosition(7, 5))
}

// -- rule ChartStyleSelected -------------------------------------------------------------------

pub fn chart_style_selected_test() {
  // rule-success.ChartStyleSelected: each of the three styles is recorded on
  // the document's persisted view state; zoom and center are untouched.
  let #(s, doc) = blank(st.new())
  let assert Ok(s) = chart.zoom_chart(s, doc.id, 200)
  let assert Ok(s) = chart.select_chart_style(s, doc.id, chart.ColoredSymbolsOnly)
  let v = view(s, doc.id)
  v.style |> should.equal(chart.ColoredSymbolsOnly)
  v.zoom_pct |> should.equal(200)
  v.center |> should.equal(chart.grid_center(st.document(s, doc.id) |> result_value))

  let assert Ok(s) =
    chart.select_chart_style(s, doc.id, chart.BlackAndWhiteSymbolsOnly)
  view(s, doc.id).style |> should.equal(chart.BlackAndWhiteSymbolsOnly)

  let assert Ok(s) =
    chart.select_chart_style(s, doc.id, chart.SymbolsOnColoredBackground)
  view(s, doc.id).style |> should.equal(chart.SymbolsOnColoredBackground)
}

fn result_value(r: Result(a, b)) -> a {
  let assert Ok(v) = r
  v
}

// -- invariant ChartViewUniquePerDocument --------------------------------------------------------

pub fn chart_view_unique_per_document_test() {
  // Re-initialising must not create a second chart view or reset the
  // existing one; a second document's view is independent.
  let #(s, doc) = blank(st.new())
  let assert Ok(s) = chart.select_chart_style(s, doc.id, chart.ColoredSymbolsOnly)
  let assert Ok(s) = chart.initialise_chart_view(s, doc.id, 3000)
  let v = view(s, doc.id)
  v.style |> should.equal(chart.ColoredSymbolsOnly)
  v.zoom_pct |> should.equal(100)

  let #(s, doc2) = blank(s)
  view(s, doc2.id).style |> should.equal(chart.SymbolsOnColoredBackground)
  view(s, doc2.id).center |> should.equal(types.CellPosition(4, 3))
}

// -- invariant StyleMappingConsistency -------------------------------------------------------------

pub fn style_mapping_consistency_test() {
  // AC-F009-04 (domain half): all three chart styles render the same
  // document mapping — selecting any style leaves the SymbolAssignment
  // byte-identical and never re-assigns symbols.
  let #(s, doc) = fully_initialised(st.new())
  let mapping = symbols.assignment_of(s, doc.id) |> result_value |> fn(a) { a.mapping }
  let assert Ok(s) = chart.select_chart_style(s, doc.id, chart.ColoredSymbolsOnly)
  symbols.assignment_of(s, doc.id) |> result_value |> fn(a) { a.mapping }
  |> should.equal(mapping)
  let assert Ok(s) =
    chart.select_chart_style(s, doc.id, chart.BlackAndWhiteSymbolsOnly)
  symbols.assignment_of(s, doc.id) |> result_value |> fn(a) { a.mapping }
  |> should.equal(mapping)
  let assert Ok(s) =
    chart.select_chart_style(s, doc.id, chart.SymbolsOnColoredBackground)
  symbols.assignment_of(s, doc.id) |> result_value |> fn(a) { a.mapping }
  |> should.equal(mapping)
}

pub fn style_mapping_consistency_assignment_exists_test() {
  // StyleMappingConsistency as written: for every ChartView there exists a
  // SymbolAssignment for its document (style is a render mode over one
  // assignment).
  let #(s, doc) = fully_initialised(st.new())
  let _ = view(s, doc.id)
  symbols.assignment_of(s, doc.id) |> should.be_ok
}

pub fn chart_view_symbol_set_follows_assignment_test() {
  // The view's symbol_set is the set the chart renders with: switching sets
  // (rule SymbolSetSelected) updates the assignment, and the chart view
  // exposes the new set (the e2e suite pins the same via data-symbol-set).
  let #(s, doc) = fully_initialised(st.new())
  let alt = symbols.SymbolSet(
    "alt-set",
    list.map(range_inclusive(1, 8), fn(i) {
      symbols.Glyph("alt-glyph-" <> int.to_string(i), "M9 9 L" <> int.to_string(i))
    }),
    True,
  )
  let assert Ok(s) = symbols.select_symbol_set(s, doc.id, alt, 2000)
  view(s, doc.id).symbol_set |> should.equal(alt)
}

// -- derived: color_usage ---------------------------------------------------------------------------

pub fn color_usage_blank_document_test() {
  // ChartView.color_usage = usage_counts(document): one entry per palette
  // color, all zero for a blank document.
  let #(s, doc) = blank(st.new())
  let _ = s
  let usage = chart.usage_counts(doc)
  usage |> list.length |> should.equal(list.length(doc.palette))
  usage |> should.equal(range_inclusive(1, list.length(doc.palette)) |> list.map(fn(_) { 0 }))
}

pub fn color_usage_counts_committed_cells_test() {
  // Committed cells are counted by color index; empty cells contribute
  // nothing.
  let #(s, doc) = blank(st.new())
  let s =
    paint(s, doc.id, [
      CellChange(CellPosition(0, 0), None, Some(0)),
      CellChange(CellPosition(1, 0), None, Some(0)),
      CellChange(CellPosition(2, 0), None, Some(0)),
      CellChange(CellPosition(3, 0), None, Some(2)),
    ], 2000)
  chart.usage_counts(st.document(s, doc.id) |> result_value)
  |> should.equal([3, 0, 1, 0])
}

pub fn color_usage_updates_immediately_test() {
  // UsageCountsCurrent (AC-F008-01): the derived counts reflect the
  // committed grid immediately after each edit — no deferred/batched update.
  let #(s, doc) = blank(st.new())
  let s =
    paint(s, doc.id, [CellChange(CellPosition(0, 0), None, Some(1))], 2000)
  chart.usage_counts(st.document(s, doc.id) |> result_value)
  |> should.equal([0, 1, 0, 0])
  let s =
    paint(s, doc.id, [CellChange(CellPosition(0, 1), None, Some(1))], 3000)
  chart.usage_counts(st.document(s, doc.id) |> result_value)
  |> should.equal([0, 2, 0, 0])
}

pub fn color_usage_after_undo_test() {
  // color_usage is derived from committed cells only: undoing an edit
  // restores the counts (the undo entry is itself a committed command).
  let #(s, doc) = blank(st.new())
  let s =
    paint(s, doc.id, [
      CellChange(CellPosition(0, 0), None, Some(0)),
      CellChange(CellPosition(1, 0), None, Some(0)),
    ], 2000)
  let assert Ok(s) = st.undo(s, doc.id, 3000)
  chart.usage_counts(st.document(s, doc.id) |> result_value)
  |> should.equal([0, 0, 0, 0])
}

// -- error paths ---------------------------------------------------------------------------------------

pub fn chart_view_uninitialised_test() {
  // chart_view_of before initialisation fails cleanly; the rule entry
  // points all report the same.
  let assert Ok(#(s, doc)) = st.create_blank(st.new(), 8, 6, 1000)
  chart.chart_view_of(s, doc.id)
  |> should.equal(Error(chart.StateNotInitialised))
}

pub fn chart_rules_unknown_document_test() {
  // Every chart rule fails with DocumentNotFound for an unknown document.
  chart.select_chart_style(st.new(), "doc-1", chart.ColoredSymbolsOnly)
  |> should.equal(Error(chart.DocumentNotFound))
  chart.zoom_chart(st.new(), "doc-1", 100)
  |> should.equal(Error(chart.DocumentNotFound))
  chart.pan_chart(st.new(), "doc-1", types.CellPosition(0, 0))
  |> should.equal(Error(chart.DocumentNotFound))
}

pub fn chart_rules_uninitialised_test() {
  // The ChartView rules require existing view state (the entity is created
  // by DocumentViewInitialised).
  let assert Ok(#(s, doc)) = st.create_blank(st.new(), 8, 6, 1000)
  chart.select_chart_style(s, doc.id, chart.ColoredSymbolsOnly)
  |> should.equal(Error(chart.StateNotInitialised))
  chart.zoom_chart(s, doc.id, 100)
  |> should.equal(Error(chart.StateNotInitialised))
  chart.pan_chart(s, doc.id, types.CellPosition(0, 0))
  |> should.equal(Error(chart.StateNotInitialised))
}

// -- storage constraint: marker SourceImage ---------------------------------------------------------------

pub fn chart_marker_not_a_retained_source_test() {
  // ChartView rides Store.sources as a marker SourceImage (M1 Store shape is
  // pinned); store.source_of must skip the chart marker, so a blank document
  // still has no retained source after initialisation — and store.delete
  // drops the marker with the document.
  let #(s, doc) = blank(st.new())
  st.source_of(s, doc.id) |> should.equal(Error(st.DocumentNotFound))
  let assert Ok(s) = st.delete(s, doc.id)
  chart.chart_view_of(s, doc.id)
  |> should.equal(Error(chart.DocumentNotFound))
}
