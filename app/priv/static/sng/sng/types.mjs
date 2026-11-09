import * as $list from "../../gleam_stdlib/gleam/list.mjs";
import * as $option from "../../gleam_stdlib/gleam/option.mjs";
import {
  Empty as $Empty,
  List$Empty$const as $List$Empty$const,
  prepend as listPrepend,
  CustomType as $CustomType,
  isEqual,
} from "../gleam.mjs";

export class CellPosition extends $CustomType {
  constructor(x, y) {
    super();
    this.x = x;
    this.y = y;
  }
}
export const CellPosition$CellPosition = (x, y) => new CellPosition(x, y);
export const CellPosition$isCellPosition = (value) =>
  value instanceof CellPosition;
export const CellPosition$CellPosition$x = (value) => value.x;
export const CellPosition$CellPosition$0 = (value) => value.x;
export const CellPosition$CellPosition$y = (value) => value.y;
export const CellPosition$CellPosition$1 = (value) => value.y;

export class CellState extends $CustomType {
  constructor(position, color_index) {
    super();
    this.position = position;
    this.color_index = color_index;
  }
}
export const CellState$CellState = (position, color_index) =>
  new CellState(position, color_index);
export const CellState$isCellState = (value) => value instanceof CellState;
export const CellState$CellState$position = (value) => value.position;
export const CellState$CellState$0 = (value) => value.position;
export const CellState$CellState$color_index = (value) => value.color_index;
export const CellState$CellState$1 = (value) => value.color_index;

export class CellChange extends $CustomType {
  constructor(position, before, after) {
    super();
    this.position = position;
    this.before = before;
    this.after = after;
  }
}
export const CellChange$CellChange = (position, before, after) =>
  new CellChange(position, before, after);
export const CellChange$isCellChange = (value) => value instanceof CellChange;
export const CellChange$CellChange$position = (value) => value.position;
export const CellChange$CellChange$0 = (value) => value.position;
export const CellChange$CellChange$before = (value) => value.before;
export const CellChange$CellChange$1 = (value) => value.before;
export const CellChange$CellChange$after = (value) => value.after;
export const CellChange$CellChange$2 = (value) => value.after;

export class DocumentEdit extends $CustomType {
  constructor(changes) {
    super();
    this.changes = changes;
  }
}
export const DocumentEdit$DocumentEdit = (changes) => new DocumentEdit(changes);
export const DocumentEdit$isDocumentEdit = (value) =>
  value instanceof DocumentEdit;
export const DocumentEdit$DocumentEdit$changes = (value) => value.changes;
export const DocumentEdit$DocumentEdit$0 = (value) => value.changes;

export class PaletteEntry extends $CustomType {
  constructor(name, rgb) {
    super();
    this.name = name;
    this.rgb = rgb;
  }
}
export const PaletteEntry$PaletteEntry = (name, rgb) =>
  new PaletteEntry(name, rgb);
export const PaletteEntry$isPaletteEntry = (value) =>
  value instanceof PaletteEntry;
export const PaletteEntry$PaletteEntry$name = (value) => value.name;
export const PaletteEntry$PaletteEntry$0 = (value) => value.name;
export const PaletteEntry$PaletteEntry$rgb = (value) => value.rgb;
export const PaletteEntry$PaletteEntry$1 = (value) => value.rgb;

export class Thumbnail extends $CustomType {
  constructor(data, generated_at) {
    super();
    this.data = data;
    this.generated_at = generated_at;
  }
}
export const Thumbnail$Thumbnail = (data, generated_at) =>
  new Thumbnail(data, generated_at);
export const Thumbnail$isThumbnail = (value) => value instanceof Thumbnail;
export const Thumbnail$Thumbnail$data = (value) => value.data;
export const Thumbnail$Thumbnail$0 = (value) => value.data;
export const Thumbnail$Thumbnail$generated_at = (value) => value.generated_at;
export const Thumbnail$Thumbnail$1 = (value) => value.generated_at;

export class User extends $CustomType {
  constructor(id, has_account) {
    super();
    this.id = id;
    this.has_account = has_account;
  }
}
export const User$User = (id, has_account) => new User(id, has_account);
export const User$isUser = (value) => value instanceof User;
export const User$User$id = (value) => value.id;
export const User$User$0 = (value) => value.id;
export const User$User$has_account = (value) => value.has_account;
export const User$User$1 = (value) => value.has_account;

export class PatternDocument extends $CustomType {
  constructor(id, name, width, height, cells, palette, created_at, last_edited) {
    super();
    this.id = id;
    this.name = name;
    this.width = width;
    this.height = height;
    this.cells = cells;
    this.palette = palette;
    this.created_at = created_at;
    this.last_edited = last_edited;
  }
}
export const PatternDocument$PatternDocument = (id, name, width, height, cells, palette, created_at, last_edited) =>
  new PatternDocument(id,
  name,
  width,
  height,
  cells,
  palette,
  created_at,
  last_edited);
export const PatternDocument$isPatternDocument = (value) =>
  value instanceof PatternDocument;
export const PatternDocument$PatternDocument$id = (value) => value.id;
export const PatternDocument$PatternDocument$0 = (value) => value.id;
export const PatternDocument$PatternDocument$name = (value) => value.name;
export const PatternDocument$PatternDocument$1 = (value) => value.name;
export const PatternDocument$PatternDocument$width = (value) => value.width;
export const PatternDocument$PatternDocument$2 = (value) => value.width;
export const PatternDocument$PatternDocument$height = (value) => value.height;
export const PatternDocument$PatternDocument$3 = (value) => value.height;
export const PatternDocument$PatternDocument$cells = (value) => value.cells;
export const PatternDocument$PatternDocument$4 = (value) => value.cells;
export const PatternDocument$PatternDocument$palette = (value) => value.palette;
export const PatternDocument$PatternDocument$5 = (value) => value.palette;
export const PatternDocument$PatternDocument$created_at = (value) =>
  value.created_at;
export const PatternDocument$PatternDocument$6 = (value) => value.created_at;
export const PatternDocument$PatternDocument$last_edited = (value) =>
  value.last_edited;
export const PatternDocument$PatternDocument$7 = (value) => value.last_edited;

export class Draw extends $CustomType {}
export const CommandVerb$Draw$const = new Draw();
export const CommandVerb$Draw = () => CommandVerb$Draw$const;
export const CommandVerb$isDraw = (value) => value instanceof Draw;

export class Undo extends $CustomType {}
export const CommandVerb$Undo$const = new Undo();
export const CommandVerb$Undo = () => CommandVerb$Undo$const;
export const CommandVerb$isUndo = (value) => value instanceof Undo;

export class Redo extends $CustomType {}
export const CommandVerb$Redo$const = new Redo();
export const CommandVerb$Redo = () => CommandVerb$Redo$const;
export const CommandVerb$isRedo = (value) => value instanceof Redo;

export class DocumentCommand extends $CustomType {
  constructor(id, document_id, sequence, verb, edit, inverse, committed_at) {
    super();
    this.id = id;
    this.document_id = document_id;
    this.sequence = sequence;
    this.verb = verb;
    this.edit = edit;
    this.inverse = inverse;
    this.committed_at = committed_at;
  }
}
export const DocumentCommand$DocumentCommand = (id, document_id, sequence, verb, edit, inverse, committed_at) =>
  new DocumentCommand(id,
  document_id,
  sequence,
  verb,
  edit,
  inverse,
  committed_at);
export const DocumentCommand$isDocumentCommand = (value) =>
  value instanceof DocumentCommand;
export const DocumentCommand$DocumentCommand$id = (value) => value.id;
export const DocumentCommand$DocumentCommand$0 = (value) => value.id;
export const DocumentCommand$DocumentCommand$document_id = (value) =>
  value.document_id;
export const DocumentCommand$DocumentCommand$1 = (value) => value.document_id;
export const DocumentCommand$DocumentCommand$sequence = (value) =>
  value.sequence;
export const DocumentCommand$DocumentCommand$2 = (value) => value.sequence;
export const DocumentCommand$DocumentCommand$verb = (value) => value.verb;
export const DocumentCommand$DocumentCommand$3 = (value) => value.verb;
export const DocumentCommand$DocumentCommand$edit = (value) => value.edit;
export const DocumentCommand$DocumentCommand$4 = (value) => value.edit;
export const DocumentCommand$DocumentCommand$inverse = (value) => value.inverse;
export const DocumentCommand$DocumentCommand$5 = (value) => value.inverse;
export const DocumentCommand$DocumentCommand$committed_at = (value) =>
  value.committed_at;
export const DocumentCommand$DocumentCommand$6 = (value) => value.committed_at;

export class DocumentSnapshot extends $CustomType {
  constructor(id, document_id, sequence, cells, taken_at) {
    super();
    this.id = id;
    this.document_id = document_id;
    this.sequence = sequence;
    this.cells = cells;
    this.taken_at = taken_at;
  }
}
export const DocumentSnapshot$DocumentSnapshot = (id, document_id, sequence, cells, taken_at) =>
  new DocumentSnapshot(id, document_id, sequence, cells, taken_at);
export const DocumentSnapshot$isDocumentSnapshot = (value) =>
  value instanceof DocumentSnapshot;
export const DocumentSnapshot$DocumentSnapshot$id = (value) => value.id;
export const DocumentSnapshot$DocumentSnapshot$0 = (value) => value.id;
export const DocumentSnapshot$DocumentSnapshot$document_id = (value) =>
  value.document_id;
export const DocumentSnapshot$DocumentSnapshot$1 = (value) => value.document_id;
export const DocumentSnapshot$DocumentSnapshot$sequence = (value) =>
  value.sequence;
export const DocumentSnapshot$DocumentSnapshot$2 = (value) => value.sequence;
export const DocumentSnapshot$DocumentSnapshot$cells = (value) => value.cells;
export const DocumentSnapshot$DocumentSnapshot$3 = (value) => value.cells;
export const DocumentSnapshot$DocumentSnapshot$taken_at = (value) =>
  value.taken_at;
export const DocumentSnapshot$DocumentSnapshot$4 = (value) => value.taken_at;

export class SourceImage extends $CustomType {
  constructor(id, document_id, content_hash, imported_at) {
    super();
    this.id = id;
    this.document_id = document_id;
    this.content_hash = content_hash;
    this.imported_at = imported_at;
  }
}
export const SourceImage$SourceImage = (id, document_id, content_hash, imported_at) =>
  new SourceImage(id, document_id, content_hash, imported_at);
export const SourceImage$isSourceImage = (value) =>
  value instanceof SourceImage;
export const SourceImage$SourceImage$id = (value) => value.id;
export const SourceImage$SourceImage$0 = (value) => value.id;
export const SourceImage$SourceImage$document_id = (value) => value.document_id;
export const SourceImage$SourceImage$1 = (value) => value.document_id;
export const SourceImage$SourceImage$content_hash = (value) =>
  value.content_hash;
export const SourceImage$SourceImage$2 = (value) => value.content_hash;
export const SourceImage$SourceImage$imported_at = (value) => value.imported_at;
export const SourceImage$SourceImage$3 = (value) => value.imported_at;

export class AppSession extends $CustomType {
  constructor(id, started_at, network_available, offline_notice_shown) {
    super();
    this.id = id;
    this.started_at = started_at;
    this.network_available = network_available;
    this.offline_notice_shown = offline_notice_shown;
  }
}
export const AppSession$AppSession = (id, started_at, network_available, offline_notice_shown) =>
  new AppSession(id, started_at, network_available, offline_notice_shown);
export const AppSession$isAppSession = (value) => value instanceof AppSession;
export const AppSession$AppSession$id = (value) => value.id;
export const AppSession$AppSession$0 = (value) => value.id;
export const AppSession$AppSession$started_at = (value) => value.started_at;
export const AppSession$AppSession$1 = (value) => value.started_at;
export const AppSession$AppSession$network_available = (value) =>
  value.network_available;
export const AppSession$AppSession$2 = (value) => value.network_available;
export const AppSession$AppSession$offline_notice_shown = (value) =>
  value.offline_notice_shown;
export const AppSession$AppSession$3 = (value) => value.offline_notice_shown;

export function is_anonymous(user) {
  return !user.has_account;
}

function range_list_loop(loop$n, loop$acc) {
  while (true) {
    let n = loop$n;
    let acc = loop$acc;
    let $ = n <= 0;
    if ($) {
      return acc;
    } else {
      loop$n = n - 1;
      loop$acc = listPrepend(n - 1, acc);
    }
  }
}

function range_list(n) {
  return range_list_loop(n, $List$Empty$const);
}

/**
 * Build an empty width×height grid of empty cells, row-major.
 */
export function empty_grid(width, height) {
  return $list.flat_map(
    range_list(height),
    (y) => {
      return $list.map(
        range_list(width),
        (x) => {
          return new CellState(
            new CellPosition(x, y),
            $option.Option$None$const,
          );
        },
      );
    },
  );
}

function set_cell(cells, position, color) {
  if (cells instanceof $Empty) {
    return cells;
  } else {
    let cell = cells.head;
    let rest = cells.tail;
    let $ = isEqual(cell.position, position);
    if ($) {
      return listPrepend(new CellState(position, color), rest);
    } else {
      return listPrepend(cell, set_cell(rest, position, color));
    }
  }
}

/**
 * Apply an edit's changes to a grid (each change sets its cell to `after`).
 */
export function apply_edit(cells, edit) {
  return $list.fold(
    edit.changes,
    cells,
    (acc, change) => { return set_cell(acc, change.position, change.after); },
  );
}

export function cell_at(loop$cells, loop$position) {
  while (true) {
    let cells = loop$cells;
    let position = loop$position;
    if (cells instanceof $Empty) {
      return $option.Option$None$const;
    } else {
      let cell = cells.head;
      let rest = cells.tail;
      let $ = isEqual(cell.position, position);
      if ($) {
        return cell.color_index;
      } else {
        loop$cells = rest;
        loop$position = position;
      }
    }
  }
}
