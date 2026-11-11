//// Generated from specs/m2-chart-core.allium — slice m2-symbol-library:
//// value types Glyph and ColorSymbol; entities SymbolSet and SymbolAssignment;
//// rules SymbolSetSelected (+ its failure path) and the SymbolAssignment
//// ensures clause of DocumentViewInitialised (sequential-assignment half; the
//// EditorToolState clause is covered by tools_test, the op-stack clause by
//// pipeline_test); invariants SymbolUniquenessPerColor,
//// SymbolAssignmentUniquePerDocument, GlyphNamesUniquePerSet and
//// MinColorblindSafeSets; contract SingleGlyphSource (svg_path / glyph_count);
//// the SymbolLibrary surface (actor / exposure / provides guard).
////
//// RED baseline: src/sng/symbols.gleam does not exist yet — the whole suite
//// fails to compile on the unknown module. That is the intended red state;
//// see test/red-baseline-m2-symbol-library.txt.
////
//// Storage constraint (same convention as sng/tools and sng/pipeline): M1's
//// generated tests pin the st.Store record shape, so SymbolAssignment rides
//// inside Store.sources as a marker SourceImage whose content_hash carries
//// its encoding. The implement phase must make store.source_of skip the
//// symbol marker (as it already skips "toolstate" and "pipeline-state"), so
//// "exists SourceImage{document}" stays false for blank documents;
//// symbol_marker_not_a_retained_source_test pins that.
////
//// Binding decisions encoded here (user decisions 2026-11-10, PRD v1.14):
////   - Sequential assignment: palette color i gets glyph i of the chosen
////     symbol set — deterministic, one glyph per color, no glyph reuse while
////     palette.count <= set.glyphs.count. At capacity, further colors get no
////     symbol: sequential_assign stops at the set's glyph count, and the
////     SymbolSetSelected requires-clause (palette.count <= glyphs.count) is
////     the assignment guard — can_select / select_symbol_set reject sets that
////     cannot cover the palette (NotEnoughGlyphs), leaving the assignment
////     untouched.
////   - SymbolAssignment.strategy is the replaceable seam for F-047 (M3): M2
////     pins strategy = Sequential (single-variant enum; the max-min optimizer
////     swaps in behind the same field in M3 without renderer changes — the
////     renderer consumes only mapping).
////   - SingleGlyphSource (PRD v1.14): the curated SVG path data is the single
////     glyph source for the WebGL atlas, the UI sprite, the S5 confusability
////     tooling, and (reserved, M5) the build-time symbol font. Data-level
////     tests only: entity data and the contract accessors must agree exactly
////     (SingleSource), glyph names are unique within a set (NamesUniqueWithin
////     Set).
////   - Curated launch inventory is S5 curation (parked open question): M2
////     ships the library STRUCTURE with stand-in sets. These tests therefore
////     iterate generically over symbols.symbol_sets() and never demand
////     specific curated glyph art; the only concrete numbers are spec config
////     values (config.colorblind_safe_sets_required).
////   - The shipped library must satisfy MinColorblindSafeSets (>=
////     config.colorblind_safe_sets_required sets flagged colorblind-safe,
////     NFR-U2) and the primary set must cover a fresh document's palette, or
////     DocumentViewInitialised's unconditional SymbolAssignment creation
////     would violate SymbolUniquenessPerColor — the DVI test pins
////     mapping.count = palette.count against the real stub palette.

import gleam/int
import gleam/list
import gleeunit/should
import sng/config
import sng/store as st
import sng/symbols
import sng/types

/// Inclusive integer range [a, .., b]. Identical to the author's list.range.
fn range_inclusive(a: Int, b: Int) -> List(Int) {
  case a > b {
    True -> []
    False -> [a, ..range_inclusive(a + 1, b)]
  }
}

/// Blank 8x6 document with its symbol assignment initialised (rule
/// DocumentViewInitialised, SymbolAssignment ensures clause).
fn blank(s: st.Store) -> #(st.Store, types.PatternDocument) {
  let assert Ok(#(s, doc)) = st.create_blank(s, 8, 6, 1000)
  let assert Ok(s) = symbols.initialise_assignment(s, doc.id, 1000)
  #(s, doc)
}

fn assignment(s: st.Store, doc_id: String) -> symbols.SymbolAssignment {
  let assert Ok(a) = symbols.assignment_of(s, doc_id)
  a
}

/// Synthetic glyph — test data, not curated art.
fn glyph(i: Int) -> symbols.Glyph {
  symbols.Glyph("test-glyph-" <> int.to_string(i), "M0 0 L" <> int.to_string(i))
}

/// Synthetic palette of n entries — test data.
fn palette(n: Int) -> List(types.PaletteEntry) {
  list.map(range_inclusive(0, n - 1), fn(i) {
    types.PaletteEntry("colour " <> int.to_string(i), "#000000")
  })
}

/// Synthetic symbol set with `count` uniquely-named glyphs — test data.
fn test_set(name: String, count: Int, colorblind_safe: Bool) -> symbols.SymbolSet {
  symbols.SymbolSet(
    name,
    list.map(range_inclusive(1, count), glyph),
    colorblind_safe,
  )
}

// -- value types: Glyph / ColorSymbol (value equality + fields) -----------------

pub fn glyph_fields_test() {
  // entity-fields.Glyph: a curated symbol is a name plus its SVG path data.
  let g = symbols.Glyph("heart", "M0 0 L10 10")
  g.name |> should.equal("heart")
  g.svg_path |> should.equal("M0 0 L10 10")
}

pub fn glyph_value_equality_test() {
  // value-equality.Glyph: glyphs compare by name AND path data.
  symbols.Glyph("heart", "M0 0") |> should.equal(symbols.Glyph("heart", "M0 0"))
  symbols.Glyph("heart", "M0 0")
  |> should.not_equal(symbols.Glyph("star", "M0 0"))
  symbols.Glyph("heart", "M0 0")
  |> should.not_equal(symbols.Glyph("heart", "M1 1"))
}

pub fn color_symbol_fields_test() {
  // entity-fields.ColorSymbol: one entry of the color->symbol mapping.
  let g = symbols.Glyph("heart", "M0 0")
  let cs = symbols.ColorSymbol(2, g)
  cs.color_index |> should.equal(2)
  cs.glyph |> should.equal(g)
}

pub fn color_symbol_value_equality_test() {
  // value-equality.ColorSymbol.
  let g = symbols.Glyph("heart", "M0 0")
  symbols.ColorSymbol(1, g) |> should.equal(symbols.ColorSymbol(1, g))
  symbols.ColorSymbol(1, g) |> should.not_equal(symbols.ColorSymbol(2, g))
  symbols.ColorSymbol(1, g)
  |> should.not_equal(symbols.ColorSymbol(1, symbols.Glyph("star", "M0 0")))
}

// -- entity fields: SymbolSet -----------------------------------------------------

pub fn symbol_set_fields_test() {
  // entity-fields.SymbolSet: name, glyph inventory, colorblind-safe flag.
  let glyphs = [glyph(1), glyph(2)]
  let set = symbols.SymbolSet("demo", glyphs, True)
  set.name |> should.equal("demo")
  set.glyphs |> should.equal(glyphs)
  set.colorblind_safe |> should.be_true
}

// -- entity fields: SymbolAssignment ------------------------------------------------

pub fn symbol_assignment_fields_test() {
  // entity-fields.SymbolAssignment: document, symbol_set, strategy, mapping,
  // assigned_at — every field populated by DocumentViewInitialised.
  let #(s, doc) = blank(st.new())
  let a = assignment(s, doc.id)
  a.document_id |> should.equal(doc.id)
  a.symbol_set |> should.equal(symbols.primary_symbol_set())
  a.strategy |> should.equal(symbols.Sequential)
  a.mapping |> should.equal(symbols.sequential_assign(
    symbols.primary_symbol_set(),
    doc.palette,
  ))
  a.assigned_at |> should.equal(1000)
}

// -- config defaults (spec config block: no magic numbers in tests) ------------------

pub fn symbol_library_config_defaults_test() {
  // config.colorblind_safe_sets_required (NFR-U2): at least this many curated
  // sets must ship colorblind-safe. The constant carries the spec's value.
  config.colorblind_safe_sets_required |> should.equal(2)
}

// -- contract SingleGlyphSource -------------------------------------------------------

pub fn contract_svg_path_test() {
  // contract-signature.SingleGlyphSource.svg_path:
  // (set_name: String, glyph_name: String) -> String — surfaced as a Result so
  // a lookup failure never invents data. Every glyph's path is reachable by
  // (set name, glyph name).
  list.each(symbols.symbol_sets(), fn(set) {
    list.each(set.glyphs, fn(g) {
      symbols.svg_path(set.name, g.name) |> should.equal(Ok(g.svg_path))
    })
  })
  // Unknown set and unknown glyph both fail.
  symbols.svg_path("no-such-set", "heart")
  |> should.equal(Error(symbols.SetNotFound))
  let set = symbols.primary_symbol_set()
  symbols.svg_path(set.name, "no-such-glyph")
  |> should.equal(Error(symbols.GlyphNotFound))
}

pub fn contract_glyph_count_test() {
  // contract-signature.SingleGlyphSource.glyph_count:
  // (set_name: String) -> Integer — one count per set, no parallel inventory.
  list.each(symbols.symbol_sets(), fn(set) {
    symbols.glyph_count(set.name)
    |> should.equal(Ok(list.length(set.glyphs)))
  })
  symbols.glyph_count("no-such-set") |> should.equal(Error(symbols.SetNotFound))
}

pub fn single_glyph_source_invariant_test() {
  // @invariant SingleSource (PRD v1.14): the SVG path data is defined exactly
  // once per set — the entity data and the contract accessors agree, and no
  // glyph ships without path data. (The atlas / UI sprite / S5 tooling / M5
  // font all derive from this one source; rendering consumers are later
  // slices.)
  list.each(symbols.symbol_sets(), fn(set) {
    list.each(set.glyphs, fn(g) {
      g.svg_path |> should.not_equal("")
      let assert Ok(path) = symbols.svg_path(set.name, g.name)
      path |> should.equal(g.svg_path)
    })
  })
}

// -- invariants over the shipped library structure -------------------------------------

pub fn glyph_names_unique_per_set_test() {
  // invariant GlyphNamesUniquePerSet + contract @invariant
  // NamesUniqueWithinSet, over every shipped set.
  list.each(symbols.symbol_sets(), fn(set) {
    let names = list.map(set.glyphs, fn(g) { g.name })
    list.unique(names) |> list.length |> should.equal(list.length(names))
  })
}

pub fn min_colorblind_safe_sets_test() {
  // invariant MinColorblindSafeSets (NFR-U2): at least
  // config.colorblind_safe_sets_required curated sets are colorblind-safe.
  let safe = list.count(symbols.symbol_sets(), fn(set) { set.colorblind_safe })
  { safe >= config.colorblind_safe_sets_required } |> should.be_true
}

pub fn primary_symbol_set_is_shipped_test() {
  // DocumentViewInitialised binds the new document's assignment to
  // primary_symbol_set(); the primary set must be one of the curated sets.
  let set = symbols.primary_symbol_set()
  symbols.symbol_sets() |> list.contains(set) |> should.be_true
}

// -- sequential_assign (deterministic strategy; the F-047 seam) ---------------------------

pub fn sequential_assign_maps_color_i_to_glyph_i_test() {
  // Binding decision (user decision 2026-11-10): palette color i gets glyph i
  // of the chosen set, in order, for the whole palette.
  let set = test_set("seq", 6, False)
  let pal = palette(4)
  let mapping = symbols.sequential_assign(set, pal)
  mapping |> list.length |> should.equal(4)
  mapping
  |> should.equal(
    set.glyphs
    |> list.index_map(fn(g, i) { symbols.ColorSymbol(i, g) })
    |> list.take(list.length(pal)),
  )
}

pub fn sequential_assign_is_deterministic_test() {
  // Same (set, palette) => identical mapping, every time.
  let set = test_set("seq", 5, False)
  let pal = palette(4)
  symbols.sequential_assign(set, pal)
  |> should.equal(symbols.sequential_assign(set, pal))
  // A different set over the same palette assigns different glyphs: the
  // other set's inventory genuinely differs (distinct glyph names/paths),
  // so the color->glyph mappings differ.
  let other =
    symbols.SymbolSet(
      "other",
      list.map(range_inclusive(1, 5), fn(i) {
        symbols.Glyph("alt-glyph-" <> int.to_string(i), "M9 9 L" <> int.to_string(i))
      }),
      False,
    )
  symbols.sequential_assign(set, pal)
  |> should.not_equal(symbols.sequential_assign(other, pal))
}

pub fn sequential_assign_at_capacity_stops_test() {
  // At capacity (palette.count > set.glyphs.count) further colors get no
  // symbol: the mapping stops at the set's glyph count — never reusing a
  // glyph to fake coverage. (The SymbolSetSelected requires-clause is the
  // guard that keeps assignments within capacity.)
  let set = test_set("small", 2, False)
  let mapping = symbols.sequential_assign(set, palette(4))
  mapping |> list.length |> should.equal(2)
  list.map(mapping, fn(cs) { cs.color_index }) |> should.equal([0, 1])
  let names = list.map(mapping, fn(cs) { cs.glyph.name })
  list.unique(names) |> list.length |> should.equal(2)
}

// -- rule DocumentViewInitialised (SymbolAssignment ensures clause) -------------------------

pub fn document_view_initialised_assignment_test() {
  // Every document gets its sequential symbol assignment at creation:
  // primary set, strategy = sequential, mapping = sequential_assign(set,
  // palette), assigned_at = now.
  let assert Ok(#(s, doc)) = st.create_blank(st.new(), 8, 6, 1000)
  let assert Ok(s) = symbols.initialise_assignment(s, doc.id, 1000)
  let set = symbols.primary_symbol_set()
  let a = assignment(s, doc.id)
  a.document_id |> should.equal(doc.id)
  a.symbol_set |> should.equal(set)
  a.strategy |> should.equal(symbols.Sequential)
  a.mapping |> should.equal(symbols.sequential_assign(set, doc.palette))
  a.assigned_at |> should.equal(1000)
  // SymbolUniquenessPerColor holds at creation: one mapping entry per palette
  // color, no glyph reuse. (Pins that the primary set covers a fresh
  // document's palette — otherwise creation itself would break the
  // invariant.)
  a.mapping |> list.length |> should.equal(list.length(doc.palette))
  list.map(a.mapping, fn(cs) { cs.glyph.name })
  |> list.unique
  |> list.length
  |> should.equal(list.length(a.mapping))
}

pub fn initialise_assignment_unknown_document_test() {
  symbols.initialise_assignment(st.new(), "doc-1", 1000)
  |> should.equal(Error(symbols.DocumentNotFound))
}

// -- invariant SymbolAssignmentUniquePerDocument ---------------------------------------------

pub fn assignment_unique_per_document_test() {
  // Re-initialising must not create a second assignment or reset the
  // existing one.
  let #(s, doc) = blank(st.new())
  let alt = test_set("alt", 8, True)
  let assert Ok(s) = symbols.select_symbol_set(s, doc.id, alt, 2000)
  let assert Ok(s) = symbols.initialise_assignment(s, doc.id, 3000)
  let a = assignment(s, doc.id)
  a.symbol_set |> should.equal(alt)
  a.assigned_at |> should.equal(2000)
  // A different document's assignment is independent.
  let #(s, doc2) = blank(s)
  assignment(s, doc2.id).symbol_set |> should.equal(symbols.primary_symbol_set())
}

// -- invariant SymbolUniquenessPerColor ---------------------------------------------------------

pub fn symbol_uniqueness_per_color_test() {
  // One glyph per palette color and no glyph reuse within a document's
  // mapping (AC-F009-01) — after creation and after a set switch.
  let #(s, doc) = blank(st.new())
  let alt = test_set("alt", 8, True)
  let assert Ok(s) = symbols.select_symbol_set(s, doc.id, alt, 2000)
  let a = assignment(s, doc.id)
  a.mapping |> list.length |> should.equal(list.length(doc.palette))
  list.map(a.mapping, fn(cs) { cs.color_index })
  |> should.equal(range_inclusive(0, list.length(doc.palette) - 1))
  list.map(a.mapping, fn(cs) { cs.glyph.name })
  |> list.unique
  |> list.length
  |> should.equal(list.length(a.mapping))
}

// -- rule SymbolSetSelected ----------------------------------------------------------------------

pub fn symbol_set_selected_test() {
  // Switching sets re-runs the same deterministic sequential strategy; the
  // mapping is stable per (palette, set) — the renderer reads only mapping,
  // which is the strategy seam F-047 swaps in M3.
  let #(s, doc) = blank(st.new())
  let primary = symbols.primary_symbol_set()
  let alt = test_set("alt-set", 8, True)

  let assert Ok(s) = symbols.select_symbol_set(s, doc.id, alt, 2000)
  let a = assignment(s, doc.id)
  a.symbol_set |> should.equal(alt)
  a.strategy |> should.equal(symbols.Sequential)
  a.assigned_at |> should.equal(2000)
  a.mapping |> should.equal(symbols.sequential_assign(alt, doc.palette))
  a.mapping |> list.length |> should.equal(list.length(doc.palette))

  // Switching back to the primary set reproduces the initial mapping exactly.
  let assert Ok(s) = symbols.select_symbol_set(s, doc.id, primary, 3000)
  assignment(s, doc.id).mapping
  |> should.equal(symbols.sequential_assign(primary, doc.palette))
}

pub fn symbol_set_selected_not_enough_glyphs_test() {
  // rule-failure.SymbolSetSelected: requires document.palette.count <=
  // symbol_set.glyphs.count. A set too small for the palette is rejected and
  // the assignment is left untouched.
  let #(s, doc) = blank(st.new())
  let tiny = test_set("tiny", 1, False)
  symbols.select_symbol_set(s, doc.id, tiny, 2000)
  |> should.equal(Error(symbols.NotEnoughGlyphs))
  let a = assignment(s, doc.id)
  a.symbol_set |> should.equal(symbols.primary_symbol_set())
  a.assigned_at |> should.equal(1000)
}

pub fn symbol_set_selected_unknown_document_test() {
  let set = symbols.primary_symbol_set()
  symbols.select_symbol_set(st.new(), "doc-1", set, 2000)
  |> should.equal(Error(symbols.DocumentNotFound))
}

// -- SymbolLibrary surface: exposure / actor / provides -----------------------------------------

pub fn symbol_library_surface_exposure_test() {
  // surface-exposure.SymbolLibrary: every curated set exposes its name, its
  // glyph list, and its colorblind-safe flag — iterated generically; the
  // tests never demand specific curated glyph art.
  let sets = symbols.symbol_sets()
  { list.length(sets) >= config.colorblind_safe_sets_required }
  |> should.be_true
  list.each(sets, fn(set) {
    set.name |> should.not_equal("")
    let assert Ok(count) = symbols.glyph_count(set.name)
    count |> should.equal(list.length(set.glyphs))
    list.each(set.glyphs, fn(g) { g.svg_path |> should.not_equal("") })
  })
}

pub fn symbol_library_anonymous_actor_test() {
  // surface-actor.SymbolLibrary: browsing the library and selecting a set
  // require no user, account, or session context (M1 anonymous mode,
  // AC-F001-02).
  let set = symbols.primary_symbol_set()
  symbols.symbol_sets() |> list.contains(set) |> should.be_true
  let #(s, doc) = blank(st.new())
  let assert Ok(_s) = symbols.select_symbol_set(s, doc.id, set, 2000)
}

pub fn symbol_library_provides_guard_test() {
  // surface-provides.SymbolLibrary: SelectSymbolSet is offered exactly when
  // document.palette.count <= symbol_set.glyphs.count (the rule's requires
  // clause) — including exactly at capacity.
  let #(s, doc) = blank(st.new())
  let size = list.length(doc.palette)
  symbols.can_select(s, doc.id, test_set("enough", size, True))
  |> should.be_true
  symbols.can_select(s, doc.id, test_set("exact", size, False))
  |> should.be_true
  symbols.can_select(s, doc.id, test_set("too-small", size - 1, False))
  |> should.be_false
}

// -- storage constraint: marker SourceImage -----------------------------------------------------

pub fn symbol_marker_not_a_retained_source_test() {
  // SymbolAssignment rides Store.sources as a marker SourceImage (M1 Store
  // shape is pinned); store.source_of must skip the symbol marker, so a blank
  // document still has no retained source after initialisation — and
  // store.delete drops the marker with the document.
  let #(s, doc) = blank(st.new())
  st.source_of(s, doc.id) |> should.equal(Error(st.DocumentNotFound))
  let assert Ok(s) = st.delete(s, doc.id)
  symbols.assignment_of(s, doc.id)
  |> should.equal(Error(symbols.DocumentNotFound))
}
