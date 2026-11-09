import {
  attach_file_input as attachFileInput,
  prepare_worker as prepareWorker,
  quantize_image as quantizeImage,
  render_chart as renderChart,
  finish_result as finishResult,
} from './ts/adapter.ts'

export function prepare_worker() {
  return prepareWorker()
}

export function attach_file_input(input_id, on_file) {
  return attachFileInput(input_id, on_file)
}

export function quantize_image(file, on_result) {
  return quantizeImage(file, on_result)
}

export function render_chart(canvas_id, chart) {
  return renderChart(canvas_id, chart)
}

export function finish_result(chart, render_info, on_summary) {
  return finishResult(chart, render_info, on_summary)
}
