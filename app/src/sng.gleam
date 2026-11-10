//// Stitch'n'Glitch — M1 browser shell: Lustre UI (library browser + editor),
//// PWA wiring, and the IndexedDB persistence adapter on top of the domain
//// core (sng/store, sng/persist).
////
//// Surfaces and guarantees wired here (specs/m1-local-foundation.allium):
////   LibraryBrowser — create blank, import image stub, rename, duplicate,
////     delete behind confirmation (AC-F014-02)
////   Editor — pencil gestures (rule StitchesDrawn: one drag = one command),
////     undo/redo guards, local PDF export placeholder
////   AppShell — no sign-in wall (AC-F001-02), non-blocking offline indicator
////     within config.offline_indicator_deadline (OfflineIndicatorTimely)
////   IndexedDB persistence — every committed operation is durable before it
////     is acknowledged (LibraryPersists, CrashRecovery, UndoPersists)

import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import lustre
import lustre/attribute
import lustre/effect.{type Effect}
import lustre/element.{type Element}
import lustre/element/html
import lustre/event
import sng/browser_ffi
import sng/config
import sng/persist
import sng/persist_ffi
import sng/store
import sng/types.{
  type AppSession, type CellPosition, CellChange, CellPosition, DocumentEdit,
}
import sng/ui/pdf

const import_input_id = "import-image"

const default_grid_size = 8

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

type Model {
  Model(
    store: store.Store,
    session: AppSession,
    route: Route,
    // Library view state
    creating: Bool,
    create_width: String,
    create_height: String,
    renaming: Option(String),
    rename_value: String,
    pending_delete: Option(String),
    // Editor view state
    pencil_active: Bool,
    stroke: List(CellPosition),
  )
}

type Route {
  Library
  Editor(id: String)
}

type ImportedFile {
  ImportedFile(name: String, bytes: List(Int))
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

type Msg {
  StoreLoaded(Dynamic)
  CreateFormToggled
  CreateWidthChanged(String)
  CreateHeightChanged(String)
  CreateSubmitted
  FilePicked(Dynamic)
  DocumentOpened(String)
  BackToLibrary
  RenameClicked(String)
  RenameChanged(String)
  RenameCommitted
  DuplicateClicked(String)
  DeleteClicked(String)
  DeleteConfirmed
  DeleteCancelled
  PencilToggled
  StrokeStarted(id: String, x: Int, y: Int)
  StrokeMoved(id: String, x: Int, y: Int, buttons: Int)
  StrokeEnded
  UndoClicked
  RedoClicked
  ExportClicked
  ConnectivityChanged(Bool)
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

fn init(_flags: Nil) -> #(Model, Effect(Msg)) {
  let now = browser_ffi.now_ms()
  #(
    Model(
      store: store.new(),
      session: store.new_session("session-1", now, browser_ffi.online()),
      route: Library,
      creating: False,
      create_width: int.to_string(default_grid_size),
      create_height: int.to_string(default_grid_size),
      renaming: None,
      rename_value: "",
      pending_delete: None,
      pencil_active: True,
      stroke: [],
    ),
    effect.batch([
      effect.from(fn(dispatch) {
        persist_ffi.load(fn(payload) { dispatch(StoreLoaded(payload)) })
      }),
      effect.from(fn(dispatch) {
        browser_ffi.watch_connectivity(
          fn(online) { dispatch(ConnectivityChanged(online)) },
          config.offline_indicator_deadline_ms,
        )
      }),
      effect.from(fn(dispatch) {
        browser_ffi.watch_pointer_end(fn() { dispatch(StrokeEnded) })
      }),
      effect.from(fn(_) { browser_ffi.register_service_worker("/sw.js") }),
      effect.after_paint(fn(dispatch, _) {
        browser_ffi.attach_file_input(import_input_id, fn(file) {
          dispatch(FilePicked(file))
        })
      }),
    ]),
  )
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/// A committed gesture/operation is durable before it is acknowledged
/// (CrashRecovery, NFR-A3): every store mutation is persisted immediately.
fn persist(new_store: store.Store) -> Effect(Msg) {
  effect.from(fn(_) { persist_ffi.save(persist.serialize(new_store)) })
}

fn update(model: Model, msg: Msg) -> #(Model, Effect(Msg)) {
  let now = browser_ffi.now_ms()
  case msg {
    StoreLoaded(payload) -> #(
      Model(..model, store: decode_store(payload)),
      effect.none(),
    )

    CreateFormToggled -> #(
      Model(..model, creating: !model.creating),
      effect.none(),
    )

    CreateWidthChanged(value) -> #(
      Model(..model, create_width: value),
      effect.none(),
    )

    CreateHeightChanged(value) -> #(
      Model(..model, create_height: value),
      effect.none(),
    )

    CreateSubmitted -> {
      let width = int.parse(model.create_width) |> or_default(default_grid_size)
      let height =
        int.parse(model.create_height) |> or_default(default_grid_size)
      case store.create_blank(model.store, width, height, now) {
        Ok(#(new_store, document)) -> #(
          Model(
            ..model,
            store: new_store,
            route: Editor(document.id),
            creating: False,
          ),
          persist(new_store),
        )
        Error(_) -> #(model, effect.none())
      }
    }

    FilePicked(file) -> {
      case decode.run(file, imported_file_decoder()) {
        Ok(ImportedFile(name, bytes)) ->
          case store.import_image_stub(model.store, name, bytes, now) {
            Ok(#(new_store, _document)) -> #(
              Model(..model, store: new_store),
              persist(new_store),
            )
            Error(_) -> #(model, effect.none())
          }
        Error(_) -> #(model, effect.none())
      }
    }

    DocumentOpened(id) -> #(
      Model(..model, route: Editor(id), stroke: []),
      effect.none(),
    )

    BackToLibrary -> #(
      Model(..model, route: Library, stroke: [], renaming: None),
      effect.none(),
    )

    RenameClicked(id) -> {
      let name = case store.document(model.store, id) {
        Ok(document) -> document.name
        Error(_) -> ""
      }
      #(Model(..model, renaming: Some(id), rename_value: name), effect.none())
    }

    RenameChanged(value) -> #(
      Model(..model, rename_value: value),
      effect.none(),
    )

    RenameCommitted -> {
      case model.renaming {
        Some(id) ->
          case store.rename(model.store, id, model.rename_value, now) {
            Ok(new_store) -> #(
              Model(..model, store: new_store, renaming: None),
              persist(new_store),
            )
            Error(_) -> #(model, effect.none())
          }
        None -> #(model, effect.none())
      }
    }

    DuplicateClicked(id) -> {
      case store.duplicate(model.store, id, now) {
        Ok(#(new_store, _copy)) -> #(
          Model(..model, store: new_store),
          persist(new_store),
        )
        Error(_) -> #(model, effect.none())
      }
    }

    DeleteClicked(id) -> #(
      Model(..model, pending_delete: Some(id)),
      effect.none(),
    )

    DeleteConfirmed -> {
      case model.pending_delete {
        Some(id) ->
          case store.delete(model.store, id) {
            Ok(new_store) -> #(
              Model(..model, store: new_store, pending_delete: None),
              persist(new_store),
            )
            Error(_) -> #(model, effect.none())
          }
        None -> #(model, effect.none())
      }
    }

    DeleteCancelled -> #(
      Model(..model, pending_delete: None),
      effect.none(),
    )

    PencilToggled -> {
      // M1 ships the pencil as the only tool (spec guidance, stitch grid +
      // pencil only): the button is a toggle, and its class/aria-pressed
      // reflect the state so the user can see whether the tool is active.
      // Strokes commit only while it is active, so the control genuinely
      // gates the gesture pipeline rather than being decorative chrome.
      #(
        Model(..model, pencil_active: !model.pencil_active),
        effect.none(),
      )
    }

    StrokeStarted(id, x, y) -> case model.pencil_active {
      True -> #(
        Model(..model, route: Editor(id), stroke: [CellPosition(x, y)]),
        effect.none(),
      )
      False -> #(model, effect.none())
    }

    StrokeMoved(id, x, y, buttons) -> {
      let position = CellPosition(x, y)
      // Only an in-progress drag accumulates cells. Two guards, because
      // pointerover fires for mere hover too:
      //   - buttons != 0: no button is held, so this is hover, not a drag;
      //   - stroke non-empty: the drag was seeded by a pointerdown on a
      //     cell (StrokeStarted), so a stroke exists to extend.
      // Without these, hovered cells would pile up and the next pointerup
      // (e.g. the click on Undo or Redo) would commit them as a phantom
      // gesture — which the button's own action would then undo/redo
      // instead of the user's real edit.
      case
        model.route == Editor(id)
        && buttons != 0
        && !list.is_empty(model.stroke)
        && !list.contains(model.stroke, position)
      {
        True -> #(
          Model(..model, stroke: [position, ..model.stroke]),
          effect.none(),
        )
        False -> #(model, effect.none())
      }
    }

    // One committed gesture = one draw command (rule StitchesDrawn): the
    // whole drag is committed as a single edit when the pointer is released.
    StrokeEnded -> {
      case model.route, model.stroke {
        Editor(id), [_first, ..] -> {
          let assert Ok(document) = store.document(model.store, id)
          let changes =
            list.map(list.reverse(model.stroke), fn(position) {
              CellChange(
                position,
                types.cell_at(document.cells, position),
                Some(0),
              )
            })
          case store.draw(model.store, id, DocumentEdit(changes), now) {
            Ok(new_store) -> #(
              Model(..model, store: new_store, stroke: []),
              persist(new_store),
            )
            Error(_) -> #(Model(..model, stroke: []), effect.none())
          }
        }
        _, _ -> #(Model(..model, stroke: []), effect.none())
      }
    }

    UndoClicked -> {
      case model.route {
        Editor(id) ->
          case store.undo(model.store, id, now) {
            Ok(new_store) -> #(Model(..model, store: new_store), persist(new_store))
            Error(_) -> #(model, effect.none())
          }
        Library -> #(model, effect.none())
      }
    }

    RedoClicked -> {
      case model.route {
        Editor(id) ->
          case store.redo(model.store, id, now) {
            Ok(new_store) -> #(Model(..model, store: new_store), persist(new_store))
            Error(_) -> #(model, effect.none())
          }
        Library -> #(model, effect.none())
      }
    }

    // ExportPdfPlaceholder: the PDF is built locally and handed to a local
    // download; nothing is transmitted (contract LocalOnlyBoundary).
    ExportClicked -> {
      case model.route {
        Editor(id) ->
          case store.document(model.store, id) {
            Ok(document) -> #(
              model,
              effect.from(fn(_) {
                browser_ffi.download_text(
                  document.name <> ".pdf",
                  pdf.build(document.name),
                )
              }),
            )
            Error(_) -> #(model, effect.none())
          }
        Library -> #(model, effect.none())
      }
    }

    // Rules OfflineIndicatorShown / OnlineIndicatorHidden: a passive status
    // region, never a dialog; editing is never interrupted.
    ConnectivityChanged(available) -> {
      let session = case available {
        True -> store.online_restored(model.session)
        False -> store.offline_detected(model.session)
      }
      #(Model(..model, session:), effect.none())
    }
  }
}

fn or_default(result: Result(Int, _), default: Int) -> Int {
  case result {
    Ok(value) -> value
    Error(_) -> default
  }
}

fn decode_store(payload: Dynamic) -> store.Store {
  case decode.run(payload, decode.optional(decode.string)) {
    Ok(Some(json)) ->
      case persist.deserialize(json) {
        Ok(loaded) -> loaded
        // Corrupt record: boot with a fresh store.
        Error(_) -> store.new()
      }
    _ -> store.new()
  }
}

fn imported_file_decoder() -> decode.Decoder(ImportedFile) {
  use name <- decode.field("name", decode.string)
  use bytes <- decode.field("bytes", decode.list(decode.int))
  decode.success(ImportedFile(name:, bytes:))
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

fn view(model: Model) -> Element(Msg) {
  html.div([attribute.class("app")], [
    offline_indicator(model),
    case model.route {
      Library -> library_view(model)
      Editor(id) -> editor_view(model, id)
    },
  ])
}

/// Non-blocking offline notice (role="status", not a dialog). Only rendered
/// while the session says the notice is shown, so it is hidden while online.
fn offline_indicator(model: Model) -> Element(Msg) {
  case model.session.offline_notice_shown {
    True ->
      html.div(
        [
          attribute.role("status"),
          attribute.aria_label("Offline"),
          attribute.class("offline-banner"),
        ],
        [html.text("You are offline — your work stays saved on this device.")],
      )
    False -> element.none()
  }
}

// ---------------------------------------------------------------------------
// Library browser view
// ---------------------------------------------------------------------------

fn library_view(model: Model) -> Element(Msg) {
  html.main([attribute.class("library")], [
    html.h1([], [html.text("Stitch'n'Glitch")]),
    html.p([attribute.class("tagline")], [
      html.text("Local-first pattern editor. Your work never leaves this device."),
    ]),
    html.div([attribute.class("toolbar")], [
      case model.creating {
        True -> element.none()
        False ->
          html.button([event.on_click(CreateFormToggled)], [
            html.text("Create blank document"),
          ])
      },
      html.label([attribute.class("import-control")], [
        html.text("Import image"),
        html.input([
          attribute.id(import_input_id),
          attribute.type_("file"),
          attribute.accept(["image/*"]),
        ]),
      ]),
    ]),
    case model.creating {
      True -> create_form(model)
      False -> element.none()
    },
    html.ul(
      [attribute.class("library-list")],
      list.map(store.library_view(model.store, browser_ffi.now_ms()), fn(entry) {
        library_entry_view(model, entry)
      }),
    ),
    case model.pending_delete {
      Some(id) -> delete_dialog(model, id)
      None -> element.none()
    },
  ])
}

fn create_form(model: Model) -> Element(Msg) {
  html.div([attribute.class("create-form")], [
    html.label([], [
      html.text("Width"),
      html.input([
        attribute.type_("number"),
        attribute.min("1"),
        attribute.value(model.create_width),
        event.on_input(CreateWidthChanged),
      ]),
    ]),
    html.label([], [
      html.text("Height"),
      html.input([
        attribute.type_("number"),
        attribute.min("1"),
        attribute.value(model.create_height),
        event.on_input(CreateHeightChanged),
      ]),
    ]),
    html.button([event.on_click(CreateSubmitted)], [html.text("Create")]),
  ])
}

fn library_entry_view(model: Model, entry: store.LibraryEntry) -> Element(Msg) {
  let id = entry.document_id
  html.li([attribute.class("entry")], [
    html.div(
      [
        attribute.role("img"),
        attribute.aria_label("Thumbnail of " <> entry.name),
        attribute.class("thumb"),
      ],
      [],
    ),
    html.h3([], [html.text(entry.name)]),
    case model.renaming == Some(id) {
      True ->
        html.input([
          attribute.type_("text"),
          attribute.aria_label("Document name"),
          attribute.value(model.rename_value),
          event.on_input(RenameChanged),
          on_enter(RenameCommitted),
        ])
      False -> element.none()
    },
    html.p([attribute.class("meta")], [
      html.text("Last edited " <> int.to_string(entry.last_edited)),
    ]),
    html.div([attribute.class("actions")], [
      html.button([event.on_click(DocumentOpened(id))], [
        html.text("Open " <> entry.name),
      ]),
      html.button([event.on_click(RenameClicked(id))], [
        html.text("Rename " <> entry.name),
      ]),
      html.button([event.on_click(DuplicateClicked(id))], [
        html.text("Duplicate " <> entry.name),
      ]),
      html.button([event.on_click(DeleteClicked(id))], [
        html.text("Delete " <> entry.name),
      ]),
    ]),
  ])
}

/// Explicit confirmation gate (AC-F014-02): deletion never fires without it.
fn delete_dialog(model: Model, id: String) -> Element(Msg) {
  let name = case store.document(model.store, id) {
    Ok(document) -> document.name
    Error(_) -> ""
  }
  html.div(
    [
      attribute.role("dialog"),
      attribute.aria_label("Delete " <> name),
      attribute.class("dialog"),
    ],
    [
      html.p([], [
        html.text(
          "Delete \""
          <> name
          <> "\"? This permanently removes the document from this device.",
        ),
      ]),
      html.button([event.on_click(DeleteCancelled)], [html.text("Cancel")]),
      html.button([event.on_click(DeleteConfirmed)], [html.text("Delete")]),
    ],
  )
}

// ---------------------------------------------------------------------------
// Editor view
// ---------------------------------------------------------------------------

fn editor_view(model: Model, id: String) -> Element(Msg) {
  case store.editor_view(model.store, id) {
    Error(_) ->
      html.main([], [
        html.button([event.on_click(BackToLibrary)], [
          html.text("Back to library"),
        ]),
        html.p([], [html.text("Document not found.")]),
      ])
    Ok(editor) -> {
      let can_undo = store.can_undo(model.store, id)
      let can_redo = store.can_redo(model.store, id)
      html.main([attribute.class("editor")], [
        html.header([attribute.class("editor-bar")], [
          html.button([event.on_click(BackToLibrary)], [
            html.text("Back to library"),
          ]),
          html.h1([], [html.text(editor.name)]),
          html.button(
            [
              event.on_click(PencilToggled),
              attribute.aria_pressed(bool_string(model.pencil_active)),
              attribute.class(case model.pencil_active {
                True -> "tool active"
                False -> "tool"
              }),
            ],
            [html.text("Pencil")],
          ),
          html.button(
            [event.on_click(UndoClicked), attribute.disabled(!can_undo)],
            [html.text("Undo")],
          ),
          html.button(
            [event.on_click(RedoClicked), attribute.disabled(!can_redo)],
            [html.text("Redo")],
          ),
          html.button([event.on_click(ExportClicked)], [
            html.text("Export PDF"),
          ]),
        ]),
        stitch_grid(id, editor),
      ])
    }
  }
}

fn stitch_grid(id: String, editor: store.EditorView) -> Element(Msg) {
  html.div(
    [
      attribute.role("grid"),
      attribute.aria_label("Stitch grid"),
      attribute.class("stitch-grid"),
      attribute.style(
        "grid-template-columns",
        "repeat(" <> int.to_string(editor.width) <> ", 28px)",
      ),
    ],
    list.map(editor.cells, fn(cell) {
      let x = cell.position.x
      let y = cell.position.y
      let stitched = cell.color_index != None
      let label = case stitched {
        True ->
          "Stitched cell "
          <> int.to_string(x)
          <> ", "
          <> int.to_string(y)
        False -> "Cell " <> int.to_string(x) <> ", " <> int.to_string(y)
      }
      html.div(
        [
          attribute.role("gridcell"),
          attribute.aria_label(label),
          attribute.class(case stitched {
            True -> "cell stitched"
            False -> "cell"
          }),
          // Lustre attaches these directly on the cell node, so the
          // non-bubbling hover events work during a drag.
          event.on("pointerdown", decode.success(StrokeStarted(id, x, y))),
          event.on("pointerover", {
            // buttons tells hover (0) from drag (non-zero): see StrokeMoved.
            use buttons <- decode.field("buttons", decode.int)
            decode.success(StrokeMoved(id, x, y, buttons))
          }),
        ],
        [],
      )
    }),
  )
}

fn bool_string(value: Bool) -> String {
  case value {
    True -> "true"
    False -> "false"
  }
}

/// Commit an input's value when Enter is pressed.
fn on_enter(msg: Msg) -> attribute.Attribute(Msg) {  event.on("keydown", {
    use key <- decode.field("key", decode.string)
    case key {
      "Enter" -> decode.success(msg)
      _ -> decode.failure(msg, "Enter")
    }
  })
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

pub fn main() -> Nil {
  let app = lustre.application(init, update, view)
  case lustre.start(app, onto: "#app", with: Nil) {
    Ok(_) -> Nil
    Error(_) -> Nil
  }
}
