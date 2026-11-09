import assignment
import bitmap
import gleeunit
import matrix

pub fn main() -> Nil {
  gleeunit.main()
}

// --- helpers ---

fn bitmap(w: Int, h: Int, pixels: List(Float)) -> bitmap.Bitmap {
  bitmap.Bitmap(w, h, pixels)
}

fn flat(w: Int, h: Int, value: Float) -> bitmap.Bitmap {
  bitmap(w, h, list_repeat(w * h, value))
}

fn list_repeat(n: Int, value: Float) -> List(Float) {
  case n <= 0 {
    True -> []
    False -> [value, ..list_repeat(n - 1, value)]
  }
}

fn matrix4(entries: List(Float)) -> matrix.Matrix {
  matrix.Matrix(4, entries)
}

// --- bitmap metrics ---

pub fn l1_distance_identity_and_symmetry_test() {
  let a = bitmap(2, 2, [1.0, 0.0, 0.5, 0.25])
  let b = bitmap(2, 2, [0.0, 1.0, 0.5, 0.0])
  assert bitmap.l1_distance(a, a) == 0.0
  assert bitmap.l1_distance(a, b) == bitmap.l1_distance(b, a)
  // mean(|1-0|, |0-1|, |0.5-0.5|, |0.25-0|) = (1+1+0+0.25)/4
  assert bitmap.l1_distance(a, b) == 0.5625
}

pub fn gaussian_blur_constant_bitmap_unchanged_test() {
  let solid = flat(4, 4, 0.8)
  let blurred = bitmap.gaussian_blur(solid)
  assert blurred.pixels == solid.pixels
}

pub fn erode3_full_bitmap_stays_full_test() {
  let full = flat(4, 4, 1.0)
  let eroded = bitmap.erode3(full)
  assert eroded.pixels == full.pixels
}

pub fn erode3_removes_single_pixel_test() {
  // one lone pixel on a 3x3 zero field must erode to nothing
  let speck = bitmap(3, 3, [0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0])
  let eroded = bitmap.erode3(speck)
  assert eroded.pixels == flat(3, 3, 0.0).pixels
}

pub fn box_downsample_averages_blocks_test() {
  // 4x4 with left half 1.0, right half 0.0 -> 2x2 with left column 1.0
  let row = [1.0, 1.0, 0.0, 0.0]
  let source = bitmap(4, 4, list_flatten4(row))
  let down = bitmap.box_downsample(source, 2)
  assert down.width == 2
  assert down.height == 2
  assert down.pixels == [1.0, 0.0, 1.0, 0.0]
}

fn list_flatten4(row: List(Float)) -> List(Float) {
  case row {
    [] -> []
    [a, b, c, d] -> [a, b, c, d, a, b, c, d, a, b, c, d, a, b, c, d]
    _ -> []
  }
}

pub fn coverage_counts_marked_pixels_test() {
  let half = bitmap(2, 2, [1.0, 1.0, 0.0, 0.0])
  assert bitmap.coverage(half) == 0.5
}

// --- matrix ---

pub fn matrix_from_bitmaps_shape_and_diagonal_test() {
  let a = flat(2, 2, 1.0)
  let b = flat(2, 2, 0.0)
  let m = matrix.from_bitmaps([a, b], bitmap.l1_distance)
  assert m.size == 2
  assert matrix.diagonal_zero(m)
  assert matrix.symmetric(m)
  assert matrix.get(m, 0, 1) == 1.0
}

pub fn min_off_diagonal_ignores_diagonal_test() {
  let m = matrix4([
    0.0, 0.9, 0.8, 0.7,
    0.9, 0.0, 0.1, 0.8,
    0.8, 0.1, 0.0, 0.9,
    0.7, 0.8, 0.9, 0.0,
  ])
  assert matrix.min_off_diagonal(m) == 0.1
}

pub fn apply_overrides_sets_both_directions_test() {
  let m = matrix4([
    0.0, 0.9, 0.8, 0.7,
    0.9, 0.0, 0.1, 0.8,
    0.8, 0.1, 0.0, 0.9,
    0.7, 0.8, 0.9, 0.0,
  ])
  let overridden = matrix.apply_overrides(m, [#(1, 2, 0.04)])
  assert matrix.get(overridden, 1, 2) == 0.04
  assert matrix.get(overridden, 2, 1) == 0.04
  // untouched entries survive
  assert matrix.get(overridden, 0, 1) == 0.9
  assert matrix.symmetric(overridden)
}

pub fn conservative_min_takes_elementwise_minimum_test() {
  let a = matrix4([
    0.0, 0.9, 0.8, 0.7,
    0.9, 0.0, 0.1, 0.8,
    0.8, 0.1, 0.0, 0.9,
    0.7, 0.8, 0.9, 0.0,
  ])
  let b = matrix4([
    0.0, 0.3, 0.8, 0.7,
    0.3, 0.0, 0.5, 0.8,
    0.8, 0.5, 0.0, 0.9,
    0.7, 0.8, 0.9, 0.0,
  ])
  let merged = matrix.conservative_min([a, b])
  assert matrix.get(merged, 0, 1) == 0.3
  assert matrix.get(merged, 1, 2) == 0.1
  assert matrix.min_off_diagonal(merged) == 0.1
}

// --- assignment ---

fn toy_matrix() -> matrix.Matrix {
  // symbol pair distances: close pairs (0,1) and (2,3) at 0.9,
  // cross pairs at 0.8/0.7
  matrix4([
    0.0, 0.9, 0.8, 0.7,
    0.9, 0.0, 0.7, 0.8,
    0.8, 0.7, 0.0, 0.9,
    0.7, 0.8, 0.9, 0.0,
  ])
}

fn path4(color: Int) -> List(Int) {
  case color {
    0 -> [1]
    1 -> [0, 2]
    2 -> [1, 3]
    _ -> [2]
  }
}

pub fn assignment_is_deterministic_and_unique_test() {
  let first = assignment.assign(toy_matrix(), 4, path4, 4)
  let second = assignment.assign(toy_matrix(), 4, path4, 4)
  assert first == second
  let symbols = list_map(first.mapping, fn(pair) { pair.1 })
  assert list_unique(symbols)
}

pub fn assignment_maximizes_worst_neighbor_distance_test() {
  let result = assignment.assign(toy_matrix(), 4, path4, 4)
  let sorted = list_sort_pairs(result.mapping)
  // colors 1 and 2 (degree 2) place first and must take the far pair (0,1)
  assert sorted == [#(0, 2), #(1, 0), #(2, 1), #(3, 3)]
  assert result.min_neighbor_distance == 0.8
}

pub fn assignment_respects_curated_override_test() {
  // force symbols 2 and 3 to be confusable: the assignment must never place
  // them on neighboring colors
  let m = matrix.apply_overrides(toy_matrix(), [#(2, 3, 0.02)])
  let result = assignment.assign(m, 4, path4, 4)
  let assert Ok(symbol_at_2) = assignment.symbol_of(result, 2)
  let assert Ok(symbol_at_3) = assignment.symbol_of(result, 3)
  let pair = case symbol_at_2 < symbol_at_3 {
    True -> #(symbol_at_2, symbol_at_3)
    False -> #(symbol_at_3, symbol_at_2)
  }
  assert pair != #(2, 3)
}

// --- tiny list helpers (tests only) ---

fn list_map(list: List(#(Int, Int)), f: fn(#(Int, Int)) -> Int) -> List(Int) {
  case list {
    [] -> []
    [first, ..rest] -> [f(first), ..list_map(rest, f)]
  }
}

fn list_unique(list: List(Int)) -> Bool {
  case list {
    [] -> True
    [first, ..rest] ->
      !list_contains(rest, first) && list_unique(rest)
  }
}

fn list_contains(list: List(Int), value: Int) -> Bool {
  case list {
    [] -> False
    [first, ..rest] -> first == value || list_contains(rest, value)
  }
}

fn list_sort_pairs(list: List(#(Int, Int))) -> List(#(Int, Int)) {
  case list {
    [] -> []
    [pivot, ..rest] -> {
      let smaller = list_filter(rest, fn(pair) { pair_smaller(pair, pivot) })
      let larger = list_filter(rest, fn(pair) { !pair_smaller(pair, pivot) })
      list_append(list_sort_pairs(smaller), [pivot, ..list_sort_pairs(larger)])
    }
  }
}

fn pair_smaller(a: #(Int, Int), b: #(Int, Int)) -> Bool {
  a.0 < b.0 || { a.0 == b.0 && a.1 < b.1 }
}

fn list_filter(list: List(#(Int, Int)), keep: fn(#(Int, Int)) -> Bool) -> List(#(Int, Int)) {
  case list {
    [] -> []
    [first, ..rest] ->
      case keep(first) {
        True -> [first, ..list_filter(rest, keep)]
        False -> list_filter(rest, keep)
      }
  }
}

fn list_append(a: List(#(Int, Int)), b: List(#(Int, Int))) -> List(#(Int, Int)) {
  case a {
    [] -> b
    [first, ..rest] -> [first, ..list_append(rest, b)]
  }
}
