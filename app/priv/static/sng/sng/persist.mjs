import * as $json from "../../gleam_json/gleam/json.mjs";
import * as $decode from "../../gleam_stdlib/gleam/dynamic/decode.mjs";
import * as $option from "../../gleam_stdlib/gleam/option.mjs";
import {
  Ok,
  Error,
  List$Empty$const as $List$Empty$const,
  prepend as listPrepend,
  CustomType as $CustomType,
} from "../gleam.mjs";
import * as $store from "../sng/store.mjs";
import * as $types from "../sng/types.mjs";
import {
  CellChange,
  CellPosition,
  CellState,
  DocumentCommand,
  DocumentEdit,
  DocumentSnapshot,
  Draw,
  PaletteEntry,
  PatternDocument,
  SourceImage,
  Undo,
  CommandVerb$Draw$const,
  CommandVerb$Redo$const,
  CommandVerb$Undo$const,
} from "../sng/types.mjs";

export class Corrupt extends $CustomType {
  constructor($0) {
    super();
    this[0] = $0;
  }
}
export const PersistError$Corrupt = ($0) => new Corrupt($0);
export const PersistError$isCorrupt = (value) => value instanceof Corrupt;
export const PersistError$Corrupt$0 = (value) => value[0];

function encode_source(source) {
  return $json.object(
    listPrepend(
      ["id", $json.string(source.id)],
      listPrepend(
        ["document_id", $json.string(source.document_id)],
        listPrepend(
          ["content_hash", $json.string(source.content_hash)],
          listPrepend(
            ["imported_at", $json.int(source.imported_at)],
            $List$Empty$const,
          ),
        ),
      ),
    ),
  );
}

function encode_optional_int(value) {
  if (value instanceof $option.Some) {
    let i = value[0];
    return $json.int(i);
  } else {
    return $json.null$();
  }
}

function encode_cell(cell) {
  return $json.object(
    listPrepend(
      ["x", $json.int(cell.position.x)],
      listPrepend(
        ["y", $json.int(cell.position.y)],
        listPrepend(
          ["color", encode_optional_int(cell.color_index)],
          $List$Empty$const,
        ),
      ),
    ),
  );
}

function encode_snapshot(snapshot) {
  return $json.object(
    listPrepend(
      ["id", $json.string(snapshot.id)],
      listPrepend(
        ["document_id", $json.string(snapshot.document_id)],
        listPrepend(
          ["sequence", $json.int(snapshot.sequence)],
          listPrepend(
            ["cells", $json.array(snapshot.cells, encode_cell)],
            listPrepend(
              ["taken_at", $json.int(snapshot.taken_at)],
              $List$Empty$const,
            ),
          ),
        ),
      ),
    ),
  );
}

function encode_change(change) {
  return $json.object(
    listPrepend(
      ["x", $json.int(change.position.x)],
      listPrepend(
        ["y", $json.int(change.position.y)],
        listPrepend(
          ["before", encode_optional_int(change.before)],
          listPrepend(
            ["after", encode_optional_int(change.after)],
            $List$Empty$const,
          ),
        ),
      ),
    ),
  );
}

function encode_edit(edit) {
  return $json.object(
    listPrepend(
      ["changes", $json.array(edit.changes, encode_change)],
      $List$Empty$const,
    ),
  );
}

function encode_verb(verb) {
  if (verb instanceof Draw) {
    return $json.string("draw");
  } else if (verb instanceof Undo) {
    return $json.string("undo");
  } else {
    return $json.string("redo");
  }
}

function encode_command(command) {
  return $json.object(
    listPrepend(
      ["id", $json.string(command.id)],
      listPrepend(
        ["document_id", $json.string(command.document_id)],
        listPrepend(
          ["sequence", $json.int(command.sequence)],
          listPrepend(
            ["verb", encode_verb(command.verb)],
            listPrepend(
              ["edit", encode_edit(command.edit)],
              listPrepend(
                ["inverse", encode_edit(command.inverse)],
                listPrepend(
                  ["committed_at", $json.int(command.committed_at)],
                  $List$Empty$const,
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function encode_palette_entry(entry) {
  return $json.object(
    listPrepend(
      ["name", $json.string(entry.name)],
      listPrepend(["rgb", $json.string(entry.rgb)], $List$Empty$const),
    ),
  );
}

function encode_document(document) {
  return $json.object(
    listPrepend(
      ["id", $json.string(document.id)],
      listPrepend(
        ["name", $json.string(document.name)],
        listPrepend(
          ["width", $json.int(document.width)],
          listPrepend(
            ["height", $json.int(document.height)],
            listPrepend(
              ["cells", $json.array(document.cells, encode_cell)],
              listPrepend(
                ["palette", $json.array(document.palette, encode_palette_entry)],
                listPrepend(
                  ["created_at", $json.int(document.created_at)],
                  listPrepend(
                    ["last_edited", $json.int(document.last_edited)],
                    $List$Empty$const,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function encode_store(store) {
  return $json.object(
    listPrepend(
      ["documents", $json.array(store.documents, encode_document)],
      listPrepend(
        ["commands", $json.array(store.commands, encode_command)],
        listPrepend(
          ["snapshots", $json.array(store.snapshots, encode_snapshot)],
          listPrepend(
            ["sources", $json.array(store.sources, encode_source)],
            listPrepend(
              ["counter", $json.int(store.counter)],
              $List$Empty$const,
            ),
          ),
        ),
      ),
    ),
  );
}

export function serialize(store) {
  return $json.to_string(encode_store(store));
}

function source_decoder() {
  return $decode.field(
    "id",
    $decode.string,
    (id) => {
      return $decode.field(
        "document_id",
        $decode.string,
        (document_id) => {
          return $decode.field(
            "content_hash",
            $decode.string,
            (content_hash) => {
              return $decode.field(
                "imported_at",
                $decode.int,
                (imported_at) => {
                  return $decode.success(
                    new SourceImage(id, document_id, content_hash, imported_at),
                  );
                },
              );
            },
          );
        },
      );
    },
  );
}

function cell_decoder() {
  return $decode.field(
    "x",
    $decode.int,
    (x) => {
      return $decode.field(
        "y",
        $decode.int,
        (y) => {
          return $decode.field(
            "color",
            $decode.optional($decode.int),
            (color) => {
              return $decode.success(
                new CellState(new CellPosition(x, y), color),
              );
            },
          );
        },
      );
    },
  );
}

function snapshot_decoder() {
  return $decode.field(
    "id",
    $decode.string,
    (id) => {
      return $decode.field(
        "document_id",
        $decode.string,
        (document_id) => {
          return $decode.field(
            "sequence",
            $decode.int,
            (sequence) => {
              return $decode.field(
                "cells",
                $decode.list(cell_decoder()),
                (cells) => {
                  return $decode.field(
                    "taken_at",
                    $decode.int,
                    (taken_at) => {
                      return $decode.success(
                        new DocumentSnapshot(
                          id,
                          document_id,
                          sequence,
                          cells,
                          taken_at,
                        ),
                      );
                    },
                  );
                },
              );
            },
          );
        },
      );
    },
  );
}

function change_decoder() {
  return $decode.field(
    "x",
    $decode.int,
    (x) => {
      return $decode.field(
        "y",
        $decode.int,
        (y) => {
          return $decode.field(
            "before",
            $decode.optional($decode.int),
            (before) => {
              return $decode.field(
                "after",
                $decode.optional($decode.int),
                (after) => {
                  return $decode.success(
                    new CellChange(new CellPosition(x, y), before, after),
                  );
                },
              );
            },
          );
        },
      );
    },
  );
}

function edit_decoder() {
  return $decode.field(
    "changes",
    $decode.list(change_decoder()),
    (changes) => { return $decode.success(new DocumentEdit(changes)); },
  );
}

function verb_decoder() {
  let _pipe = $decode.string;
  return $decode.then$(
    _pipe,
    (verb) => {
      if (verb === "draw") {
        return $decode.success(CommandVerb$Draw$const);
      } else if (verb === "undo") {
        return $decode.success(CommandVerb$Undo$const);
      } else if (verb === "redo") {
        return $decode.success(CommandVerb$Redo$const);
      } else {
        return $decode.failure(CommandVerb$Draw$const, "draw | undo | redo");
      }
    },
  );
}

function command_decoder() {
  return $decode.field(
    "id",
    $decode.string,
    (id) => {
      return $decode.field(
        "document_id",
        $decode.string,
        (document_id) => {
          return $decode.field(
            "sequence",
            $decode.int,
            (sequence) => {
              return $decode.field(
                "verb",
                verb_decoder(),
                (verb) => {
                  return $decode.field(
                    "edit",
                    edit_decoder(),
                    (edit) => {
                      return $decode.field(
                        "inverse",
                        edit_decoder(),
                        (inverse) => {
                          return $decode.field(
                            "committed_at",
                            $decode.int,
                            (committed_at) => {
                              return $decode.success(
                                new DocumentCommand(
                                  id,
                                  document_id,
                                  sequence,
                                  verb,
                                  edit,
                                  inverse,
                                  committed_at,
                                ),
                              );
                            },
                          );
                        },
                      );
                    },
                  );
                },
              );
            },
          );
        },
      );
    },
  );
}

function palette_entry_decoder() {
  return $decode.field(
    "name",
    $decode.string,
    (name) => {
      return $decode.field(
        "rgb",
        $decode.string,
        (rgb) => { return $decode.success(new PaletteEntry(name, rgb)); },
      );
    },
  );
}

function document_decoder() {
  return $decode.field(
    "id",
    $decode.string,
    (id) => {
      return $decode.field(
        "name",
        $decode.string,
        (name) => {
          return $decode.field(
            "width",
            $decode.int,
            (width) => {
              return $decode.field(
                "height",
                $decode.int,
                (height) => {
                  return $decode.field(
                    "cells",
                    $decode.list(cell_decoder()),
                    (cells) => {
                      return $decode.field(
                        "palette",
                        $decode.list(palette_entry_decoder()),
                        (palette) => {
                          return $decode.field(
                            "created_at",
                            $decode.int,
                            (created_at) => {
                              return $decode.field(
                                "last_edited",
                                $decode.int,
                                (last_edited) => {
                                  return $decode.success(
                                    new PatternDocument(
                                      id,
                                      name,
                                      width,
                                      height,
                                      cells,
                                      palette,
                                      created_at,
                                      last_edited,
                                    ),
                                  );
                                },
                              );
                            },
                          );
                        },
                      );
                    },
                  );
                },
              );
            },
          );
        },
      );
    },
  );
}

function store_decoder() {
  return $decode.field(
    "documents",
    $decode.list(document_decoder()),
    (documents) => {
      return $decode.field(
        "commands",
        $decode.list(command_decoder()),
        (commands) => {
          return $decode.field(
            "snapshots",
            $decode.list(snapshot_decoder()),
            (snapshots) => {
              return $decode.field(
                "sources",
                $decode.list(source_decoder()),
                (sources) => {
                  return $decode.field(
                    "counter",
                    $decode.int,
                    (counter) => {
                      return $decode.success(
                        new $store.Store(
                          documents,
                          commands,
                          snapshots,
                          sources,
                          counter,
                        ),
                      );
                    },
                  );
                },
              );
            },
          );
        },
      );
    },
  );
}

export function deserialize(payload) {
  let $ = $json.parse(payload, store_decoder());
  if ($ instanceof Ok) {
    return $;
  } else {
    return new Error(new Corrupt("store payload did not decode"));
  }
}
