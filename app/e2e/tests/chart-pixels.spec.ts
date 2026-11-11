// Obligations exercised (specs/m2-chart-core.allium, slice m2-chart-rendering)
// — pixel-level evidence for the renderer half of the chart guarantees. The
// sibling specs (chart-view.spec.ts) verify the DOM data-* bridge; the pixels
// themselves are invisible to that bridge, which is how two renderer
// regressions (opaque glyph atlas -> every cell a solid square; empty cell
// texture / stuck 300x150 backing store -> blank or stretched chart) reached
// a user. This spec reads the composited canvas back and asserts:
//   - guarantee SymbolLegibilityAtAllZoomLevels's rendering half: every
//     coloured cell carries BOTH glyph ink and cell background (never a solid
//     square of either polarity) at zoom 400
//   - StyleConsistentMapping's symbol-uniqueness half (AC-F009-01): different
//     colours render pairwise-distinct glyph ink patterns
//   - guarantee StyleConsistentMapping (AC-F009-04): a colour's glyph shape
//     (binarized ink pattern) is identical across all three ChartStyle values
//   - ChartStyle semantics (enum ChartStyle + ChartView.created): style
//     symbols_on_colored_background renders the cell colour as background
//     with white ink; colored_symbols_only renders white background with the
//     cell colour as ink; black_and_white_symbols_only renders white
//     background with black ink
//   - backing-store geometry: canvas.width/height equal the element content
//     box times devicePixelRatio (guards the stuck-300x150 crop/stretch
//     regression; the worker sizes the buffer from the element box)
//
// Seeded document: 6x2, three 2x2 blocks (red/green/blue) so each colour has
// a large target cell; zoom 400 makes a cell 4*config.min_cell_px_at_100pct
// (64 device px at dpr 1). Sampling mirrors the worker's shader mapping
// (map = ((frag - origin)/cell, y down) with origin = (w/2 - (cx+0.5)*cell,
// h/2 + (cy+0.5)*cell)); samples sit at (i+0.5)/17 fractions, keeping the
// nearest sample ~2px clear of cell edges (grid lines) and glyph-edge
// antialiasing, so binarization is stable.
//
// WebGL canvases composite directly: toDataURL/drawImage return blank without
// preserveDrawingBuffer, so pixels are read via element screenshots decoded
// with pngjs — never via in-page canvas readback.
import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import {
  chartCanvas,
  openDocument,
  seedStore,
  showChart,
  storeWith,
  styleRadio,
  zoomInput,
} from './helpers';
import type { SeededDocument, SeededStore } from './helpers';

/** config.min_cell_px_at_100pct (specs/m2-chart-core.allium config block). */
const MIN_CELL_PX = 16;

const STYLES = [
  { name: 'Symbols on colored background', token: 'symbols_on_colored_background' },
  { name: 'Colored symbols only', token: 'colored_symbols_only' },
  { name: 'Black and white symbols only', token: 'black_and_white_symbols_only' },
] as const;

const COLORS = [
  { name: 'red', hex: '#CC0000' },
  { name: 'green', hex: '#00CC00' },
  { name: 'blue', hex: '#0000CC' },
] as const;

function hexToRgb(hex: string): Pixel {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function threeColorDoc(): SeededDocument {
  const cells: SeededDocument['cells'] = [];
  // 2x2 blocks: colour 0 at columns 0-1, colour 1 at 2-3, colour 2 at 4-5.
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 6; x++) {
      cells.push({ x, y, color: x >> 1 });
    }
  }
  return {
    id: 'doc-1',
    name: 'Pixel Regression',
    width: 6,
    height: 2,
    palette: COLORS.map(({ name, hex }, i) => ({
      name: `Color ${i} ${name}`,
      rgb: hex,
    })),
    cells,
  };
}

type Pixel = [number, number, number];

type Frame = {
  png: PNG;
  /** Canvas backing-store size in device px. */
  bufW: number;
  bufH: number;
  dpr: number;
  centerX: number;
  centerY: number;
  zoom: number;
};

type CellSample = {
  /** Binarized ink pattern over the 17x17 sample grid, row-major. */
  pattern: string;
  /** Background colour taken from the four grid-corner samples. */
  background: Pixel;
  /** Most common colour among ink samples (the glyph interior). */
  ink: Pixel;
  inkCount: number;
};

const GRID = 17;

async function readGeometry(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector(
      'canvas[data-style]',
    ) as HTMLCanvasElement;
    return {
      bufW: canvas.width,
      bufH: canvas.height,
      clientW: canvas.clientWidth,
      clientH: canvas.clientHeight,
      dpr: window.devicePixelRatio,
      centerX: Number(canvas.getAttribute('data-center-x')),
      centerY: Number(canvas.getAttribute('data-center-y')),
      zoom: Number(canvas.getAttribute('data-zoom-pct')),
    };
  });
}

/** Capture the composited chart canvas (border box) plus its geometry. */
async function capture(page: Page): Promise<Frame> {
  const [shot, geometry] = await Promise.all([
    chartCanvas(page).screenshot(),
    readGeometry(page),
  ]);
  return {
    png: PNG.sync.read(shot),
    bufW: geometry.bufW,
    bufH: geometry.bufH,
    dpr: geometry.dpr,
    centerX: geometry.centerX,
    centerY: geometry.centerY,
    zoom: geometry.zoom,
  };
}

/**
 * Sample one chart cell on a 17x17 grid and classify ink vs background.
 * Device-space geometry mirrors the worker shader: x grows rightward from
 * origin_x; y grows upward in GL space from origin_y, so a cell's visual top
 * edge (fv=0) sits at the larger GL y. The PNG is top-down and starts at the
 * element's border box (1 CSS px border = dpr device px), hence the y flip
 * and the dpr offset.
 */
function sampleCell(frame: Frame, cellX: number, cellY: number): CellSample {
  const cell = (frame.zoom / 100) * MIN_CELL_PX * frame.dpr;
  // The origin is a property of the VIEW (the centre cell sits at the canvas
  // centre); sampled cells are indexed in document coordinates relative to
  // it. Using cellX/cellY here instead of the view centre aims every sample
  // at the canvas centre — the exact bug the first red run caught.
  const originX = frame.bufW / 2 - (frame.centerX + 0.5) * cell;
  const originY = frame.bufH / 2 + (frame.centerY + 0.5) * cell;
  const offsetX = frame.dpr;
  const offsetY = frame.dpr;

  const at = (fu: number, fv: number): Pixel => {
    const x = Math.round(originX + (cellX + fu) * cell) + offsetX;
    const glY = Math.round(originY - (cellY + 1 - fv) * cell);
    const y = frame.bufH - 1 - glY + offsetY;
    const clampedX = Math.min(Math.max(x, 0), frame.png.width - 1);
    const clampedY = Math.min(Math.max(y, 0), frame.png.height - 1);
    const i = (clampedY * frame.png.width + clampedX) * 4;
    return [frame.png.data[i], frame.png.data[i + 1], frame.png.data[i + 2]];
  };

  // The extreme grid samples sit ~2px inside the cell: outside every glyph
  // (glyphs span 2..14 of the 16-unit cell) and clear of the grid line, so
  // they read the cell background and must agree with each other.
  const corners: Pixel[] = [
    at(0.5 / GRID, 0.5 / GRID),
    at((GRID - 0.5) / GRID, 0.5 / GRID),
    at(0.5 / GRID, (GRID - 0.5) / GRID),
    at((GRID - 0.5) / GRID, (GRID - 0.5) / GRID),
  ];
  const sameCorner = (a: Pixel, b: Pixel) =>
    Math.max(
      Math.abs(a[0] - b[0]),
      Math.abs(a[1] - b[1]),
      Math.abs(a[2] - b[2]),
    ) <= 8;
  expect(
    corners.every((c) => sameCorner(c, corners[0])),
    `corner samples agree on the background (cell ${cellX},${cellY})`,
  ).toBe(true);
  const background = corners[0];

  let pattern = '';
  const inkColours = new Map<string, { count: number; pixel: Pixel }>();
  let inkCount = 0;
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const pixel = at((i + 0.5) / GRID, (j + 0.5) / GRID);
      const delta = Math.max(
        Math.abs(pixel[0] - background[0]),
        Math.abs(pixel[1] - background[1]),
        Math.abs(pixel[2] - background[2]),
      );
      const isInk = delta > 20;
      pattern += isInk ? 'X' : '.';
      if (isInk) {
        inkCount += 1;
        const key = pixel.map((v) => Math.round(v / 24)).join(',');
        const entry = inkColours.get(key) ?? { count: 0, pixel };
        entry.count += 1;
        inkColours.set(key, entry);
      }
    }
  }
  // With no ink samples at all (e.g. the opaque-atlas regression renders
  // every cell solid foreground), report the background as the ink colour so
  // the caller's legibility assertion fails with its own message.
  const modalInk = [...inkColours.values()].sort((a, b) => b.count - a.count)[0];
  return { pattern, background, ink: modalInk ? modalInk.pixel : background, inkCount };
}

const closeTo = (a: Pixel, b: Pixel, tolerance: number) =>
  Math.max(
    Math.abs(a[0] - b[0]),
    Math.abs(a[1] - b[1]),
    Math.abs(a[2] - b[2]),
  ) <= tolerance;

test('Chart pixels: glyphs render per colour, identically across styles, with per-style colouring', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Create blank document' }),
  ).toBeVisible();
  const store: SeededStore = storeWith(threeColorDoc());
  await seedStore(page, store);
  await page.reload();
  await openDocument(page, 'Pixel Regression');
  await showChart(page);
  await zoomInput(page).fill('400');
  await expect(chartCanvas(page)).toHaveAttribute('data-zoom-pct', '400');
  await page.waitForTimeout(250);

  // Backing-store geometry: the worker sizes canvas.width/height to the
  // element content box times dpr (the stuck-300x150 regression shows up
  // here as a 300x150 buffer behind a ~720x540 CSS box).
  await test.step('backing store matches the element content box x dpr', async () => {
    const geometry = await readGeometry(page);
    expect(geometry.bufW).toBe(Math.round(geometry.clientW * geometry.dpr));
    expect(geometry.bufH).toBe(Math.round(geometry.clientH * geometry.dpr));
  });

  // Cell (0,0) belongs to colour 0, (2,0) to colour 1, (4,0) to colour 2
  // (sequential assignment: colour i -> glyph i of the set). The default
  // style is symbols_on_colored_background, so capture it without switching.
  const blockCells = [0, 2, 4] as const;
  const frames: Record<string, Frame> = {};
  const samples: Record<string, CellSample[]> = {};

  await test.step(`capture ${STYLES[0].token} (default style)`, async () => {
    await expect(chartCanvas(page)).toHaveAttribute(
      'data-style',
      STYLES[0].token,
    );
    frames[STYLES[0].token] = await capture(page);
    // The capture is the border box: the buffer must fit inside it.
    const frame = frames[STYLES[0].token];
    expect(frame.png.width).toBeGreaterThanOrEqual(frame.bufW + 2 * frame.dpr);
    expect(frame.png.height).toBeGreaterThanOrEqual(frame.bufH + 2 * frame.dpr);
    samples[STYLES[0].token] = blockCells.map((cellX) =>
      sampleCell(frame, cellX, 0),
    );
  });

  for (const { name, token } of STYLES.slice(1)) {
    await test.step(`capture ${token}`, async () => {
      await styleRadio(page, name).check();
      await expect(chartCanvas(page)).toHaveAttribute('data-style', token);
      await page.waitForTimeout(250);
      frames[token] = await capture(page);
      samples[token] = blockCells.map((cellX) =>
        sampleCell(frames[token], cellX, 0),
      );
    });
  }

  await test.step('every coloured cell shows glyph ink and background (no solid squares)', async () => {
    for (const { token } of STYLES) {
      for (const [colour, sample] of samples[token].entries()) {
        expect(
          sample.inkCount,
          `${token} colour ${colour}: glyph ink present`,
        ).toBeGreaterThanOrEqual(1);
        // Corner samples are background, ink samples differ from them: the
        // cell is a glyph over a background, not a solid block.
        expect(
          sample.inkCount,
          `${token} colour ${colour}: background visible`,
        ).toBeLessThan(GRID * GRID);
      }
    }
  });

  await test.step('different colours render distinct glyph patterns (unique per color)', async () => {
    for (const { token } of STYLES) {
      const [red, green, blue] = samples[token];
      expect(red.pattern, `${token}`).not.toBe(green.pattern);
      expect(green.pattern, `${token}`).not.toBe(blue.pattern);
      expect(red.pattern, `${token}`).not.toBe(blue.pattern);
    }
  });

  await test.step('a colour keeps the same glyph shape across all three styles', async () => {
    const [, ...laterStyles] = STYLES;
    for (const [colourIndex] of blockCells.entries()) {
      for (const { token } of laterStyles) {
        expect(
          samples[STYLES[0].token][colourIndex].pattern,
          `colour ${colourIndex} shape stable between ${STYLES[0].token} and ${token}`,
        ).toBe(samples[token][colourIndex].pattern);
      }
    }
  });

  await test.step('style colouring: colored background / colored ink / black ink on white', async () => {
    const white: Pixel = [255, 255, 255];
    const black: Pixel = [0, 0, 0];
    for (const [colourIndex, { hex }] of COLORS.entries()) {
      const expected = hexToRgb(hex);

      const onColored = samples.symbols_on_colored_background[colourIndex];
      expect(
        closeTo(onColored.background, expected, 20),
        `style 0 colour ${colourIndex}: background is the cell colour`,
      ).toBe(true);
      expect(
        closeTo(onColored.ink, white, 24),
        `style 0 colour ${colourIndex}: ink is white`,
      ).toBe(true);

      const coloredOnly = samples.colored_symbols_only[colourIndex];
      expect(
        closeTo(coloredOnly.background, white, 20),
        `style 1 colour ${colourIndex}: background is white`,
      ).toBe(true);
      expect(
        closeTo(coloredOnly.ink, expected, 24),
        `style 1 colour ${colourIndex}: ink is the cell colour`,
      ).toBe(true);

      const blackWhite = samples.black_and_white_symbols_only[colourIndex];
      expect(
        closeTo(blackWhite.background, white, 20),
        `style 2 colour ${colourIndex}: background is white`,
      ).toBe(true);
      expect(
        closeTo(blackWhite.ink, black, 24),
        `style 2 colour ${colourIndex}: ink is black`,
      ).toBe(true);
    }
  });
});
