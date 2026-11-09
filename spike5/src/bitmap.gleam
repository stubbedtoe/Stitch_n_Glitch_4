/// Alpha bitmap type and pure image operations — the whole analysis happens
/// in Gleam so it is unit-testable and renderer-independent. The only FFI is
/// the initial canvas rasterization of SVG path data.

import gleam/dict
import gleam/float
import gleam/int
import gleam/list

pub type Bitmap {
  Bitmap(width: Int, height: Int, pixels: List(Float))
}

/// Inclusive integer range as a list: range(0, 2) == [0, 1, 2].
pub fn range(from low: Int, to high: Int) -> List(Int) {
  range_loop(low, high, [])
  |> list.reverse
}

fn range_loop(low: Int, high: Int, acc: List(Int)) -> List(Int) {
  case low > high {
    True -> acc
    False -> range_loop(low + 1, high, [low, ..acc])
  }
}

pub fn from_alpha_bytes(width: Int, height: Int, alphas alphas: List(Int)) -> Bitmap {
  Bitmap(width:, height:, pixels: list.map(alphas, fn(a) { int.to_float(a) /. 255.0 }))
}

fn at(pixels: List(Float), index: Int) -> Float {
  case pixels {
    [] -> 0.0
    [first, ..rest] ->
      case index <= 0 {
        True -> first
        False -> at(rest, index - 1)
      }
  }
}

/// Edge-clamped sampling.
pub fn pixel(bitmap: Bitmap, x: Int, y: Int) -> Float {
  let cx = int.clamp(x, 0, bitmap.width - 1)
  let cy = int.clamp(y, 0, bitmap.height - 1)
  at(bitmap.pixels, cy * bitmap.width + cx)
}

/// O(1) pixel sampling structure for the filter operations: the raw list is
/// indexed once into a dictionary, avoiding the O(n) list walk per sample.
type Sampler {
  Sampler(width: Int, height: Int, index: dict.Dict(Int, Float))
}

fn to_sampler(bitmap: Bitmap) -> Sampler {
  let index =
    list.index_fold(bitmap.pixels, dict.new(), fn(acc, value, i) {
      dict.insert(acc, i, value)
    })
  Sampler(bitmap.width, bitmap.height, index)
}

fn sample(sampler: Sampler, x: Int, y: Int) -> Float {
  let cx = int.clamp(x, 0, sampler.width - 1)
  let cy = int.clamp(y, 0, sampler.height - 1)
  case dict.get(sampler.index, cy * sampler.width + cx) {
    Ok(value) -> value
    Error(Nil) -> 0.0
  }
}

/// Mean absolute difference over all pixels, in [0, 1].
/// Assumes both bitmaps share dimensions (callers guarantee this).
pub fn l1_distance(a: Bitmap, b: Bitmap) -> Float {
  let sum =
    list.map2(a.pixels, b.pixels, fn(x, y) { float.absolute_value(x -. y) })
    |> list.fold(0.0, fn(acc, d) { acc +. d })
  sum /. int.to_float(list.length(a.pixels))
}

fn kernel_sum(sampler: Sampler, kernel: List(List(Float)), x: Int, y: Int) -> Float {
  let radius = list.length(kernel) / 2
  kernel
  |> list.index_map(fn(row, dy) { #(row, dy - radius) })
  |> list.fold(0.0, fn(acc, pair) {
    let #(row, ky) = pair
    row
    |> list.index_map(fn(weight, dx) { #(weight, dx - radius) })
    |> list.fold(acc, fn(inner, cell) {
      let #(weight, kx) = cell
      inner +. weight *. sample(sampler, x + kx, y + ky)
    })
  })
}

/// General odd-sized square convolution with edge clamping.
pub fn convolve(bitmap: Bitmap, kernel: List(List(Float)), divisor: Float) -> Bitmap {
  let sampler = to_sampler(bitmap)
  let total = list.length(bitmap.pixels)
  let pixels =
    list.map(range(0, total - 1), fn(index) {
      kernel_sum(sampler, kernel, index % bitmap.width, index / bitmap.width)
      /. divisor
    })
  Bitmap(bitmap.width, bitmap.height, pixels)
}

/// 3x3 binomial gaussian (one pass ≈ a 1 px ink bleed).
pub fn gaussian_blur(bitmap: Bitmap) -> Bitmap {
  convolve(bitmap, [[1.0, 2.0, 1.0], [2.0, 4.0, 2.0], [1.0, 2.0, 1.0]], 16.0)
}

/// 3x3 minimum filter — thin strokes close up, simulating under-bleed or a
/// starved printer nozzle.
pub fn erode3(bitmap: Bitmap) -> Bitmap {
  let sampler = to_sampler(bitmap)
  let total = list.length(bitmap.pixels)
  let offsets = [-1, 0, 1]
  let pixels =
    list.map(range(0, total - 1), fn(index) {
      let x = index % bitmap.width
      let y = index / bitmap.width
      list.fold(offsets, 1.0, fn(acc, dy) {
        list.fold(offsets, acc, fn(inner, dx) {
          float.min(inner, sample(sampler, x + dx, y + dy))
        })
      })
    })
  Bitmap(bitmap.width, bitmap.height, pixels)
}

/// factor x factor box downsample (print-density bitmap -> cell-size bitmap).
pub fn box_downsample(bitmap: Bitmap, factor: Int) -> Bitmap {
  let sampler = to_sampler(bitmap)
  let out_width = bitmap.width / factor
  let out_height = bitmap.height / factor
  let pixels =
    list.map(range(0, out_width * out_height - 1), fn(index) {
      let ox = index % out_width
      let oy = index / out_width
      block_mean(sampler, ox * factor, oy * factor, factor)
    })
  Bitmap(out_width, out_height, pixels)
}

fn block_mean(sampler: Sampler, x: Int, y: Int, factor: Int) -> Float {
  block_mean_loop(sampler, x, x + factor - 1, y + factor - 1, x, y, 0.0, 0)
}

fn block_mean_loop(
  sampler: Sampler,
  min_x: Int,
  max_x: Int,
  max_y: Int,
  x: Int,
  y: Int,
  sum: Float,
  count: Int,
) -> Float {
  case y > max_y {
    True -> sum /. int.to_float(count)
    False ->
      case x > max_x {
        True -> block_mean_loop(sampler, min_x, max_x, max_y, min_x, y + 1, sum, count)
        False ->
          block_mean_loop(
            sampler,
            min_x,
            max_x,
            max_y,
            x + 1,
            y,
            sum +. sample(sampler, x, y),
            count + 1,
          )
      }
  }
}

/// Fraction of pixels at or above half coverage — a sanity metric proving the
/// glyph actually rendered (a row of zeros would mean a rasterization bug).
pub fn coverage(bitmap: Bitmap) -> Float {
  let marked =
    list.fold(bitmap.pixels, 0, fn(acc, p) {
      case p >=. 0.5 {
        True -> acc + 1
        False -> acc
      }
    })
  int.to_float(marked) /. int.to_float(list.length(bitmap.pixels))
}

pub fn dimensions_match(a: Bitmap, b: Bitmap) -> Bool {
  a.width == b.width && a.height == b.height && list.length(a.pixels) == list.length(b.pixels)
}
