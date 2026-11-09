import * as $int from "../../gleam_stdlib/gleam/int.mjs";
import * as $list from "../../gleam_stdlib/gleam/list.mjs";
import {
  Ok,
  Error,
  Empty as $Empty,
  List$Empty$const as $List$Empty$const,
  prepend as listPrepend,
  CustomType as $CustomType,
  makeError,
} from "../gleam.mjs";
import * as $config from "../sng/config.mjs";
import * as $stub from "../sng/stub.mjs";
import * as $types from "../sng/types.mjs";
import {
  AppSession,
  DocumentCommand,
  DocumentSnapshot,
  PatternDocument,
  SourceImage,
  Undo,
  apply_edit,
  empty_grid,
  CommandVerb$Draw$const,
  CommandVerb$Redo$const,
  CommandVerb$Undo$const,
} from "../sng/types.mjs";

const FILEPATH = "src/sng/store.gleam";

export class Store extends $CustomType {
  constructor(documents, commands, snapshots, sources, counter) {
    super();
    this.documents = documents;
    this.commands = commands;
    this.snapshots = snapshots;
    this.sources = sources;
    this.counter = counter;
  }
}
export const Store$Store = (documents, commands, snapshots, sources, counter) =>
  new Store(documents, commands, snapshots, sources, counter);
export const Store$isStore = (value) => value instanceof Store;
export const Store$Store$documents = (value) => value.documents;
export const Store$Store$0 = (value) => value.documents;
export const Store$Store$commands = (value) => value.commands;
export const Store$Store$1 = (value) => value.commands;
export const Store$Store$snapshots = (value) => value.snapshots;
export const Store$Store$2 = (value) => value.snapshots;
export const Store$Store$sources = (value) => value.sources;
export const Store$Store$3 = (value) => value.sources;
export const Store$Store$counter = (value) => value.counter;
export const Store$Store$4 = (value) => value.counter;

export class DocumentNotFound extends $CustomType {}
export const StoreError$DocumentNotFound$const = new DocumentNotFound();
export const StoreError$DocumentNotFound = () =>
  StoreError$DocumentNotFound$const;
export const StoreError$isDocumentNotFound = (value) =>
  value instanceof DocumentNotFound;

export class InvalidDimensions extends $CustomType {}
export const StoreError$InvalidDimensions$const = new InvalidDimensions();
export const StoreError$InvalidDimensions = () =>
  StoreError$InvalidDimensions$const;
export const StoreError$isInvalidDimensions = (value) =>
  value instanceof InvalidDimensions;

export class EmptyPalette extends $CustomType {}
export const StoreError$EmptyPalette$const = new EmptyPalette();
export const StoreError$EmptyPalette = () => StoreError$EmptyPalette$const;
export const StoreError$isEmptyPalette = (value) =>
  value instanceof EmptyPalette;

export class OutOfBounds extends $CustomType {}
export const StoreError$OutOfBounds$const = new OutOfBounds();
export const StoreError$OutOfBounds = () => StoreError$OutOfBounds$const;
export const StoreError$isOutOfBounds = (value) => value instanceof OutOfBounds;

export class NothingToUndo extends $CustomType {}
export const StoreError$NothingToUndo$const = new NothingToUndo();
export const StoreError$NothingToUndo = () => StoreError$NothingToUndo$const;
export const StoreError$isNothingToUndo = (value) =>
  value instanceof NothingToUndo;

export class NothingToRedo extends $CustomType {}
export const StoreError$NothingToRedo$const = new NothingToRedo();
export const StoreError$NothingToRedo = () => StoreError$NothingToRedo$const;
export const StoreError$isNothingToRedo = (value) =>
  value instanceof NothingToRedo;

export class EmptyName extends $CustomType {}
export const StoreError$EmptyName$const = new EmptyName();
export const StoreError$EmptyName = () => StoreError$EmptyName$const;
export const StoreError$isEmptyName = (value) => value instanceof EmptyName;

export class LibraryEntry extends $CustomType {
  constructor(document_id, name, thumbnail, last_edited) {
    super();
    this.document_id = document_id;
    this.name = name;
    this.thumbnail = thumbnail;
    this.last_edited = last_edited;
  }
}
export const LibraryEntry$LibraryEntry = (document_id, name, thumbnail, last_edited) =>
  new LibraryEntry(document_id, name, thumbnail, last_edited);
export const LibraryEntry$isLibraryEntry = (value) =>
  value instanceof LibraryEntry;
export const LibraryEntry$LibraryEntry$document_id = (value) =>
  value.document_id;
export const LibraryEntry$LibraryEntry$0 = (value) => value.document_id;
export const LibraryEntry$LibraryEntry$name = (value) => value.name;
export const LibraryEntry$LibraryEntry$1 = (value) => value.name;
export const LibraryEntry$LibraryEntry$thumbnail = (value) => value.thumbnail;
export const LibraryEntry$LibraryEntry$2 = (value) => value.thumbnail;
export const LibraryEntry$LibraryEntry$last_edited = (value) =>
  value.last_edited;
export const LibraryEntry$LibraryEntry$3 = (value) => value.last_edited;

export class EditorView extends $CustomType {
  constructor(document_id, name, width, height, cells, palette) {
    super();
    this.document_id = document_id;
    this.name = name;
    this.width = width;
    this.height = height;
    this.cells = cells;
    this.palette = palette;
  }
}
export const EditorView$EditorView = (document_id, name, width, height, cells, palette) =>
  new EditorView(document_id, name, width, height, cells, palette);
export const EditorView$isEditorView = (value) => value instanceof EditorView;
export const EditorView$EditorView$document_id = (value) => value.document_id;
export const EditorView$EditorView$0 = (value) => value.document_id;
export const EditorView$EditorView$name = (value) => value.name;
export const EditorView$EditorView$1 = (value) => value.name;
export const EditorView$EditorView$width = (value) => value.width;
export const EditorView$EditorView$2 = (value) => value.width;
export const EditorView$EditorView$height = (value) => value.height;
export const EditorView$EditorView$3 = (value) => value.height;
export const EditorView$EditorView$cells = (value) => value.cells;
export const EditorView$EditorView$4 = (value) => value.cells;
export const EditorView$EditorView$palette = (value) => value.palette;
export const EditorView$EditorView$5 = (value) => value.palette;

export function new$() {
  return new Store(
    $List$Empty$const,
    $List$Empty$const,
    $List$Empty$const,
    $List$Empty$const,
    0,
  );
}

function put_document(store, document) {
  return new Store(
    listPrepend(
      document,
      $list.filter(store.documents, (d) => { return d.id !== document.id; }),
    ),
    store.commands,
    store.snapshots,
    store.sources,
    store.counter,
  );
}

function fresh_id(store, prefix) {
  let counter = store.counter + 1;
  return [
    new Store(
      store.documents,
      store.commands,
      store.snapshots,
      store.sources,
      counter,
    ),
    (prefix + "-") + $int.to_string(counter),
  ];
}

export function create_blank(store, width, height, now) {
  let $ = (width >= 1) && (height >= 1);
  if ($) {
    let $1 = fresh_id(store, "doc");
    let store$1 = $1[0];
    let id = $1[1];
    let document$1 = new PatternDocument(
      id,
      "Untitled",
      width,
      height,
      empty_grid(width, height),
      $stub.default_stub_palette(),
      now,
      now,
    );
    return new Ok([put_document(store$1, document$1), document$1]);
  } else {
    return new Error(StoreError$InvalidDimensions$const);
  }
}

function put_source(store, source) {
  return new Store(
    store.documents,
    store.commands,
    store.snapshots,
    listPrepend(source, store.sources),
    store.counter,
  );
}

export function import_image_stub(store, file_name, image_bytes, now) {
  let grid = $stub.stub_convert(image_bytes);
  let $ = fresh_id(store, "doc");
  let store$1 = $[0];
  let doc_id = $[1];
  let $1 = fresh_id(store$1, "src");
  let store$2 = $1[0];
  let src_id = $1[1];
  let document$1 = new PatternDocument(
    doc_id,
    file_name,
    grid.width,
    grid.height,
    grid.cells,
    grid.palette,
    now,
    now,
  );
  let source = new SourceImage(
    src_id,
    doc_id,
    $stub.content_hash(image_bytes),
    now,
  );
  let _block;
  let _pipe = store$2;
  let _pipe$1 = put_document(_pipe, document$1);
  _block = put_source(_pipe$1, source);
  let store$3 = _block;
  return new Ok([store$3, document$1]);
}

function put_snapshot(store, snapshot) {
  return new Store(
    store.documents,
    store.commands,
    listPrepend(snapshot, store.snapshots),
    store.sources,
    store.counter,
  );
}

export function commands_of(store, document_id) {
  let _pipe = store.commands;
  let _pipe$1 = $list.filter(
    _pipe,
    (command) => { return command.document_id === document_id; },
  );
  return $list.sort(
    _pipe$1,
    (a, b) => { return $int.compare(a.sequence, b.sequence); },
  );
}

export function document(store, document_id) {
  let $ = $list.find(store.documents, (d) => { return d.id === document_id; });
  if ($ instanceof Ok) {
    return $;
  } else {
    return new Error(StoreError$DocumentNotFound$const);
  }
}

export function take_snapshot(store, document_id, now) {
  let $ = document(store, document_id);
  let $1 = commands_of(store, document_id);
  if ($ instanceof Ok) {
    if ($1 instanceof $Empty) {
      return store;
    } else {
      let document$1 = $[0];
      let $2 = fresh_id(store, "snap");
      let store$1 = $2[0];
      let id = $2[1];
      let snapshot = new DocumentSnapshot(
        id,
        document_id,
        $list.length(commands_of(store$1, document_id)),
        document$1.cells,
        now,
      );
      return put_snapshot(store$1, snapshot);
    }
  } else {
    return store;
  }
}

function list_last(list) {
  let $ = $list.last(list);
  let item;
  if ($ instanceof Ok) {
    item = $[0];
  } else {
    throw makeError(
      "let_assert",
      FILEPATH,
      "sng/store",
      504,
      "list_last",
      "Pattern match failed, no pattern matched the value.",
      {
        value: $,
        start: 14662,
        end: 14699,
        pattern_start: 14673,
        pattern_end: 14681
      }
    )
  }
  return item;
}

export function snapshots_of(store, document_id) {
  let _pipe = store.snapshots;
  let _pipe$1 = $list.filter(
    _pipe,
    (snapshot) => { return snapshot.document_id === document_id; },
  );
  return $list.sort(
    _pipe$1,
    (a, b) => { return $int.compare(a.sequence, b.sequence); },
  );
}

/**
 * Derived: commands committed since the latest snapshot.
 */
export function commands_since_last_snapshot(store, document_id) {
  let _block;
  let $ = snapshots_of(store, document_id);
  if ($ instanceof $Empty) {
    _block = 0;
  } else {
    let snapshots = $;
    _block = list_last(snapshots).sequence;
  }
  let since = _block;
  return $list.length(commands_of(store, document_id)) - since;
}

/**
 * Derived: the SnapshotTaken condition.
 */
export function pending_snapshot(store, document_id) {
  return commands_since_last_snapshot(store, document_id) >= $config.snapshot_interval_commands;
}

function check_snapshot(store, document_id, now) {
  let $ = pending_snapshot(store, document_id);
  if ($) {
    return take_snapshot(store, document_id, now);
  } else {
    return store;
  }
}

function put_command(store, command) {
  return new Store(
    store.documents,
    listPrepend(command, store.commands),
    store.snapshots,
    store.sources,
    store.counter,
  );
}

function commit_command(store, document, verb, edit, now) {
  let $ = fresh_id(store, "cmd");
  let store$1 = $[0];
  let command_id = $[1];
  let command = new DocumentCommand(
    command_id,
    document.id,
    $list.length(commands_of(store$1, document.id)) + 1,
    verb,
    edit,
    $stub.inverse_of(document.cells, edit),
    now,
  );
  let _pipe = store$1;
  let _pipe$1 = put_command(_pipe, command);
  return put_document(
    _pipe$1,
    new PatternDocument(
      document.id,
      document.name,
      document.width,
      document.height,
      apply_edit(document.cells, edit),
      document.palette,
      document.created_at,
      now,
    ),
  );
}

function all_in_bounds(document, edit) {
  return $list.all(
    edit.changes,
    (change) => {
      return (((change.position.x >= 0) && (change.position.x < document.width)) && (change.position.y >= 0)) && (change.position.y < document.height);
    },
  );
}

function result_guard_document(store, document_id, next) {
  let $ = document(store, document_id);
  if ($ instanceof Ok) {
    let document$1 = $[0];
    return next(document$1);
  } else {
    return $;
  }
}

export function draw(store, document_id, edit, now) {
  return result_guard_document(
    store,
    document_id,
    (document) => {
      let $ = document.palette;
      if ($ instanceof $Empty) {
        return new Error(StoreError$EmptyPalette$const);
      } else {
        let $1 = all_in_bounds(document, edit);
        if ($1) {
          return new Ok(
            (() => {
              let _pipe = commit_command(
                store,
                document,
                CommandVerb$Draw$const,
                edit,
                now,
              );
              return check_snapshot(_pipe, document_id, now);
            })(),
          );
        } else {
          return new Error(StoreError$OutOfBounds$const);
        }
      }
    },
  );
}

export function undo(store, document_id, now) {
  return result_guard_document(
    store,
    document_id,
    (document) => {
      let $ = commands_of(store, document_id);
      if ($ instanceof $Empty) {
        return new Error(StoreError$NothingToUndo$const);
      } else {
        let commands = $;
        let latest = list_last(commands);
        let $1 = latest.verb;
        if ($1 instanceof Undo) {
          return new Error(StoreError$NothingToUndo$const);
        } else {
          return new Ok(
            (() => {
              let _pipe = commit_command(
                store,
                document,
                CommandVerb$Undo$const,
                latest.inverse,
                now,
              );
              return check_snapshot(_pipe, document_id, now);
            })(),
          );
        }
      }
    },
  );
}

export function redo(store, document_id, now) {
  return result_guard_document(
    store,
    document_id,
    (document) => {
      let $ = commands_of(store, document_id);
      if ($ instanceof $Empty) {
        return new Error(StoreError$NothingToRedo$const);
      } else {
        let commands = $;
        let latest = list_last(commands);
        let $1 = latest.verb;
        if ($1 instanceof Undo) {
          return new Ok(
            (() => {
              let _pipe = commit_command(
                store,
                document,
                CommandVerb$Redo$const,
                latest.inverse,
                now,
              );
              return check_snapshot(_pipe, document_id, now);
            })(),
          );
        } else {
          return new Error(StoreError$NothingToRedo$const);
        }
      }
    },
  );
}

/**
 * Surface provides guard: Undo is available iff the log is non-empty and
 * its newest entry is not an undo entry.
 */
export function can_undo(store, document_id) {
  let $ = commands_of(store, document_id);
  if ($ instanceof $Empty) {
    return false;
  } else {
    let commands = $;
    return !(list_last(commands).verb instanceof Undo);
  }
}

/**
 * Surface provides guard: Redo is available iff the newest entry is an
 * undo entry (any edit since clears the redo path — linear history).
 */
export function can_redo(store, document_id) {
  let $ = commands_of(store, document_id);
  if ($ instanceof $Empty) {
    return false;
  } else {
    let commands = $;
    return list_last(commands).verb instanceof Undo;
  }
}

export function rename(store, document_id, name, now) {
  return result_guard_document(
    store,
    document_id,
    (document) => {
      let $ = name === "";
      if ($) {
        return new Error(StoreError$EmptyName$const);
      } else {
        return new Ok(
          put_document(
            store,
            new PatternDocument(
              document.id,
              name,
              document.width,
              document.height,
              document.cells,
              document.palette,
              document.created_at,
              now,
            ),
          ),
        );
      }
    },
  );
}

export function duplicate(store, document_id, now) {
  return result_guard_document(
    store,
    document_id,
    (document) => {
      let $ = fresh_id(store, "doc");
      let store$1 = $[0];
      let id = $[1];
      let copy = new PatternDocument(
        id,
        document.name + " (copy)",
        document.width,
        document.height,
        document.cells,
        document.palette,
        now,
        now,
      );
      return new Ok([put_document(store$1, copy), copy]);
    },
  );
}

export function delete$(store, document_id) {
  return result_guard_document(
    store,
    document_id,
    (_) => {
      return new Ok(
        new Store(
          $list.filter(store.documents, (d) => { return d.id !== document_id; }),
          $list.filter(
            store.commands,
            (c) => { return c.document_id !== document_id; },
          ),
          $list.filter(
            store.snapshots,
            (s) => { return s.document_id !== document_id; },
          ),
          $list.filter(
            store.sources,
            (s) => { return s.document_id !== document_id; },
          ),
          store.counter,
        ),
      );
    },
  );
}

/**
 * Fold the command log over the latest snapshot to reconstruct the grid.
 */
export function materialize(store, document) {
  let _block;
  let $ = snapshots_of(store, document.id);
  if ($ instanceof $Empty) {
    _block = empty_grid(document.width, document.height);
  } else {
    let snapshots = $;
    _block = list_last(snapshots).cells;
  }
  let base = _block;
  let _block$1;
  let $1 = snapshots_of(store, document.id);
  if ($1 instanceof $Empty) {
    _block$1 = 0;
  } else {
    let snapshots = $1;
    _block$1 = list_last(snapshots).sequence;
  }
  let since = _block$1;
  let _pipe = commands_of(store, document.id);
  let _pipe$1 = $list.filter(
    _pipe,
    (command) => { return command.sequence > since; },
  );
  return $list.fold(
    _pipe$1,
    base,
    (cells, command) => { return apply_edit(cells, command.edit); },
  );
}

export function source_of(store, document_id) {
  let $ = $list.find(
    store.sources,
    (s) => { return s.document_id === document_id; },
  );
  if ($ instanceof Ok) {
    return $;
  } else {
    return new Error(StoreError$DocumentNotFound$const);
  }
}

export function sequences_unique(store, document_id) {
  let sequences = $list.map(
    commands_of(store, document_id),
    (c) => { return c.sequence; },
  );
  return $list.length(sequences) === $list.length($list.unique(sequences));
}

export function library_view(store, now) {
  let _pipe = store.documents;
  return $list.map(
    _pipe,
    (document) => {
      return new LibraryEntry(
        document.id,
        document.name,
        $stub.render_thumbnail(document, now),
        document.last_edited,
      );
    },
  );
}

export function editor_view(store, document_id) {
  return result_guard_document(
    store,
    document_id,
    (document) => {
      return new Ok(
        new EditorView(
          document.id,
          document.name,
          document.width,
          document.height,
          document.cells,
          document.palette,
        ),
      );
    },
  );
}

export function new_session(session_id, started_at, network_available) {
  return new AppSession(session_id, started_at, network_available, false);
}

export function offline_detected(session) {
  return new AppSession(session.id, session.started_at, false, true);
}

export function online_restored(session) {
  return new AppSession(session.id, session.started_at, true, false);
}
