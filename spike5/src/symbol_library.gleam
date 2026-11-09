/// The curated SVG symbol library — the single glyph source for this spike.
///
/// Every glyph lives in a 0..16 coordinate space so that stroke and gap
/// widths can be reasoned about as fractions of the cell (anticipating the
/// minimum-feature-size rule in AC-F047-05). The same path data would feed the
/// WebGL glyph atlas, the UI sprite, and the build-time PDF symbol font in
/// production (PRD v1.14 "SVG symbol library" glossary entry).

pub type FillRule {
  NonZero
  EvenOdd
}

pub type Glyph {
  Glyph(name: String, path: String, fill_rule: FillRule)
}

/// Curated pairwise overrides merged into the computed matrix.
///
/// Raw pixel distance cannot see mirror/flip/rotation confusables: a slash
/// and a backslash share zero pixels yet stitchers mix them up constantly.
/// These overrides encode that curation knowledge (by glyph name, mapped to
/// indices by the caller).
pub type Override {
  Override(left: String, right: String, distance: Float, rationale: String)
}

pub fn launch_set() -> List(Glyph) {
  [
    // Full cross: union of the two diagonal bands (nonzero so the overlap
    // stays filled). Bands are 2.4 units wide (~15% of the cell) — the
    // minimum-feature-size rule this spike is probing.
    Glyph(
      "cross",
      "M 0 13.6 L 0 16 L 16 0 L 13.6 0 Z"
        <> " M 0 0 L 2.4 0 L 16 13.6 L 16 16 Z",
      NonZero,
    ),
    // Plus: single orthogonal outline polygon, 2.8-unit arms.
    Glyph(
      "plus",
      "M 6.6 2 H 9.4 V 6.6 H 14 V 9.4 H 9.4 V 14 H 6.6 V 9.4 H 2 V 6.6 H 6.6 Z",
      NonZero,
    ),
    // Slash and backslash: 2.4-unit bands along the two diagonals.
    Glyph("slash", "M 0 13.6 L 0 16 L 16 0 L 13.6 0 Z", NonZero),
    Glyph("backslash", "M 0 0 L 2.4 0 L 16 13.6 L 16 16 Z", NonZero),
    // Bars.
    Glyph("hbar", "M 2 6.8 H 14 V 9.2 H 2 Z", NonZero),
    Glyph("vbar", "M 6.8 2 H 9.2 V 14 H 6.8 Z", NonZero),
    // Dot and ring: the deliberate near-pair. Dot radius 2.2, ring stroke
    // 2.2 (r 5.2 out / 3.0 in) — both at the feature-size floor.
    Glyph("dot", "M 8 5.8 A 2.2 2.2 0 1 0 8 10.2 A 2.2 2.2 0 1 0 8 5.8 Z", EvenOdd),
    Glyph(
      "ring",
      "M 8 2.8 A 5.2 5.2 0 1 0 8 13.2 A 5.2 5.2 0 1 0 8 2.8 Z"
        <> " M 8 5 A 3 3 0 1 1 8 11 A 3 3 0 1 1 8 5 Z",
      EvenOdd,
    ),
    // Triangles (vertical flip pair).
    Glyph("tri", "M 8 2.4 L 14 13.6 H 2 Z", NonZero),
    Glyph("inv_tri", "M 8 13.6 L 2 2.4 H 14 Z", NonZero),
    // Square outline (2.2 stroke) and filled diamond.
    Glyph(
      "square",
      "M 3 3 H 13 V 13 H 3 Z M 5.2 5.2 V 10.8 H 10.8 V 5.2 Z",
      EvenOdd,
    ),
    Glyph("diamond", "M 8 2 L 14 8 L 8 14 L 2 8 Z", NonZero),
    // 2x2 checker (disjoint subpaths, any fill rule).
    Glyph(
      "quad",
      "M 2 2 H 7 V 7 H 2 Z M 9 2 H 14 V 7 H 9 Z"
        <> " M 2 9 H 7 V 14 H 2 Z M 9 9 H 14 V 14 H 9 Z",
      NonZero,
    ),
  ]
}

pub fn curated_overrides() -> List(Override) {
  [
    Override("cross", "slash", 0.06, "cross contains the slash band — subset geometry reads as the same mark at a glance"),
    Override("cross", "backslash", 0.06, "cross contains the backslash band — subset geometry"),
    Override("slash", "backslash", 0.08, "mirror pair: pixel distance is large but stitchers confuse the diagonals"),
    Override("hbar", "vbar", 0.10, "rotation pair: identical under 90-degree rotation"),
    Override("tri", "inv_tri", 0.05, "vertical flip reads identical at chart glance"),
  ]
}

pub fn index_of(glyphs: List(Glyph), name: String) -> Result(Int, String) {
  index_of_loop(glyphs, name, 0)
}

fn index_of_loop(glyphs: List(Glyph), name: String, index: Int) -> Result(Int, String) {
  case glyphs {
    [] -> Error("unknown glyph in override: " <> name)
    [first, ..] if first.name == name -> Ok(index)
    [_, ..rest] -> index_of_loop(rest, name, index + 1)
  }
}
