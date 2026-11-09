import * as $dynamic from "../gleam_stdlib/gleam/dynamic.mjs";
import * as $decode from "../gleam_stdlib/gleam/dynamic/decode.mjs";
import * as $int from "../gleam_stdlib/gleam/int.mjs";
import * as $list from "../gleam_stdlib/gleam/list.mjs";
import * as $option from "../gleam_stdlib/gleam/option.mjs";
import { None, Some, Option$None$const } from "../gleam_stdlib/gleam/option.mjs";
import * as $lustre from "../lustre/lustre.mjs";
import * as $attribute from "../lustre/lustre/attribute.mjs";
import * as $effect from "../lustre/lustre/effect.mjs";
import * as $element from "../lustre/lustre/element.mjs";
import * as $html from "../lustre/lustre/element/html.mjs";
import * as $event from "../lustre/lustre/event.mjs";
import {
  Ok,
  Empty as $Empty,
  List$Empty$const as $List$Empty$const,
  prepend as listPrepend,
  CustomType as $CustomType,
  makeError,
  isEqual,
} from "./gleam.mjs";
import * as $browser_ffi from "./sng/browser_ffi.mjs";
import * as $config from "./sng/config.mjs";
import * as $persist from "./sng/persist.mjs";
import * as $persist_ffi from "./sng/persist_ffi.mjs";
import * as $store from "./sng/store.mjs";
import * as $types from "./sng/types.mjs";
import { CellChange, CellPosition, DocumentEdit } from "./sng/types.mjs";
import * as $pdf from "./sng/ui/pdf.mjs";

const FILEPATH = "src/sng.gleam";

class Model extends $CustomType {
  constructor(store, session, route, creating, create_width, create_height, renaming, rename_value, pending_delete, pencil_active, stroke) {
    super();
    this.store = store;
    this.session = session;
    this.route = route;
    this.creating = creating;
    this.create_width = create_width;
    this.create_height = create_height;
    this.renaming = renaming;
    this.rename_value = rename_value;
    this.pending_delete = pending_delete;
    this.pencil_active = pencil_active;
    this.stroke = stroke;
  }
}

class Library extends $CustomType {}
const Route$Library$const = new Library();

class Editor extends $CustomType {
  constructor(id) {
    super();
    this.id = id;
  }
}

class ImportedFile extends $CustomType {
  constructor(name, bytes) {
    super();
    this.name = name;
    this.bytes = bytes;
  }
}

class StoreLoaded extends $CustomType {
  constructor($0) {
    super();
    this[0] = $0;
  }
}

class CreateFormToggled extends $CustomType {}
const Msg$CreateFormToggled$const = new CreateFormToggled();

class CreateWidthChanged extends $CustomType {
  constructor($0) {
    super();
    this[0] = $0;
  }
}

class CreateHeightChanged extends $CustomType {
  constructor($0) {
    super();
    this[0] = $0;
  }
}

class CreateSubmitted extends $CustomType {}
const Msg$CreateSubmitted$const = new CreateSubmitted();

class FilePicked extends $CustomType {
  constructor($0) {
    super();
    this[0] = $0;
  }
}

class DocumentOpened extends $CustomType {
  constructor($0) {
    super();
    this[0] = $0;
  }
}

class BackToLibrary extends $CustomType {}
const Msg$BackToLibrary$const = new BackToLibrary();

class RenameClicked extends $CustomType {
  constructor($0) {
    super();
    this[0] = $0;
  }
}

class RenameChanged extends $CustomType {
  constructor($0) {
    super();
    this[0] = $0;
  }
}

class RenameCommitted extends $CustomType {}
const Msg$RenameCommitted$const = new RenameCommitted();

class DuplicateClicked extends $CustomType {
  constructor($0) {
    super();
    this[0] = $0;
  }
}

class DeleteClicked extends $CustomType {
  constructor($0) {
    super();
    this[0] = $0;
  }
}

class DeleteConfirmed extends $CustomType {}
const Msg$DeleteConfirmed$const = new DeleteConfirmed();

class DeleteCancelled extends $CustomType {}
const Msg$DeleteCancelled$const = new DeleteCancelled();

class PencilActivated extends $CustomType {}
const Msg$PencilActivated$const = new PencilActivated();

class StrokeStarted extends $CustomType {
  constructor(id, x, y) {
    super();
    this.id = id;
    this.x = x;
    this.y = y;
  }
}

class StrokeMoved extends $CustomType {
  constructor(id, x, y) {
    super();
    this.id = id;
    this.x = x;
    this.y = y;
  }
}

class StrokeEnded extends $CustomType {}
const Msg$StrokeEnded$const = new StrokeEnded();

class UndoClicked extends $CustomType {}
const Msg$UndoClicked$const = new UndoClicked();

class RedoClicked extends $CustomType {}
const Msg$RedoClicked$const = new RedoClicked();

class ExportClicked extends $CustomType {}
const Msg$ExportClicked$const = new ExportClicked();

class ConnectivityChanged extends $CustomType {
  constructor($0) {
    super();
    this[0] = $0;
  }
}

const import_input_id = "import-image";

const default_grid_size = 8;

function init(_) {
  let now = $browser_ffi.now_ms();
  return [
    new Model(
      $store.new$(),
      $store.new_session("session-1", now, $browser_ffi.online()),
      Route$Library$const,
      false,
      $int.to_string(default_grid_size),
      $int.to_string(default_grid_size),
      Option$None$const,
      "",
      Option$None$const,
      true,
      $List$Empty$const,
    ),
    $effect.batch(
      listPrepend(
        $effect.from(
          (dispatch) => {
            return $persist_ffi.load(
              (payload) => { return dispatch(new StoreLoaded(payload)); },
            );
          },
        ),
        listPrepend(
          $effect.from(
            (dispatch) => {
              return $browser_ffi.watch_connectivity(
                (online) => { return dispatch(new ConnectivityChanged(online)); },
                $config.offline_indicator_deadline_ms,
              );
            },
          ),
          listPrepend(
            $effect.from(
              (dispatch) => {
                return $browser_ffi.watch_pointer_end(
                  () => { return dispatch(Msg$StrokeEnded$const); },
                );
              },
            ),
            listPrepend(
              $effect.from(
                (_) => { return $browser_ffi.register_service_worker("/sw.js"); },
              ),
              listPrepend(
                $effect.after_paint(
                  (dispatch, _) => {
                    return $browser_ffi.attach_file_input(
                      import_input_id,
                      (file) => { return dispatch(new FilePicked(file)); },
                    );
                  },
                ),
                $List$Empty$const,
              ),
            ),
          ),
        ),
      ),
    ),
  ];
}

/**
 * A committed gesture/operation is durable before it is acknowledged
 * (CrashRecovery, NFR-A3): every store mutation is persisted immediately.
 * 
 * @ignore
 */
function persist(new_store) {
  return $effect.from(
    (_) => { return $persist_ffi.save($persist.serialize(new_store)); },
  );
}

function imported_file_decoder() {
  return $decode.field(
    "name",
    $decode.string,
    (name) => {
      return $decode.field(
        "bytes",
        $decode.list($decode.int),
        (bytes) => { return $decode.success(new ImportedFile(name, bytes)); },
      );
    },
  );
}

function or_default(result, default$) {
  if (result instanceof Ok) {
    let value = result[0];
    return value;
  } else {
    return default$;
  }
}

function decode_store(payload) {
  let $ = $decode.run(payload, $decode.optional($decode.string));
  if ($ instanceof Ok) {
    let $1 = $[0];
    if ($1 instanceof Some) {
      let json = $1[0];
      let $2 = $persist.deserialize(json);
      if ($2 instanceof Ok) {
        let loaded = $2[0];
        return loaded;
      } else {
        return $store.new$();
      }
    } else {
      return $store.new$();
    }
  } else {
    return $store.new$();
  }
}

function update(model, msg) {
  let now = $browser_ffi.now_ms();
  if (msg instanceof StoreLoaded) {
    let payload = msg[0];
    return [
      new Model(
        decode_store(payload),
        model.session,
        model.route,
        model.creating,
        model.create_width,
        model.create_height,
        model.renaming,
        model.rename_value,
        model.pending_delete,
        model.pencil_active,
        model.stroke,
      ),
      $effect.none(),
    ];
  } else if (msg instanceof CreateFormToggled) {
    return [
      new Model(
        model.store,
        model.session,
        model.route,
        !model.creating,
        model.create_width,
        model.create_height,
        model.renaming,
        model.rename_value,
        model.pending_delete,
        model.pencil_active,
        model.stroke,
      ),
      $effect.none(),
    ];
  } else if (msg instanceof CreateWidthChanged) {
    let value = msg[0];
    return [
      new Model(
        model.store,
        model.session,
        model.route,
        model.creating,
        value,
        model.create_height,
        model.renaming,
        model.rename_value,
        model.pending_delete,
        model.pencil_active,
        model.stroke,
      ),
      $effect.none(),
    ];
  } else if (msg instanceof CreateHeightChanged) {
    let value = msg[0];
    return [
      new Model(
        model.store,
        model.session,
        model.route,
        model.creating,
        model.create_width,
        value,
        model.renaming,
        model.rename_value,
        model.pending_delete,
        model.pencil_active,
        model.stroke,
      ),
      $effect.none(),
    ];
  } else if (msg instanceof CreateSubmitted) {
    let _block;
    let _pipe = $int.parse(model.create_width);
    _block = or_default(_pipe, default_grid_size);
    let width = _block;
    let _block$1;
    let _pipe$1 = $int.parse(model.create_height);
    _block$1 = or_default(_pipe$1, default_grid_size);
    let height = _block$1;
    let $ = $store.create_blank(model.store, width, height, now);
    if ($ instanceof Ok) {
      let new_store = $[0][0];
      let document = $[0][1];
      return [
        new Model(
          new_store,
          model.session,
          new Editor(document.id),
          false,
          model.create_width,
          model.create_height,
          model.renaming,
          model.rename_value,
          model.pending_delete,
          model.pencil_active,
          model.stroke,
        ),
        persist(new_store),
      ];
    } else {
      return [model, $effect.none()];
    }
  } else if (msg instanceof FilePicked) {
    let file = msg[0];
    let $ = $decode.run(file, imported_file_decoder());
    if ($ instanceof Ok) {
      let name = $[0].name;
      let bytes = $[0].bytes;
      let $1 = $store.import_image_stub(model.store, name, bytes, now);
      if ($1 instanceof Ok) {
        let new_store = $1[0][0];
        return [
          new Model(
            new_store,
            model.session,
            model.route,
            model.creating,
            model.create_width,
            model.create_height,
            model.renaming,
            model.rename_value,
            model.pending_delete,
            model.pencil_active,
            model.stroke,
          ),
          persist(new_store),
        ];
      } else {
        return [model, $effect.none()];
      }
    } else {
      return [model, $effect.none()];
    }
  } else if (msg instanceof DocumentOpened) {
    let id = msg[0];
    return [
      new Model(
        model.store,
        model.session,
        new Editor(id),
        model.creating,
        model.create_width,
        model.create_height,
        model.renaming,
        model.rename_value,
        model.pending_delete,
        model.pencil_active,
        $List$Empty$const,
      ),
      $effect.none(),
    ];
  } else if (msg instanceof BackToLibrary) {
    return [
      new Model(
        model.store,
        model.session,
        Route$Library$const,
        model.creating,
        model.create_width,
        model.create_height,
        Option$None$const,
        model.rename_value,
        model.pending_delete,
        model.pencil_active,
        $List$Empty$const,
      ),
      $effect.none(),
    ];
  } else if (msg instanceof RenameClicked) {
    let id = msg[0];
    let _block;
    let $ = $store.document(model.store, id);
    if ($ instanceof Ok) {
      let document = $[0];
      _block = document.name;
    } else {
      _block = "";
    }
    let name = _block;
    return [
      new Model(
        model.store,
        model.session,
        model.route,
        model.creating,
        model.create_width,
        model.create_height,
        new Some(id),
        name,
        model.pending_delete,
        model.pencil_active,
        model.stroke,
      ),
      $effect.none(),
    ];
  } else if (msg instanceof RenameChanged) {
    let value = msg[0];
    return [
      new Model(
        model.store,
        model.session,
        model.route,
        model.creating,
        model.create_width,
        model.create_height,
        model.renaming,
        value,
        model.pending_delete,
        model.pencil_active,
        model.stroke,
      ),
      $effect.none(),
    ];
  } else if (msg instanceof RenameCommitted) {
    let $ = model.renaming;
    if ($ instanceof Some) {
      let id = $[0];
      let $1 = $store.rename(model.store, id, model.rename_value, now);
      if ($1 instanceof Ok) {
        let new_store = $1[0];
        return [
          new Model(
            new_store,
            model.session,
            model.route,
            model.creating,
            model.create_width,
            model.create_height,
            Option$None$const,
            model.rename_value,
            model.pending_delete,
            model.pencil_active,
            model.stroke,
          ),
          persist(new_store),
        ];
      } else {
        return [model, $effect.none()];
      }
    } else {
      return [model, $effect.none()];
    }
  } else if (msg instanceof DuplicateClicked) {
    let id = msg[0];
    let $ = $store.duplicate(model.store, id, now);
    if ($ instanceof Ok) {
      let new_store = $[0][0];
      return [
        new Model(
          new_store,
          model.session,
          model.route,
          model.creating,
          model.create_width,
          model.create_height,
          model.renaming,
          model.rename_value,
          model.pending_delete,
          model.pencil_active,
          model.stroke,
        ),
        persist(new_store),
      ];
    } else {
      return [model, $effect.none()];
    }
  } else if (msg instanceof DeleteClicked) {
    let id = msg[0];
    return [
      new Model(
        model.store,
        model.session,
        model.route,
        model.creating,
        model.create_width,
        model.create_height,
        model.renaming,
        model.rename_value,
        new Some(id),
        model.pencil_active,
        model.stroke,
      ),
      $effect.none(),
    ];
  } else if (msg instanceof DeleteConfirmed) {
    let $ = model.pending_delete;
    if ($ instanceof Some) {
      let id = $[0];
      let $1 = $store.delete$(model.store, id);
      if ($1 instanceof Ok) {
        let new_store = $1[0];
        return [
          new Model(
            new_store,
            model.session,
            model.route,
            model.creating,
            model.create_width,
            model.create_height,
            model.renaming,
            model.rename_value,
            Option$None$const,
            model.pencil_active,
            model.stroke,
          ),
          persist(new_store),
        ];
      } else {
        return [model, $effect.none()];
      }
    } else {
      return [model, $effect.none()];
    }
  } else if (msg instanceof DeleteCancelled) {
    return [
      new Model(
        model.store,
        model.session,
        model.route,
        model.creating,
        model.create_width,
        model.create_height,
        model.renaming,
        model.rename_value,
        Option$None$const,
        model.pencil_active,
        model.stroke,
      ),
      $effect.none(),
    ];
  } else if (msg instanceof PencilActivated) {
    return [
      new Model(
        model.store,
        model.session,
        model.route,
        model.creating,
        model.create_width,
        model.create_height,
        model.renaming,
        model.rename_value,
        model.pending_delete,
        true,
        model.stroke,
      ),
      $effect.none(),
    ];
  } else if (msg instanceof StrokeStarted) {
    let id = msg.id;
    let x = msg.x;
    let y = msg.y;
    let $ = model.pencil_active;
    if ($) {
      return [
        new Model(
          model.store,
          model.session,
          new Editor(id),
          model.creating,
          model.create_width,
          model.create_height,
          model.renaming,
          model.rename_value,
          model.pending_delete,
          model.pencil_active,
          listPrepend(new CellPosition(x, y), $List$Empty$const),
        ),
        $effect.none(),
      ];
    } else {
      return [model, $effect.none()];
    }
  } else if (msg instanceof StrokeMoved) {
    let id = msg.id;
    let x = msg.x;
    let y = msg.y;
    let position = new CellPosition(x, y);
    let $ = (isEqual(model.route, new Editor(id))) && !$list.contains(
      model.stroke,
      position,
    );
    if ($) {
      return [
        new Model(
          model.store,
          model.session,
          model.route,
          model.creating,
          model.create_width,
          model.create_height,
          model.renaming,
          model.rename_value,
          model.pending_delete,
          model.pencil_active,
          listPrepend(position, model.stroke),
        ),
        $effect.none(),
      ];
    } else {
      return [model, $effect.none()];
    }
  } else if (msg instanceof StrokeEnded) {
    let $ = model.route;
    let $1 = model.stroke;
    if ($ instanceof Editor) {
      if ($1 instanceof $Empty) {
        return [
          new Model(
            model.store,
            model.session,
            model.route,
            model.creating,
            model.create_width,
            model.create_height,
            model.renaming,
            model.rename_value,
            model.pending_delete,
            model.pencil_active,
            $List$Empty$const,
          ),
          $effect.none(),
        ];
      } else {
        let id = $.id;
        let $2 = $store.document(model.store, id);
        let document;
        if ($2 instanceof Ok) {
          document = $2[0];
        } else {
          throw makeError(
            "let_assert",
            FILEPATH,
            "sng",
            315,
            "update",
            "Pattern match failed, no pattern matched the value.",
            {
              value: $2,
              start: 9175,
              end: 9232,
              pattern_start: 9186,
              pattern_end: 9198
            }
          )
        }
        let changes = $list.map(
          $list.reverse(model.stroke),
          (position) => {
            return new CellChange(
              position,
              $types.cell_at(document.cells, position),
              new Some(0),
            );
          },
        );
        let $3 = $store.draw(model.store, id, new DocumentEdit(changes), now);
        if ($3 instanceof Ok) {
          let new_store = $3[0];
          return [
            new Model(
              new_store,
              model.session,
              model.route,
              model.creating,
              model.create_width,
              model.create_height,
              model.renaming,
              model.rename_value,
              model.pending_delete,
              model.pencil_active,
              $List$Empty$const,
            ),
            persist(new_store),
          ];
        } else {
          return [
            new Model(
              model.store,
              model.session,
              model.route,
              model.creating,
              model.create_width,
              model.create_height,
              model.renaming,
              model.rename_value,
              model.pending_delete,
              model.pencil_active,
              $List$Empty$const,
            ),
            $effect.none(),
          ];
        }
      }
    } else {
      return [
        new Model(
          model.store,
          model.session,
          model.route,
          model.creating,
          model.create_width,
          model.create_height,
          model.renaming,
          model.rename_value,
          model.pending_delete,
          model.pencil_active,
          $List$Empty$const,
        ),
        $effect.none(),
      ];
    }
  } else if (msg instanceof UndoClicked) {
    let $ = model.route;
    if ($ instanceof Library) {
      return [model, $effect.none()];
    } else {
      let id = $.id;
      let $1 = $store.undo(model.store, id, now);
      if ($1 instanceof Ok) {
        let new_store = $1[0];
        return [
          new Model(
            new_store,
            model.session,
            model.route,
            model.creating,
            model.create_width,
            model.create_height,
            model.renaming,
            model.rename_value,
            model.pending_delete,
            model.pencil_active,
            model.stroke,
          ),
          persist(new_store),
        ];
      } else {
        return [model, $effect.none()];
      }
    }
  } else if (msg instanceof RedoClicked) {
    let $ = model.route;
    if ($ instanceof Library) {
      return [model, $effect.none()];
    } else {
      let id = $.id;
      let $1 = $store.redo(model.store, id, now);
      if ($1 instanceof Ok) {
        let new_store = $1[0];
        return [
          new Model(
            new_store,
            model.session,
            model.route,
            model.creating,
            model.create_width,
            model.create_height,
            model.renaming,
            model.rename_value,
            model.pending_delete,
            model.pencil_active,
            model.stroke,
          ),
          persist(new_store),
        ];
      } else {
        return [model, $effect.none()];
      }
    }
  } else if (msg instanceof ExportClicked) {
    let $ = model.route;
    if ($ instanceof Library) {
      return [model, $effect.none()];
    } else {
      let id = $.id;
      let $1 = $store.document(model.store, id);
      if ($1 instanceof Ok) {
        let document = $1[0];
        return [
          model,
          $effect.from(
            (_) => {
              return $browser_ffi.download_text(
                document.name + ".pdf",
                $pdf.build(document.name),
              );
            },
          ),
        ];
      } else {
        return [model, $effect.none()];
      }
    }
  } else {
    let available = msg[0];
    let _block;
    if (available) {
      _block = $store.online_restored(model.session);
    } else {
      _block = $store.offline_detected(model.session);
    }
    let session = _block;
    return [
      new Model(
        model.store,
        session,
        model.route,
        model.creating,
        model.create_width,
        model.create_height,
        model.renaming,
        model.rename_value,
        model.pending_delete,
        model.pencil_active,
        model.stroke,
      ),
      $effect.none(),
    ];
  }
}

function stitch_grid(id, editor) {
  return $html.div(
    listPrepend(
      $attribute.role("grid"),
      listPrepend(
        $attribute.aria_label("Stitch grid"),
        listPrepend(
          $attribute.class$("stitch-grid"),
          listPrepend(
            $attribute.style(
              "grid-template-columns",
              ("repeat(" + $int.to_string(editor.width)) + ", 28px)",
            ),
            $List$Empty$const,
          ),
        ),
      ),
    ),
    $list.map(
      editor.cells,
      (cell) => {
        let x = cell.position.x;
        let y = cell.position.y;
        let stitched = !(cell.color_index instanceof None);
        let _block;
        if (stitched) {
          _block = (("Stitched cell " + $int.to_string(x)) + ", ") + $int.to_string(
            y,
          );
        } else {
          _block = (("Cell " + $int.to_string(x)) + ", ") + $int.to_string(y);
        }
        let label = _block;
        return $html.div(
          listPrepend(
            $attribute.role("gridcell"),
            listPrepend(
              $attribute.aria_label(label),
              listPrepend(
                $attribute.class$(
                  (() => {
                    if (stitched) {
                      return "cell stitched";
                    } else {
                      return "cell";
                    }
                  })(),
                ),
                listPrepend(
                  $event.on(
                    "pointerdown",
                    $decode.success(new StrokeStarted(id, x, y)),
                  ),
                  listPrepend(
                    $event.on(
                      "pointerover",
                      $decode.success(new StrokeMoved(id, x, y)),
                    ),
                    $List$Empty$const,
                  ),
                ),
              ),
            ),
          ),
          $List$Empty$const,
        );
      },
    ),
  );
}

function bool_string(value) {
  if (value) {
    return "true";
  } else {
    return "false";
  }
}

function editor_view(model, id) {
  let $ = $store.editor_view(model.store, id);
  if ($ instanceof Ok) {
    let editor = $[0];
    let can_undo = $store.can_undo(model.store, id);
    let can_redo = $store.can_redo(model.store, id);
    return $html.main(
      listPrepend($attribute.class$("editor"), $List$Empty$const),
      listPrepend(
        $html.header(
          listPrepend($attribute.class$("editor-bar"), $List$Empty$const),
          listPrepend(
            $html.button(
              listPrepend(
                $event.on_click(Msg$BackToLibrary$const),
                $List$Empty$const,
              ),
              listPrepend($html.text("Back to library"), $List$Empty$const),
            ),
            listPrepend(
              $html.h1(
                $List$Empty$const,
                listPrepend($html.text(editor.name), $List$Empty$const),
              ),
              listPrepend(
                $html.button(
                  listPrepend(
                    $event.on_click(Msg$PencilActivated$const),
                    listPrepend(
                      $attribute.aria_pressed(bool_string(model.pencil_active)),
                      listPrepend(
                        $attribute.class$(
                          (() => {
                            let $1 = model.pencil_active;
                            if ($1) {
                              return "tool active";
                            } else {
                              return "tool";
                            }
                          })(),
                        ),
                        $List$Empty$const,
                      ),
                    ),
                  ),
                  listPrepend($html.text("Pencil"), $List$Empty$const),
                ),
                listPrepend(
                  $html.button(
                    listPrepend(
                      $event.on_click(Msg$UndoClicked$const),
                      listPrepend(
                        $attribute.disabled(!can_undo),
                        $List$Empty$const,
                      ),
                    ),
                    listPrepend($html.text("Undo"), $List$Empty$const),
                  ),
                  listPrepend(
                    $html.button(
                      listPrepend(
                        $event.on_click(Msg$RedoClicked$const),
                        listPrepend(
                          $attribute.disabled(!can_redo),
                          $List$Empty$const,
                        ),
                      ),
                      listPrepend($html.text("Redo"), $List$Empty$const),
                    ),
                    listPrepend(
                      $html.button(
                        listPrepend(
                          $event.on_click(Msg$ExportClicked$const),
                          $List$Empty$const,
                        ),
                        listPrepend($html.text("Export PDF"), $List$Empty$const),
                      ),
                      $List$Empty$const,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
        listPrepend(stitch_grid(id, editor), $List$Empty$const),
      ),
    );
  } else {
    return $html.main(
      $List$Empty$const,
      listPrepend(
        $html.button(
          listPrepend(
            $event.on_click(Msg$BackToLibrary$const),
            $List$Empty$const,
          ),
          listPrepend($html.text("Back to library"), $List$Empty$const),
        ),
        listPrepend(
          $html.p(
            $List$Empty$const,
            listPrepend($html.text("Document not found."), $List$Empty$const),
          ),
          $List$Empty$const,
        ),
      ),
    );
  }
}

/**
 * Explicit confirmation gate (AC-F014-02): deletion never fires without it.
 * 
 * @ignore
 */
function delete_dialog(model, id) {
  let _block;
  let $ = $store.document(model.store, id);
  if ($ instanceof Ok) {
    let document = $[0];
    _block = document.name;
  } else {
    _block = "";
  }
  let name = _block;
  return $html.div(
    listPrepend(
      $attribute.role("dialog"),
      listPrepend(
        $attribute.aria_label("Delete " + name),
        listPrepend($attribute.class$("dialog"), $List$Empty$const),
      ),
    ),
    listPrepend(
      $html.p(
        $List$Empty$const,
        listPrepend(
          $html.text(
            ("Delete \"" + name) + "\"? This permanently removes the document from this device.",
          ),
          $List$Empty$const,
        ),
      ),
      listPrepend(
        $html.button(
          listPrepend(
            $event.on_click(Msg$DeleteCancelled$const),
            $List$Empty$const,
          ),
          listPrepend($html.text("Cancel"), $List$Empty$const),
        ),
        listPrepend(
          $html.button(
            listPrepend(
              $event.on_click(Msg$DeleteConfirmed$const),
              $List$Empty$const,
            ),
            listPrepend($html.text("Delete"), $List$Empty$const),
          ),
          $List$Empty$const,
        ),
      ),
    ),
  );
}

/**
 * Commit an input's value when Enter is pressed.
 * 
 * @ignore
 */
function on_enter(msg) {
  return $event.on(
    "keydown",
    $decode.field(
      "key",
      $decode.string,
      (key) => {
        if (key === "Enter") {
          return $decode.success(msg);
        } else {
          return $decode.failure(msg, "Enter");
        }
      },
    ),
  );
}

function library_entry_view(model, entry) {
  let id = entry.document_id;
  return $html.li(
    listPrepend($attribute.class$("entry"), $List$Empty$const),
    listPrepend(
      $html.div(
        listPrepend(
          $attribute.role("img"),
          listPrepend(
            $attribute.aria_label("Thumbnail of " + entry.name),
            listPrepend($attribute.class$("thumb"), $List$Empty$const),
          ),
        ),
        $List$Empty$const,
      ),
      listPrepend(
        $html.h3(
          $List$Empty$const,
          listPrepend($html.text(entry.name), $List$Empty$const),
        ),
        listPrepend(
          (() => {
            let $ = isEqual(model.renaming, new Some(id));
            if ($) {
              return $html.input(
                listPrepend(
                  $attribute.type_("text"),
                  listPrepend(
                    $attribute.aria_label("Document name"),
                    listPrepend(
                      $attribute.value(model.rename_value),
                      listPrepend(
                        $event.on_input(
                          (var0) => { return new RenameChanged(var0); },
                        ),
                        listPrepend(
                          on_enter(Msg$RenameCommitted$const),
                          $List$Empty$const,
                        ),
                      ),
                    ),
                  ),
                ),
              );
            } else {
              return $element.none();
            }
          })(),
          listPrepend(
            $html.p(
              listPrepend($attribute.class$("meta"), $List$Empty$const),
              listPrepend(
                $html.text("Last edited " + $int.to_string(entry.last_edited)),
                $List$Empty$const,
              ),
            ),
            listPrepend(
              $html.div(
                listPrepend($attribute.class$("actions"), $List$Empty$const),
                listPrepend(
                  $html.button(
                    listPrepend(
                      $event.on_click(new DocumentOpened(id)),
                      $List$Empty$const,
                    ),
                    listPrepend(
                      $html.text("Open " + entry.name),
                      $List$Empty$const,
                    ),
                  ),
                  listPrepend(
                    $html.button(
                      listPrepend(
                        $event.on_click(new RenameClicked(id)),
                        $List$Empty$const,
                      ),
                      listPrepend(
                        $html.text("Rename " + entry.name),
                        $List$Empty$const,
                      ),
                    ),
                    listPrepend(
                      $html.button(
                        listPrepend(
                          $event.on_click(new DuplicateClicked(id)),
                          $List$Empty$const,
                        ),
                        listPrepend(
                          $html.text("Duplicate " + entry.name),
                          $List$Empty$const,
                        ),
                      ),
                      listPrepend(
                        $html.button(
                          listPrepend(
                            $event.on_click(new DeleteClicked(id)),
                            $List$Empty$const,
                          ),
                          listPrepend(
                            $html.text("Delete " + entry.name),
                            $List$Empty$const,
                          ),
                        ),
                        $List$Empty$const,
                      ),
                    ),
                  ),
                ),
              ),
              $List$Empty$const,
            ),
          ),
        ),
      ),
    ),
  );
}

function create_form(model) {
  return $html.div(
    listPrepend($attribute.class$("create-form"), $List$Empty$const),
    listPrepend(
      $html.label(
        $List$Empty$const,
        listPrepend(
          $html.text("Width"),
          listPrepend(
            $html.input(
              listPrepend(
                $attribute.type_("number"),
                listPrepend(
                  $attribute.min("1"),
                  listPrepend(
                    $attribute.value(model.create_width),
                    listPrepend(
                      $event.on_input(
                        (var0) => { return new CreateWidthChanged(var0); },
                      ),
                      $List$Empty$const,
                    ),
                  ),
                ),
              ),
            ),
            $List$Empty$const,
          ),
        ),
      ),
      listPrepend(
        $html.label(
          $List$Empty$const,
          listPrepend(
            $html.text("Height"),
            listPrepend(
              $html.input(
                listPrepend(
                  $attribute.type_("number"),
                  listPrepend(
                    $attribute.min("1"),
                    listPrepend(
                      $attribute.value(model.create_height),
                      listPrepend(
                        $event.on_input(
                          (var0) => { return new CreateHeightChanged(var0); },
                        ),
                        $List$Empty$const,
                      ),
                    ),
                  ),
                ),
              ),
              $List$Empty$const,
            ),
          ),
        ),
        listPrepend(
          $html.button(
            listPrepend(
              $event.on_click(Msg$CreateSubmitted$const),
              $List$Empty$const,
            ),
            listPrepend($html.text("Create"), $List$Empty$const),
          ),
          $List$Empty$const,
        ),
      ),
    ),
  );
}

function library_view(model) {
  return $html.main(
    listPrepend($attribute.class$("library"), $List$Empty$const),
    listPrepend(
      $html.h1(
        $List$Empty$const,
        listPrepend($html.text("Stitch'n'Glitch"), $List$Empty$const),
      ),
      listPrepend(
        $html.p(
          listPrepend($attribute.class$("tagline"), $List$Empty$const),
          listPrepend(
            $html.text(
              "Local-first pattern editor. Your work never leaves this device.",
            ),
            $List$Empty$const,
          ),
        ),
        listPrepend(
          $html.div(
            listPrepend($attribute.class$("toolbar"), $List$Empty$const),
            listPrepend(
              (() => {
                let $ = model.creating;
                if ($) {
                  return $element.none();
                } else {
                  return $html.button(
                    listPrepend(
                      $event.on_click(Msg$CreateFormToggled$const),
                      $List$Empty$const,
                    ),
                    listPrepend(
                      $html.text("Create blank document"),
                      $List$Empty$const,
                    ),
                  );
                }
              })(),
              listPrepend(
                $html.label(
                  listPrepend(
                    $attribute.class$("import-control"),
                    $List$Empty$const,
                  ),
                  listPrepend(
                    $html.text("Import image"),
                    listPrepend(
                      $html.input(
                        listPrepend(
                          $attribute.id(import_input_id),
                          listPrepend(
                            $attribute.type_("file"),
                            listPrepend(
                              $attribute.accept(
                                listPrepend("image/*", $List$Empty$const),
                              ),
                              $List$Empty$const,
                            ),
                          ),
                        ),
                      ),
                      $List$Empty$const,
                    ),
                  ),
                ),
                $List$Empty$const,
              ),
            ),
          ),
          listPrepend(
            (() => {
              let $ = model.creating;
              if ($) {
                return create_form(model);
              } else {
                return $element.none();
              }
            })(),
            listPrepend(
              $html.ul(
                listPrepend(
                  $attribute.class$("library-list"),
                  $List$Empty$const,
                ),
                $list.map(
                  $store.library_view(model.store, $browser_ffi.now_ms()),
                  (entry) => { return library_entry_view(model, entry); },
                ),
              ),
              listPrepend(
                (() => {
                  let $ = model.pending_delete;
                  if ($ instanceof Some) {
                    let id = $[0];
                    return delete_dialog(model, id);
                  } else {
                    return $element.none();
                  }
                })(),
                $List$Empty$const,
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/**
 * Non-blocking offline notice (role="status", not a dialog). Only rendered
 * while the session says the notice is shown, so it is hidden while online.
 * 
 * @ignore
 */
function offline_indicator(model) {
  let $ = model.session.offline_notice_shown;
  if ($) {
    return $html.div(
      listPrepend(
        $attribute.role("status"),
        listPrepend(
          $attribute.aria_label("Offline"),
          listPrepend($attribute.class$("offline-banner"), $List$Empty$const),
        ),
      ),
      listPrepend(
        $html.text("You are offline — your work stays saved on this device."),
        $List$Empty$const,
      ),
    );
  } else {
    return $element.none();
  }
}

function view(model) {
  return $html.div(
    listPrepend($attribute.class$("app"), $List$Empty$const),
    listPrepend(
      offline_indicator(model),
      listPrepend(
        (() => {
          let $ = model.route;
          if ($ instanceof Library) {
            return library_view(model);
          } else {
            let id = $.id;
            return editor_view(model, id);
          }
        })(),
        $List$Empty$const,
      ),
    ),
  );
}

export function main() {
  let app = $lustre.application(init, update, view);
  let $ = $lustre.start(app, "#app", undefined);
  if ($ instanceof Ok) {
    return undefined;
  } else {
    return undefined;
  }
}
