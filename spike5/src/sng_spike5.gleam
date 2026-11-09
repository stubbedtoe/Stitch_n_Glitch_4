/// Spike S5 — confusability matrix generator (Build Plan §3, PRD F-047).
///
/// Pipeline: rasterize the curated SVG symbol library at chart-cell size via
/// the browser canvas (the only FFI — a browser primitive), then compute
/// everything in Gleam: pairwise distances, ink-bleed robustness variants
/// (blur + erosion), a print-density variant (3x supersample downsampled in
/// Gleam), the measurement noise floor (sub-pixel re-render), curated
/// overrides, the conservative launch matrix, and a toy max-min assignment
/// that consumes it.

import assignment.{type Assignment}
import bitmap.{type Bitmap}
import gleam/float
import gleam/int
import gleam/javascript/array.{type Array}
import gleam/json.{type Json}
import gleam/list
import gleam/result
import matrix
import symbol_library.{type Glyph, type Override}

// --- FFI boundary (see sng_spike5_ffi.mjs: no analysis logic in JS) ---
//
// Lists cross the boundary as gleam/javascript Array values (plain JS
// arrays), converted with array.from_list / array.to_list — Gleam lists
// themselves are not JS arrays on this target.

@external(javascript, "./sng_spike5_ffi.mjs", "set_status")
fn set_status(text: String) -> Nil

@external(javascript, "./sng_spike5_ffi.mjs", "set_result")
fn set_result(text: String) -> Nil

@external(javascript, "./sng_spike5_ffi.mjs", "set_error")
fn set_error(text: String) -> Nil

@external(javascript, "./sng_spike5_ffi.mjs", "set_sheet")
fn set_sheet(data_url: String) -> Nil

@external(javascript, "./sng_spike5_ffi.mjs", "rasterize")
fn rasterize(
  glyphs: Array(#(String, String)),
  cell: Int,
  scale: Int,
  offset_x: Float,
  offset_y: Float,
) -> Array(RawRaster)

@external(javascript, "./sng_spike5_ffi.mjs", "glyph_sheet")
fn glyph_sheet(
  glyphs: Array(#(String, String)),
  cell_sizes: Array(Int),
) -> String

// --- Configuration ---

const cell_sizes = [6, 8, 12, 16]

const print_scale = 3

const assignment_colors = 8

/// Minimum acceptable margin of the most-confusable computed pair over the
/// render alias floor (AC-F047-05 "passes with margin above the measurement
/// noise floor"). Curated overrides are exempt: they encode ground truth.
const min_margin_ratio = 2.0

// --- Types ---

type RawRaster {
  RawRaster(width: Int, height: Int, pixels: Array(Int))
}

type SizeReport {
  SizeReport(
    cell: Int,
    noise_floor: Float,
    computed_min_off_diagonal: Float,
    coverage: List(#(String, Float)),
    variant_mins: List(#(String, Float)),
    min_off_diagonal: Float,
    margin_ratio: Float,
    matrix_json: Json,
    assignment: Assignment,
    assignment_symbols: List(String),
    gates: List(#(String, Bool)),
    pass: Bool,
  )
}

pub fn main() -> Nil {
  set_status("S5 — rendering the curated SVG symbol library at chart-cell size…")
  let glyphs = symbol_library.launch_set()
  let glyph_pairs = list.map(glyphs, fn(glyph) { #(glyph.path, fill_rule(glyph)) })
  set_sheet(glyph_sheet(
    array.from_list(glyph_pairs),
    array.from_list(cell_sizes),
  ))

  case run_analysis(glyphs) {
    Ok(report) -> {
      set_result(json.to_string(report))
      set_status("S5 analysis complete — see result JSON.")
    }
    Error(message) -> set_error(message)
  }
  Nil
}

fn fill_rule(glyph: Glyph) -> String {
  case glyph.fill_rule {
    symbol_library.NonZero -> "nonzero"
    symbol_library.EvenOdd -> "evenodd"
  }
}

fn run_analysis(glyphs: List(Glyph)) -> Result(Json, String) {
  let names = list.map(glyphs, fn(glyph) { glyph.name })
  use overrides <- result.try(resolve_overrides(names))

  let glyph_pairs = list.map(glyphs, fn(glyph) { #(glyph.path, fill_rule(glyph)) })
  let symbol_count = list.length(glyphs)

  use size_reports <- result.try(
    list.try_map(cell_sizes, fn(cell) {
      analyse_cell_size(glyph_pairs, names, symbol_count, overrides, cell)
    }),
  )

  // Spike pass: the tooling must work end to end at every tested size, and at
  // least one size must clear the launch gates — that size is the measured
  // candidate minimum supported chart-cell size (the headline finding for
  // F-009's zoom/legibility design).
  let min_supported =
    list.find(size_reports, fn(report) { report.pass })
    |> result.map(fn(report) { report.cell })
    |> result.unwrap(-1)
  let pipeline_complete =
    list.length(size_reports) == list.length(cell_sizes)
    && list.all(size_reports, fn(report) {
      list.length(report.assignment.mapping) == assignment_colors
      && report.assignment.min_neighbor_distance >=. strictest_override_distance(
        overrides,
      )
    })
  let overall_pass = min_supported > 0 && pipeline_complete

  Ok(
    json.object([
      #("status", json.string("done")),
      #("glyphs", json.array(names, of: json.string)),
      #("glyphCount", json.int(symbol_count)),
      #("cellSizesPx", json.array(cell_sizes, of: json.int)),
      #("printScale", json.int(print_scale)),
      #("minMarginRatio", json.float(min_margin_ratio)),
      #(
        "overrides",
        json.array(overrides, of: fn(override) {
          let #(left, right, distance, rationale) = override
          json.object([
            #("left", json.string(left)),
            #("right", json.string(right)),
            #("distance", json.float(distance)),
            #("rationale", json.string(rationale)),
          ])
        }),
      ),
      #("sizes", json.array(size_reports, of: size_report_json)),
      #("minSupportedCellPx", json.int(min_supported)),
      #("checks", json.object([
        #("pipelineRanAllSizes", json.bool(pipeline_complete)),
        #("launchGatesPassAtMinSupportedCell", json.bool(min_supported > 0)),
        #("matrixConsumedByAssignment", json.bool(pipeline_complete)),
      ])),
      #("pass", json.bool(overall_pass)),
    ]),
  )
}

fn resolve_overrides(
  names: List(String),
) -> Result(List(#(String, String, Float, String)), String) {
  list.try_map(symbol_library.curated_overrides(), fn(override: Override) {
    use _ <- result.try(index_of_name(names, override.left))
    use _ <- result.try(index_of_name(names, override.right))
    Ok(#(override.left, override.right, override.distance, override.rationale))
  })
}

fn index_of_name(names: List(String), name: String) -> Result(Int, String) {
  names
  |> list.index_map(fn(entry, index) { #(entry, index) })
  |> list.find(fn(pair) { pair.0 == name })
  |> result.map(fn(pair) { pair.1 })
  |> result.replace_error("unknown glyph in override: " <> name)
}

fn list_at_name(names: List(String), index: Int) -> Result(String, Nil) {
  case index < 0 {
    True -> Error(Nil)
    False -> list_at_name_loop(names, index)
  }
}

fn list_at_name_loop(names: List(String), index: Int) -> Result(String, Nil) {
  case names {
    [] -> Error(Nil)
    [first, ..rest] ->
      case index <= 0 {
        True -> Ok(first)
        False -> list_at_name_loop(rest, index - 1)
      }
  }
}

fn analyse_cell_size(
  glyph_pairs: List(#(String, String)),
  names: List(String),
  symbol_count: Int,
  overrides: List(#(String, String, Float, String)),
  cell: Int,
) -> Result(SizeReport, String) {
  set_status(
    "S5 — cell "
    <> int.to_string(cell)
    <> " px: rasterizing, computing variants, overrides, assignment…",
  )

  let glyph_array = array.from_list(glyph_pairs)

  use plain_raw <- result.try(as_rasters(rasterize(
    glyph_array, cell, 1, 0.0, 0.0,
  )))
  use print_raw <- result.try(as_rasters(rasterize(
    glyph_array,
    cell,
    print_scale,
    0.0,
    0.0,
  )))

  let plain = list.map(plain_raw, raw_to_bitmap)
  // Print-density bitmaps (3x) — variants are computed in this domain so one
  // device pixel of bleed equals 1/3 cell pixel, then downsampled back.
  let print =
    list.map(print_raw, fn(raw) { bitmap.box_downsample(raw_to_bitmap(raw), print_scale) })
  let bleed_blur =
    list.map(print_raw, fn(raw) {
      let hi_res = raw_to_bitmap(raw)
      bitmap.box_downsample(bitmap.gaussian_blur(hi_res), print_scale)
    })
  let bleed_erode =
    list.map(print_raw, fn(raw) {
      let hi_res = raw_to_bitmap(raw)
      bitmap.box_downsample(bitmap.erode3(hi_res), print_scale)
    })

  // Measurement noise floor: how much the bitmap moves between two legitimate
  // rasterizations of the same geometry (screen density vs 3x-then-downsampled,
  // the proxy for cross-renderer variance in AC-F047-05 — e.g. WebGL vs
  // PDFium vs CoreGraphics). Distinct pairs must clear this by a margin.
  let alias_floor = noise_floor(plain, print)
  let coverage = list.map2(names, plain, fn(name, bmp) { #(name, bitmap.coverage(bmp)) })

  let plain_matrix = matrix.from_bitmaps(plain, bitmap.l1_distance)
  let blur_matrix = matrix.from_bitmaps(bleed_blur, bitmap.l1_distance)
  let erode_matrix = matrix.from_bitmaps(bleed_erode, bitmap.l1_distance)
  let print_matrix = matrix.from_bitmaps(print, bitmap.l1_distance)

  // Launch matrix = conservative minimum across rendering conditions, before
  // curated overrides merge (overrides encode ground truth, not measurement).
  let computed = matrix.conservative_min([plain_matrix, blur_matrix, erode_matrix])

  use override_indices <- result.try(override_indices(names, overrides))

  let computed_min = matrix.min_off_diagonal(computed)
  let margin_ratio = computed_min /. float.max(alias_floor, 0.000001)
  let print_min = matrix.min_off_diagonal(print_matrix)
  let final = matrix.apply_overrides(computed, override_indices)
  let min_off_diagonal = matrix.min_off_diagonal(final)

  let neighbors = path_neighbors(assignment_colors)
  let toy =
    assignment.assign(final, assignment_colors, neighbors, symbol_count)
  let assignment_symbols =
    list.sort(toy.mapping, fn(a, b) { int.compare(a.0, b.0) })
    |> list.map(fn(pair) {
      let assert Ok(glyph) = list_at_name(names, pair.1)
      glyph
    })
  let strictest_override = strictest_override_distance(overrides)

  let gates = [
    #("matrixSymmetric", matrix.symmetric(final)),
    #("matrixDiagonalZero", matrix.diagonal_zero(final)),
    #("allGlyphsRendered", list.all(coverage, fn(entry) { entry.1 >. 0.0 })),
    #("computedMinAboveAliasFloor", computed_min >. alias_floor),
    #(
      "marginRatioAtLeast"
        <> float.to_string(min_margin_ratio),
      margin_ratio >=. min_margin_ratio,
    ),
    #("printVariantAboveAliasFloor", print_min >. alias_floor),
    #(
      "assignmentMinNeighborAtLeastStrictestOverride",
      toy.min_neighbor_distance >=. strictest_override,
    ),
  ]
  let pass = list.all(gates, fn(gate) { gate.1 })

  Ok(SizeReport(
    cell: cell,
    noise_floor: alias_floor,
    computed_min_off_diagonal: computed_min,
    coverage: coverage,
    variant_mins: [
      #("plain", matrix.min_off_diagonal(plain_matrix)),
      #("blur", matrix.min_off_diagonal(blur_matrix)),
      #("erode", matrix.min_off_diagonal(erode_matrix)),
      #("print", print_min),
    ],
    min_off_diagonal: min_off_diagonal,
    margin_ratio: margin_ratio,
    matrix_json: matrix.to_json(final),
    assignment: toy,
    assignment_symbols: assignment_symbols,
    gates: gates,
    pass: pass,
  ))
}

fn strictest_override_distance(
  overrides: List(#(String, String, Float, String)),
) -> Float {
  overrides
  |> list.fold(1.0, fn(acc, override) { float.min(acc, override.2) })
}

fn override_indices(
  names: List(String),
  overrides: List(#(String, String, Float, String)),
) -> Result(List(#(Int, Int, Float)), String) {
  list.try_map(overrides, fn(override) {
    let #(left, right, distance, _) = override
    use left_index <- result.try(index_of_name(names, left))
    use right_index <- result.try(index_of_name(names, right))
    Ok(#(left_index, right_index, distance))
  })
}

/// Toy color graph: a path — each color's closest colors are its neighbors
/// (stands in for CIEDE2000-nearest colors in F-047).
fn path_neighbors(colors: Int) -> fn(Int) -> List(Int) {
  fn(color) {
    list.filter([color - 1, color + 1], fn(neighbor) {
      neighbor >= 0 && neighbor < colors
    })
  }
}

fn noise_floor(plain: List(Bitmap), shifted: List(Bitmap)) -> Float {
  list.map2(plain, shifted, bitmap.l1_distance)
  |> list.fold(0.0, float.max)
}

fn raw_to_bitmap(raw: RawRaster) -> Bitmap {
  bitmap.from_alpha_bytes(raw.width, raw.height, array.to_list(raw.pixels))
}

/// The FFI returns a plain JS array of raster records; the external's return
/// type is trusted (see module header), this just normalizes to a Gleam list.
fn as_rasters(raw: Array(RawRaster)) -> Result(List(RawRaster), String) {
  let _constructor_is_used_on_the_ffi_edge =
    RawRaster(0, 0, array.from_list([]))
  Ok(array.to_list(raw))
}

fn size_report_json(report: SizeReport) -> Json {
  let SizeReport(
    cell:,
    noise_floor:,
    computed_min_off_diagonal:,
    coverage:,
    variant_mins:,
    min_off_diagonal:,
    margin_ratio:,
    matrix_json:,
    assignment:,
    assignment_symbols:,
    gates:,
    pass:,
  ) = report
  json.object([
    #("cell", json.int(cell)),
    #("noiseFloor", json.float(noise_floor)),
    #("computedMinOffDiagonal", json.float(computed_min_off_diagonal)),
    #(
      "coverage",
      json.object(list.map(coverage, fn(entry) {
        #(entry.0, json.float(entry.1))
      })),
    ),
    #(
      "variantMinOffDiagonal",
      json.object(list.map(variant_mins, fn(entry) {
        #(entry.0, json.float(entry.1))
      })),
    ),
    #("finalMinOffDiagonal", json.float(min_off_diagonal)),
    #("marginRatio", json.float(margin_ratio)),
    #("matrix", matrix_json),
    #(
      "assignment",
      json.object([
        #("colors", json.int(list.length(assignment.mapping))),
        #(
          "mapping",
          json.array(
            list.sort(assignment.mapping, fn(a, b) { int.compare(a.0, b.0) }),
            of: fn(pair) {
              json.preprocessed_array([json.int(pair.0), json.int(pair.1)])
            },
          ),
        ),
        #("symbols", json.array(assignment_symbols, of: json.string)),
        #(
          "minNeighborDistance",
          json.float(assignment.min_neighbor_distance),
        ),
      ]),
    ),
    #(
      "gates",
      json.object(list.map(gates, fn(gate) { #(gate.0, json.bool(gate.1)) })),
    ),
    #("pass", json.bool(pass)),
  ])
}
