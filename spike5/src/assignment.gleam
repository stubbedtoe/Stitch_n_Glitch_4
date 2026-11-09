/// Toy max-min symbol assignment — the consumer that proves the matrix
/// artifact is usable (Build Plan S5 pass bar). Stands in for F-047: colors
/// arrive with a neighbor relation (their closest colors under CIEDE2000 in
/// production), and each color greedily takes the available symbol whose
/// minimum distance to the symbols already on neighboring colors is largest.
/// Deterministic: score ties break toward the lower symbol index.

import gleam/float
import gleam/list
import gleam/order
import matrix.{type Matrix}

pub type Assignment {
  Assignment(mapping: List(#(Int, Int)), min_neighbor_distance: Float)
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

pub fn assign(
  matrix m: Matrix,
  colors colors: Int,
  neighbors neighbors: fn(Int) -> List(Int),
  symbols symbols: Int,
) -> Assignment {
  let order =
    range(0, colors - 1)
    |> list.sort(by: fn(a, b) {
      let degree_a = list.length(neighbors(a))
      let degree_b = list.length(neighbors(b))
      case int_compare(degree_b, degree_a) {
        order.Eq -> int_compare(a, b)
        other -> other
      }
    })

  let assigned = assign_loop(m, neighbors, order, [], range(0, symbols - 1))
  let min_neighbor_distance = min_neighbor_distance(m, neighbors, assigned)
  Assignment(assigned, min_neighbor_distance)
}

fn int_compare(a: Int, b: Int) -> order.Order {
  case a < b {
    True -> order.Lt
    False ->
      case a > b {
        True -> order.Gt
        False -> order.Eq
      }
  }
}

fn assign_loop(
  m: Matrix,
  neighbors: fn(Int) -> List(Int),
  order: List(Int),
  assigned: List(#(Int, Int)),
  remaining: List(Int),
) -> List(#(Int, Int)) {
  case order {
    [] -> assigned
    [color, ..rest] -> {
      let placed_neighbors =
        neighbors(color)
        |> list.filter_map(fn(neighbor) {
          list.find(assigned, fn(pair) { pair.0 == neighbor })
        })
      let best =
        remaining
        |> list.map(fn(symbol) {
          let worst =
            placed_neighbors
            |> list.fold(1.0, fn(acc, pair) {
              float.min(acc, matrix.get(m, symbol, pair.1))
            })
          #(symbol, worst)
        })
        |> list.sort(by: fn(a, b) {
          // highest score first, then lowest symbol index
          case float.compare(b.1, a.1) {
            order.Eq -> int_compare(a.0, b.0)
            other -> other
          }
        })
        |> list.first()
      case best {
        Error(Nil) -> assigned
        Ok(#(symbol, _)) ->
          assign_loop(
            m,
            neighbors,
            rest,
            [#(color, symbol), ..assigned],
            list.filter(remaining, fn(s) { s != symbol }),
          )
      }
    }
  }
}

fn min_neighbor_distance(
  m: Matrix,
  neighbors: fn(Int) -> List(Int),
  assigned: List(#(Int, Int)),
) -> Float {
  assigned
  |> list.fold(1.0, fn(acc, pair) {
    let #(color, symbol) = pair
    neighbors(color)
    |> list.fold(acc, fn(inner, neighbor) {
      case list.find(assigned, fn(other) { other.0 == neighbor }) {
        Error(Nil) -> inner
        Ok(#(_, neighbor_symbol)) ->
          float.min(inner, matrix.get(m, symbol, neighbor_symbol))
      }
    })
  })
}

pub fn symbol_of(assignment: Assignment, color: Int) -> Result(Int, Nil) {
  assignment.mapping
  |> list.find(fn(pair) { pair.0 == color })
  |> result_map_first()
}

fn result_map_first(result: Result(#(Int, Int), Nil)) -> Result(Int, Nil) {
  case result {
    Ok(#(_, symbol)) -> Ok(symbol)
    Error(Nil) -> Error(Nil)
  }
}
