import * as $int from "../../gleam_stdlib/gleam/int.mjs";
import * as $list from "../../gleam_stdlib/gleam/list.mjs";
import * as $option from "../../gleam_stdlib/gleam/option.mjs";
import * as $string from "../../gleam_stdlib/gleam/string.mjs";
import {
  Ok,
  Error,
  Empty as $Empty,
  List$Empty$const as $List$Empty$const,
  prepend as listPrepend,
  CustomType as $CustomType,
  makeError,
  remainderInt,
} from "../gleam.mjs";
import * as $types from "../sng/types.mjs";
import {
  CellChange,
  CellPosition,
  CellState,
  DocumentEdit,
  PaletteEntry,
  Thumbnail,
  cell_at,
} from "../sng/types.mjs";

const FILEPATH = "src/sng/stub.gleam";

export class StubGrid extends $CustomType {
  constructor(width, height, cells, palette) {
    super();
    this.width = width;
    this.height = height;
    this.cells = cells;
    this.palette = palette;
  }
}
export const StubGrid$StubGrid = (width, height, cells, palette) =>
  new StubGrid(width, height, cells, palette);
export const StubGrid$isStubGrid = (value) => value instanceof StubGrid;
export const StubGrid$StubGrid$width = (value) => value.width;
export const StubGrid$StubGrid$0 = (value) => value.width;
export const StubGrid$StubGrid$height = (value) => value.height;
export const StubGrid$StubGrid$1 = (value) => value.height;
export const StubGrid$StubGrid$cells = (value) => value.cells;
export const StubGrid$StubGrid$2 = (value) => value.cells;
export const StubGrid$StubGrid$palette = (value) => value.palette;
export const StubGrid$StubGrid$3 = (value) => value.palette;

function at_index(loop$list, loop$index) {
  while (true) {
    let list = loop$list;
    let index = loop$index;
    let $ = index <= 0;
    if (list instanceof $Empty) {
      return new Error(undefined);
    } else if ($) {
      let first = list.head;
      return new Ok(first);
    } else {
      let rest = list.tail;
      loop$list = rest;
      loop$index = index - 1;
    }
  }
}

function range_list(n) {
  let $ = n <= 0;
  if ($) {
    return $List$Empty$const;
  } else {
    let _pipe = range_list(n - 1);
    return $list.append(_pipe, listPrepend(n - 1, $List$Empty$const));
  }
}

/**
 * Minimal placeholder palette until F-010/F-011 (M3).
 */
export function default_stub_palette() {
  return listPrepend(
    new PaletteEntry("Stub Red", "#CC0000"),
    listPrepend(
      new PaletteEntry("Stub Green", "#00CC00"),
      listPrepend(
        new PaletteEntry("Stub Blue", "#0000CC"),
        listPrepend(
          new PaletteEntry("Stub Black", "#000000"),
          $List$Empty$const,
        ),
      ),
    ),
  );
}

/**
 * Deterministic placeholder for the M3 conversion pipeline: a 16×16 grid
 * whose cell colors are derived from the image bytes. Runs locally — the
 * image never leaves the device (LocalOnlyBoundary).
 */
export function stub_convert(image_bytes) {
  let palette = default_stub_palette();
  let width = 16;
  let height = 16;
  let byte_count = $list.length(image_bytes);
  let cells = $list.flat_map(
    range_list(height),
    (y) => {
      return $list.map(
        range_list(width),
        (x) => {
          let $ = at_index(
            image_bytes,
            remainderInt((x + y * width), byte_count),
          );
          let byte;
          if ($ instanceof Ok) {
            byte = $[0];
          } else {
            throw makeError(
              "let_assert",
              FILEPATH,
              "sng/stub",
              34,
              "stub_convert",
              "Pattern match failed, no pattern matched the value.",
              {
                value: $,
                start: 1458,
                end: 1533,
                pattern_start: 1469,
                pattern_end: 1477
              }
            )
          }
          return new CellState(
            new CellPosition(x, y),
            new $option.Some(remainderInt(byte, $list.length(palette))),
          );
        },
      );
    },
  );
  return new StubGrid(width, height, cells, palette);
}

/**
 * Placeholder thumbnail: a deterministic marker derived from the document
 * content. Replaced by real rendering in M2 (F-009). The shape of the
 * result (data + generated_at) is the contract the library list uses.
 */
export function render_thumbnail(document, now) {
  let seed = ($int.to_string($list.length(document.cells)) + "-") + document.name;
  return new Thumbnail("stub-thumbnail:" + seed, now);
}

function to_hex(value) {
  let value$1 = $int.bitwise_and(value, 0xFFFFFFFF);
  let $ = $int.to_base_string(value$1, 16);
  let digits;
  if ($ instanceof Ok) {
    digits = $[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/stub",
      102,
      "to_hex",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $,
        start: 3495,
        end: 3548,
        pattern_start: 3506,
        pattern_end: 3516
      }
    )
  }
  let _block;
  if (digits.charCodeAt(0) === 45) {
    let rest = digits.slice(1);
    _block = rest;
  } else {
    _block = digits;
  }
  let digits$1 = _block;
  return $string.pad_start(digits$1, 8, "0");
}

function mix(loop$bytes, loop$acc, loop$hash) {
  while (true) {
    let bytes = loop$bytes;
    let acc = loop$acc;
    let hash = loop$hash;
    if (bytes instanceof $Empty) {
      return to_hex(hash);
    } else {
      let byte = bytes.head;
      let rest = bytes.tail;
      let hash$1 = $int.bitwise_and(hash * 33 + byte, 0xFFFFFFFF);
      loop$bytes = rest;
      loop$acc = acc + 1;
      loop$hash = hash$1;
    }
  }
}

/**
 * Deterministic 32-bit content hash, 8 hex digits. Content addressing for
 * the retained source image; upgrade to SHA-256 with the persistence
 * adapter (M1 placeholder is explicitly permitted by the spec's guidance).
 */
export function content_hash(bytes) {
  return mix(bytes, 0, 5381);
}

/**
 * Build the inverse of an edit against the current grid: the inverse change
 * sets each cell back to the value it had before the edit (its `after` is
 * the cell's current value; its `before` is the value the edit imposed).
 */
export function inverse_of(cells, edit) {
  return new DocumentEdit(
    $list.map(
      edit.changes,
      (change) => {
        return new CellChange(
          change.position,
          change.after,
          cell_at(cells, change.position),
        );
      },
    ),
  );
}
