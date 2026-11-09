/// Confusability matrix: pairwise symbol distances, curated overrides, and
/// conservative merging of degradation variants. Pure Gleam.

import bitmap.{type Bitmap}
import gleam/float
import gleam/json.{type Json}
import gleam/list

pub type Matrix {
  Matrix(size: Int, entries: List(Float))
}

/// Deterministic inclusive integer range.
fn range(from low: Int, to high: Int) -> List(Int) {
  range_loop(low, high, [])
  |> list.reverse
}

fn range_loop(low: Int, high: Int, acc: List(Int)) -> List(Int) {
  case low > high {
    True -> acc
    False -> range_loop(low + 1, high, [low, ..acc])
  }
}

fn list_at(list: List(a), index: Int) -> Result(a, Nil) {
  case list {
    [] -> Error(Nil)
    [first, ..rest] ->
      case index <= 0 {
        True -> Ok(first)
        False -> list_at(rest, index - 1)
      }
  }
}

fn entries_at(entries: List(Float), index: Int) -> Float {
  case entries {
    [] -> 0.0
    [first, ..rest] ->
      case index <= 0 {
        True -> first
        False -> entries_at(rest, index - 1)
      }
  }
}

pub fn get(matrix: Matrix, row: Int, column: Int) -> Float {
  entries_at(matrix.entries, row * matrix.size + column)
}

pub fn from_bitmaps(
  bitmaps: List(Bitmap),
  distance: fn(Bitmap, Bitmap) -> Float,
) -> Matrix {
  let n = list.length(bitmaps)
  let entries =
    list.map(range(0, n * n - 1), fn(index) {
      let row = index / n
      let column = index % n
      case row == column {
        True -> 0.0
        False -> {
          let assert Ok(a) = list_at(bitmaps, row)
          let assert Ok(b) = list_at(bitmaps, column)
          distance(a, b)
        }
      }
    })
  Matrix(n, entries)
}

pub fn symmetric(matrix: Matrix) -> Bool {
  range(0, matrix.size - 1)
  |> list.all(fn(row) {
    range(0, matrix.size - 1)
    |> list.all(fn(column) {
      float.absolute_value(get(matrix, row, column) -. get(matrix, column, row))
      <. 1.0e-9
    })
  })
}

pub fn diagonal_zero(matrix: Matrix) -> Bool {
  range(0, matrix.size - 1)
  |> list.all(fn(index) { get(matrix, index, index) == 0.0 })
}

/// Smallest off-diagonal distance — the headline "most confusable pair" number.
pub fn min_off_diagonal(matrix: Matrix) -> Float {
  matrix.entries
  |> list.index_map(fn(value, index) {
    #(value, index / matrix.size, index % matrix.size)
  })
  |> list.filter(fn(entry) {
    let #(_, row, column) = entry
    row != column
  })
  |> list.fold(1.0, fn(acc, entry) { float.min(acc, entry.0) })
}

/// Pairwise minimum across variant matrices — the conservative launch matrix:
/// if ink bleed makes two glyphs look alike, they ARE confusable.
pub fn conservative_min(matrices: List(Matrix)) -> Matrix {
  let assert Ok(first) = list.first(matrices)
  let entries =
    list.map(range(0, list.length(first.entries) - 1), fn(index) {
      list.fold(matrices, 1.0, fn(acc, matrix) {
        float.min(acc, entries_at(matrix.entries, index))
      })
    })
  Matrix(first.size, entries)
}

/// Merge curated overrides into both symmetric positions.
/// Overrides are (row, column, distance) index triples.
pub fn apply_overrides(matrix: Matrix, overrides: List(#(Int, Int, Float))) -> Matrix {
  let entries =
    list.index_map(matrix.entries, fn(value, index) {
      let row = index / matrix.size
      let column = index % matrix.size
      let hit =
        list.find(overrides, fn(override) {
          let #(o_row, o_column, _) = override
          { o_row == row && o_column == column } || { o_row == column && o_column == row }
        })
      case hit {
        Ok(#(_, _, distance)) -> distance
        Error(Nil) -> value
      }
    })
  Matrix(matrix.size, entries)
}

pub fn to_json(matrix: Matrix) -> Json {
  let rows =
    list.map(range(0, matrix.size - 1), fn(row) {
      json.array(
        list.map(range(0, matrix.size - 1), fn(column) {
          json.float(get(matrix, row, column))
        }),
        of: fn(x) { x },
      )
    })
  json.preprocessed_array(rows)
}
