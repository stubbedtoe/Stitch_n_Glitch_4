// Chart renderer bridge (F-009). Thin FFI adapter (spike3 pattern): Gleam owns
// all state; this file only hands the chart canvas to a dedicated module
// worker and posts committed render state to it. The renderer is a stateless
// function of the model — every render message carries the full view state;
// document data (cells/palette/glyph source) crosses only when its version
// changes, so pan/zoom frames are light.

const charts = new Map();

export function render_chart(canvas_id, payload_json) {
  const el = document.getElementById(canvas_id);
  if (!el) return;
  let chart = charts.get(canvas_id);
  // Lustre remounts the canvas element whenever the chart view opens: rebind
  // (terminate the stale worker) when the element identity changed.
  if (chart && chart.element !== el) {
    chart.worker?.terminate();
    charts.delete(canvas_id);
    chart = undefined;
  }
  if (!chart) {
    chart = start_worker(el);
    charts.set(canvas_id, chart);
  }
  if (!chart.worker) return;
  let payload;
  try {
    payload = JSON.parse(payload_json);
  } catch {
    return;
  }
  const message = { type: "render", view: payload.view ?? {} };
  // Canvas geometry comes from the live element, not the model: the CSS box
  // (and the device pixel ratio) decide the backing-store size, so the chart
  // renders at native resolution in its actual on-screen box instead of the
  // placeholder 300x150 default (which CSS then stretches, cropping and
  // blurring the chart).
  const element = chart.element;
  if (message.view.cssWidth == null && element?.clientWidth) {
    message.view.cssWidth = element.clientWidth;
  }
  if (message.view.cssHeight == null && element?.clientHeight) {
    message.view.cssHeight = element.clientHeight;
  }
  if (message.view.dpr == null) {
    message.view.dpr = window.devicePixelRatio || 1;
  }
  if (payload.doc != null && payload.doc.version !== chart.last_doc_version) {
    chart.last_doc_version = payload.doc.version;
    message.document = payload.doc;
  }
  chart.worker.postMessage(message);
}

function start_worker(el) {
  const chart = { worker: null, element: el, last_doc_version: null };
  try {
    const worker = new Worker(new URL("./sng_chart_worker.mjs", import.meta.url), {
      type: "module",
    });
    let canvas = null;
    try {
      canvas = el.transferControlToOffscreen();
    } catch {
      canvas = null;
    }
    worker.postMessage({ type: "init", canvas }, canvas ? [canvas] : []);
    chart.worker = worker;
  } catch (error) {
    // Rendering is a pure presentation concern: never let a worker failure
    // break the app (the view state contract lives on the canvas element).
    console.warn("sng chart worker unavailable", error);
  }
  return chart;
}
