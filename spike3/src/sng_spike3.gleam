import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode.{type Decoder}
import gleam/float
import gleam/int
import gleam/io
import gleam/option.{type Option, None, Some}
import gleam/string
import lustre
import lustre/attribute
import lustre/effect.{type Effect}
import lustre/element.{type Element}
import lustre/element/html

const input_id = "source-image"

const canvas_id = "chart-canvas"

type Model {
  Model(phase: Phase, summary: Option(Summary), error: Option(String))
}

type Phase {
  Waiting
  Importing
  Quantizing
  Rendering
  Done
  Failed
}

type Summary {
  Summary(
    file_name: String,
    width: Int,
    height: Int,
    decode_ms: Float,
    quantize_ms: Float,
    render_ms: Float,
    fps: Float,
    jank_frames: Int,
    unique_colors: Int,
    checksum: Int,
  )
}

type Msg {
  ImageImported(Dynamic)
  ImageQuantized(Dynamic)
  RenderFinished(Result(Summary, List(decode.DecodeError)))
}

@external(javascript, "./sng_spike3_ffi.mjs", "prepare_worker")
fn prepare_worker() -> Nil

@external(javascript, "./sng_spike3_ffi.mjs", "attach_file_input")
fn attach_file_input(input_id: String, on_file: fn(Dynamic) -> Nil) -> Nil

@external(javascript, "./sng_spike3_ffi.mjs", "quantize_image")
fn quantize_image(file: Dynamic, on_result: fn(Dynamic) -> Nil) -> Nil

@external(javascript, "./sng_spike3_ffi.mjs", "render_chart")
fn render_chart(canvas_id: String, chart: Dynamic) -> Dynamic

@external(javascript, "./sng_spike3_ffi.mjs", "finish_result")
fn finish_result(
  chart: Dynamic,
  render_info: Dynamic,
  on_summary: fn(Dynamic) -> Nil,
) -> Nil

fn init(_flags: Nil) -> #(Model, Effect(Msg)) {
  #(
    Model(phase: Waiting, summary: None, error: None),
    effect.from(fn(dispatch) {
      prepare_worker()
      attach_file_input(input_id, fn(file) { dispatch(ImageImported(file)) })
    }),
  )
}

fn update(model: Model, msg: Msg) -> #(Model, Effect(Msg)) {
  case msg {
    ImageImported(file) -> #(
      Model(phase: Quantizing, summary: None, error: None),
      effect.from(fn(dispatch) {
        quantize_image(file, fn(result) { dispatch(ImageQuantized(result)) })
      }),
    )

    ImageQuantized(chart) -> #(
      Model(..model, phase: Rendering),
      effect.from(fn(dispatch) {
        let render_info = render_chart(canvas_id, chart)
        finish_result(chart, render_info, fn(summary) {
          dispatch(RenderFinished(decode.run(summary, summary_decoder())))
        })
      }),
    )

    RenderFinished(Ok(summary)) -> #(
      Model(phase: Done, summary: Some(summary), error: None),
      effect.none(),
    )

    RenderFinished(Error(errors)) -> #(
      Model(phase: Failed, summary: None, error: Some(string.inspect(errors))),
      effect.none(),
    )
  }
}

fn summary_decoder() -> Decoder(Summary) {
  use file_name <- decode.field("fileName", decode.string)
  use width <- decode.field("width", decode.int)
  use height <- decode.field("height", decode.int)
  use decode_ms <- decode.field("decodeMs", decode.float)
  use quantize_ms <- decode.field("quantizeMs", decode.float)
  use render_ms <- decode.field("renderMs", decode.float)
  use fps <- decode.field("fps", decode.float)
  use jank_frames <- decode.field("jankFrames", decode.int)
  use unique_colors <- decode.field("uniqueColors", decode.int)
  use checksum <- decode.field("checksum", decode.int)

  decode.success(Summary(
    file_name:,
    width:,
    height:,
    decode_ms:,
    quantize_ms:,
    render_ms:,
    fps:,
    jank_frames:,
    unique_colors:,
    checksum:,
  ))
}

fn view(model: Model) -> Element(Msg) {
  html.main([], [
    html.h1([], [html.text("Spike S3 — Gleam/Lustre integration skeleton")]),
    html.p([attribute.class("muted")], [
      html.text(
        "Import an image, quantize it with @thi.ng/pixel in a Web Worker, and render the indexed chart through WebGL2. "
        <> "The Gleam MVU app owns state; TypeScript enters through typed FFI boundaries.",
      ),
    ]),
    html.div([attribute.class("layout")], [
      html.div([attribute.class("panel")], [
        html.h2([], [html.text("1. Import")]),
        html.input([
          attribute.id(input_id),
          attribute.type_("file"),
          attribute.accept(["image/*"]),
        ]),
        html.p([attribute.class("muted")], [
          html.text("The selected File crosses into a dedicated module worker; decode and resize stay off the UI thread."),
        ]),
      ]),
      html.div([attribute.class("panel")], [
        html.h2([], [html.text("2. Quantize + render")]),
        html.canvas(
          [
            attribute.id(canvas_id),
            attribute.width(300),
            attribute.height(300),
          ],
        ),
      ]),
    ]),
    html.section([attribute.class("panel")], [
      html.h2([], [html.text("3. Result")]),
      html.p([attribute.class("status " <> phase_class(model.phase))], [
        html.text(phase_text(model.phase)),
      ]),
      case model.summary {
        Some(summary) -> summary_view(summary)
        None -> element.none()
      },
      case model.error {
        Some(error) -> html.pre([], [html.text(error)])
        None -> element.none()
      },
    ]),
  ])
}

fn phase_text(phase: Phase) -> String {
  case phase {
    Waiting -> "Waiting for an image…"
    Importing -> "Importing…"
    Quantizing -> "Quantizing with thi.ng in a Web Worker…"
    Rendering -> "Rendering the indexed chart with WebGL2…"
    Done -> "PASS — import → quantize → render completed"
    Failed -> "FAIL — see decode error"
  }
}

fn phase_class(phase: Phase) -> String {
  case phase {
    Done -> "pass"
    Failed -> "fail"
    _ -> ""
  }
}

fn summary_view(summary: Summary) -> Element(Msg) {
  html.dl([], [
    html.dt([], [html.text("File")]),
    html.dd([], [html.text(summary.file_name)]),
    html.dt([], [html.text("Chart")]),
    html.dd([], [
      html.text(int.to_string(summary.width) <> " × " <> int.to_string(summary.height)),
    ]),
    html.dt([], [html.text("Decode")]),
    html.dd([], [html.text(ms(summary.decode_ms))]),
    html.dt([], [html.text("Quantize")]),
    html.dd([], [html.text(ms(summary.quantize_ms))]),
    html.dt([], [html.text("WebGL render")]),
    html.dd([], [html.text(ms(summary.render_ms))]),
    html.dt([], [html.text("UI during pipeline")]),
    html.dd([], [
      html.text(
        float.to_string(summary.fps)
        <> " fps, "
        <> int.to_string(summary.jank_frames)
        <> " jank frames",
      ),
    ]),
    html.dt([], [html.text("Readback")]),
    html.dd([], [
      html.text(
        int.to_string(summary.unique_colors)
        <> " unique colors, checksum "
        <> int.to_string(summary.checksum),
      ),
    ]),
  ])
}

fn ms(value: Float) -> String {
  int.to_string(float.round(value)) <> " ms"
}

pub fn main() -> Nil {
  let app = lustre.application(init, update, view)

  case lustre.start(app, onto: "#app", with: Nil) {
    Ok(_) -> Nil
    Error(error) -> io.println(string.inspect(error))
  }
}
