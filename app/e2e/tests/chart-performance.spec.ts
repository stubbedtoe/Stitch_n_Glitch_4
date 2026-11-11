// Obligations exercised (specs/m2-chart-core.allium, slice m2-chart-rendering):
//   - surface ChartViewControls guarantee PanZoomPerformance (NFR-P2,
//     AC-F009-03): continuous pan/zoom on a config.p2_benchmark_chart_width x
//     config.p2_benchmark_chart_height (1000x1000) chart with symbols
//     rendered holds at least config.min_pan_zoom_fps (55) fps
//   - measured per user decision 2026-11-10 with an S3-style rAF
//     frame-time harness on this fanless Apple M2 Air in headless Chromium,
//     with the environment recorded in the test report (the guarantee's
//     wording); Windows re-verification is an M3 target-hardware task
//   - guarantee RendererIsStatelessFunctionOfModel's observable half: the
//     gestures below change committed view state only (re-render from
//     committed state)
// Config values below are the spec config block's literals; the gleeunit
// suite pins sng/config's constants against the same spec block.
import { expect, test, type Page } from '@playwright/test';
import {
  benchmarkDoc,
  chartCanvas,
  chartState,
  openDocument,
  seedStore,
  showChart,
  storeWith,
} from './helpers';

const MIN_PAN_ZOOM_FPS = 55; // config.min_pan_zoom_fps
const BENCH_WIDTH = 1000; // config.p2_benchmark_chart_width
const BENCH_HEIGHT = 1000; // config.p2_benchmark_chart_height
const MEASUREMENT_WINDOW_MS = 2500;

/** S3-style rAF frame-time recorder, run in the page. */
async function startFrameRecorder(page: Page) {
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__sngFrames = [] as number[];
    (window as unknown as Record<string, unknown>).__sngRecording = true;
    const loop = (t: number) => {
      const w = window as unknown as Record<string, unknown>;
      if (w.__sngRecording !== true) return;
      (w.__sngFrames as number[]).push(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}

async function stopFrameRecorder(page: Page): Promise<number[]> {
  return page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const w = window as unknown as Record<string, unknown>;
        w.__sngRecording = false;
        // Let the in-flight frame settle, then hand over the samples.
        requestAnimationFrame(() => {
          resolve(w.__sngFrames as number[]);
        });
      }),
  );
}

test('NFR-P2 — sustained pan/zoom on a 1000x1000 chart holds at least 55 fps', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);

  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Create blank document' }),
  ).toBeVisible();
  await seedStore(page, storeWith(benchmarkDoc()));
  await page.reload();

  // Environment record (user decision 2026-11-10): the guarantee requires
  // the measurement environment to be recorded in the report.
  const environment = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number })
      .deviceMemory,
  }));
  const environmentReport = {
    ...environment,
    machine: 'fanless Apple M2 Air (ledger decision 2026-11-10)',
    harness: 'S3-style rAF frame-time recorder',
    benchmark: `${BENCH_WIDTH}x${BENCH_HEIGHT} chart, ${MIN_PAN_ZOOM_FPS} fps floor`,
  };
  testInfo.annotations.push({
    type: 'environment',
    description: `fanless Apple M2 Air, headless Chromium — ${environment.userAgent}`,
  });

  await openDocument(page, 'NFR-P2 Benchmark');
  await showChart(page);
  await expect(chartCanvas(page)).toHaveAttribute(
    'data-chart-width',
    String(BENCH_WIDTH),
  );
  await expect(chartCanvas(page)).toHaveAttribute(
    'data-chart-height',
    String(BENCH_HEIGHT),
  );

  const before = await chartState(page);

  // Continuous pan (oscillating drag) and zoom (alternating wheel) for the
  // measurement window, while the page records rAF frame times.
  const box = (await chartCanvas(page).boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await startFrameRecorder(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const start = Date.now();
  let i = 0;
  while (Date.now() - start < MEASUREMENT_WINDOW_MS) {
    const offset = (i % 20) * 8 - 80; // -80..+72, always inside the canvas
    await page.mouse.move(cx + offset, cy + offset / 2);
    // Alternate wheel direction so the zoom keeps moving inside its clamp.
    await page.mouse.wheel(0, i % 2 === 0 ? 240 : -240);
    i++;
  }
  await page.mouse.up();
  const frames = await stopFrameRecorder(page);

  // The gestures must actually have driven the view (an idle page at 60 fps
  // would be a vacuous measurement).
  const after = await chartState(page);
  expect({ x: after.center_x, y: after.center_y, z: after.zoom_pct }).not.toEqual(
    { x: before.center_x, y: before.center_y, z: before.zoom_pct },
  );

  expect(frames.length).toBeGreaterThan(10);
  const windowMs = frames[frames.length - 1] - frames[0];
  const meanFps = ((frames.length - 1) / windowMs) * 1000;
  const deltas = frames.slice(1).map((t, j) => t - frames[j]);
  const jankFrames = deltas.filter((d) => d > 50).length;

  const measurement = {
    meanFps: Number(meanFps.toFixed(2)),
    windowMs: Number(windowMs.toFixed(1)),
    frames: frames.length,
    gestureIterations: i,
    jankFramesOver50ms: jankFrames,
    floorFps: MIN_PAN_ZOOM_FPS,
    pass: meanFps >= MIN_PAN_ZOOM_FPS,
  };
  await testInfo.attach('nfr-p2-measurement', {
    body: JSON.stringify(measurement, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach('nfr-p2-environment', {
    body: JSON.stringify(environmentReport, null, 2),
    contentType: 'application/json',
  });

  // NFR-P2 / AC-F009-03: at least config.min_pan_zoom_fps sustained.
  expect(meanFps).toBeGreaterThanOrEqual(MIN_PAN_ZOOM_FPS);
});
