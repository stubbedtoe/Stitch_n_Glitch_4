//// Browser bridge for the F-009 chart renderer (S3 architecture): a thin FFI
//// adapter to the dedicated module worker that owns the WebGL2 canvas.
//// Gleam owns the model; `render_chart` hands the worker a snapshot of the
//// committed view state and the document data (cells, palette, glyph atlas
//// source) — the renderer is a stateless function of that model and never
//// mutates it (guarantee RendererIsStatelessFunctionOfModel).

/// Post the current chart state for the canvas element `canvas_id`. The
/// payload is the JSON produced by sng.gleam's chart render effect:
/// `{"doc": <document data or null>, "view": <style/zoom/center/grid>}`.
/// The bridge forwards the (heavy) document part only when its version
/// changed since the last call; view state is forwarded on every call.
/// Idempotent and safe to call before the element exists (a no-op).
@external(javascript, "./sng_chart_ffi.mjs", "render_chart")
pub fn render_chart(canvas_id: String, payload: String) -> Nil
