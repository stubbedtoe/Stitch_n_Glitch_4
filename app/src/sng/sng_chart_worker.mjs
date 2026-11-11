// F-009 WebGL2 symbol chart renderer — dedicated module worker (S3 worker
// architecture; PRD §7.2: Gleam owns the model, the renderer is a stateless
// function of it running off the UI thread). Each render message carries the
// committed view state; the worker only re-uploads the indexed texture and
// glyph atlas when the document data changes (pan/zoom/style are uniform
// updates over the same textures).
//
// The glyph atlas is rasterized from the SVG path data of sng/symbols — the
// SingleGlyphSource contract: the same path data feeds every consumer, no
// parallel glyph definition (PRD v1.14).

// ---------------------------------------------------------------------------
// GL state (per worker == per canvas)
// ---------------------------------------------------------------------------

let canvas = null;
let gl = null;

const GL = {
  program: null,
  uniforms: {},
  index_tex: null,
  atlas_tex: null,
};

// Document state (last uploaded version).
let chart_width = 0;
let chart_height = 0;
let palette = []; // [r, g, b] triples, 0..1
let glyph_of = []; // color index -> glyph index in the atlas
let atlas_paths = null;
let atlas_key = null;

const ATLAS_CELL = 64;
const STYLE_TOKENS = {
  symbols_on_colored_background: 0,
  colored_symbols_only: 1,
  black_and_white_symbols_only: 2,
};

self.onmessage = (event) => {
  const message = event.data;
  if (message == null) return;
  if (message.type === "init") {
    init(message.canvas);
  } else if (message.type === "render") {
    render(message);
  }
};

// ---------------------------------------------------------------------------
// Init: WebGL2 context + program
// ---------------------------------------------------------------------------

function init(offscreen) {
  if (!offscreen) return;
  canvas = offscreen;
  gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
  if (!gl) return;
  const program = build_program(gl, VERTEX_SHADER, FRAGMENT_SHADER);
  if (!program) {
    gl = null;
    return;
  }
  gl.useProgram(program);
  GL.program = program;
  const names = [
    "u_cells",
    "u_atlas",
    "u_cell_origin",
    "u_cell_size",
    "u_palette",
    "u_glyph_of",
    "u_chart_size",
    "u_glyph_count",
    "u_style",
    "u_grid_visible",
    "u_dpr",
    "u_canvas_size",
  ];
  for (const name of names) {
    GL.uniforms[name] = gl.getUniformLocation(program, name);
  }
  // Fullscreen triangle.
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const location = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  // Texture units: 0 = cell index texture, 1 = glyph atlas.
  gl.uniform1i(GL.uniforms.u_cells, 0);
  gl.uniform1i(GL.uniforms.u_atlas, 1);
  // Byte-aligned uploads: the index texture is one byte per cell, so chart
  // widths that are not multiples of 4 need UNPACK_ALIGNMENT 1 (the default
  // of 4 makes the driver expect padded rows and the upload fails with
  // GL_INVALID_OPERATION — the chart renders with an empty cell texture).
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.clearColor(1, 1, 1, 1);
}

function build_program(context, vertex_source, fragment_source) {
  const compile = (type, source) => {
    const shader = context.createShader(type);
    context.shaderSource(shader, source);
    context.compileShader(shader);
    if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
      console.warn("sng chart shader:", context.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  };
  const vertex = compile(context.VERTEX_SHADER, vertex_source);
  const fragment = compile(context.FRAGMENT_SHADER, fragment_source);
  if (!vertex || !fragment) return null;
  const program = context.createProgram();
  context.attachShader(program, vertex);
  context.attachShader(program, fragment);
  context.linkProgram(program);
  if (!context.getProgramParameter(program, context.LINK_STATUS)) {
    console.warn("sng chart program:", context.getProgramInfoLog(program));
    return null;
  }
  return program;
}

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D u_cells;      // R8UI: 0 = empty, else color index + 1
uniform sampler2D u_atlas;       // R8 glyph atlas, one 64px row of glyphs
uniform vec2 u_cell_origin;      // map = ((frag - origin) / cell_size), y down
uniform float u_cell_size;       // rendered cell size in device px
uniform vec4 u_palette[256];
uniform int u_glyph_of[256];     // color index -> glyph index (-1 = none)
uniform ivec2 u_chart_size;      // chart width x height in cells
uniform int u_glyph_count;
uniform int u_style;             // 0 colored bg, 1 colored symbols, 2 b/w
uniform bool u_grid_visible;
uniform float u_dpr;             // device pixel ratio (device-space guards)
uniform vec2 u_canvas_size;

out vec4 out_color;

void main() {
  vec2 map = vec2(
    (gl_FragCoord.x - u_cell_origin.x) / u_cell_size,
    (u_cell_origin.y - gl_FragCoord.y) / u_cell_size);
  ivec2 cell = ivec2(floor(map));
  vec2 local = fract(map);
  vec3 background = vec3(1.0);
  vec3 foreground = vec3(1.0);
  float coverage = 0.0;
  bool inside = cell.x >= 0 && cell.y >= 0
    && cell.x < u_chart_size.x && cell.y < u_chart_size.y;
  if (inside) {
    int color_index = int(texelFetch(u_cells, cell, 0).r) - 1;
    if (color_index >= 0) {
      int glyph = u_glyph_of[color_index];
      if (glyph >= 0 && glyph < u_glyph_count) {
        vec2 atlas_uv = vec2(
          (float(glyph) + local.x) / float(u_glyph_count), local.y);
        coverage = texture(u_atlas, atlas_uv).r;
      }
      vec3 thread = u_palette[color_index].rgb;
      if (u_style == 0) {
        // Symbols on colored background: the cell carries the thread color,
        // the glyph contrasts against it.
        background = thread;
        float luminance = dot(thread, vec3(0.299, 0.587, 0.114));
        foreground = luminance > 0.6 ? vec3(0.0) : vec3(1.0);
      } else if (u_style == 1) {
        // Colored symbols only: white background, thread-colored glyph.
        foreground = thread;
      } else {
        // Black and white symbols only.
        foreground = vec3(0.0);
      }
    }
  }
  vec3 color = mix(background, foreground, coverage);
  if (u_grid_visible && inside && u_cell_size >= 6.0 * u_dpr) {
    vec2 border = min(local, 1.0 - local) * u_cell_size;
    float line = 1.0 - smoothstep(0.0, 1.2, min(border.x, border.y));
    color = mix(color, vec3(0.78), line * 0.85);
  }
  out_color = vec4(color, 1.0);
}`;

// ---------------------------------------------------------------------------
// Render: apply document data (if any) then draw the current view state
// ---------------------------------------------------------------------------

function render(message) {
  if (!gl || !canvas) return;
  // Read the view first: the document upload (atlas rasterization) scales
  // with the device pixel ratio carried by the view.
  const view = message.view ?? {};
  const dpr = view.dpr || 1;
  if (message.document) {
    upload_document(message.document, dpr);
  }
  const css_width = Math.max(1, Math.round(view.cssWidth ?? canvas.width ?? 1));
  const css_height = Math.max(1, Math.round(view.cssHeight ?? canvas.height ?? 1));
  const width = Math.max(1, Math.round(css_width * dpr));
  const height = Math.max(1, Math.round(css_height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  gl.viewport(0, 0, width, height);

  const zoom = view.zoom ?? 100;
  const min_cell_px = view.minCellPx ?? 16;
  // Cell size in DEVICE px: the spec binds config.min_cell_px_at_100pct at
  // 100% zoom in visual (CSS) px, so the device-space cell scales by dpr —
  // the same space the backing store lives in.
  const cell_size = (zoom / 100) * min_cell_px * dpr;
  const center = view.center ?? [chart_width / 2, chart_height / 2];
  // The canvas center sits on the center of the current center cell.
  const origin_x = width / 2 - (center[0] + 0.5) * cell_size;
  const origin_y = height / 2 + (center[1] + 0.5) * cell_size;

  gl.uniform2f(GL.uniforms.u_cell_origin, origin_x, origin_y);
  gl.uniform1f(GL.uniforms.u_cell_size, cell_size);
  gl.uniform2i(GL.uniforms.u_chart_size, chart_width, chart_height);
  gl.uniform1i(GL.uniforms.u_glyph_count, atlas_count());
  gl.uniform1i(GL.uniforms.u_style, STYLE_TOKENS[view.style] ?? 0);
  gl.uniform1i(GL.uniforms.u_grid_visible, view.gridVisible ? 1 : 0);
  gl.uniform1f(GL.uniforms.u_dpr, dpr);
  gl.uniform2f(GL.uniforms.u_canvas_size, width, height);
  const flat_palette = new Float32Array(256 * 4);
  for (let i = 0; i < palette.length && i < 256; i++) {
    flat_palette[i * 4] = palette[i][0];
    flat_palette[i * 4 + 1] = palette[i][1];
    flat_palette[i * 4 + 2] = palette[i][2];
    flat_palette[i * 4 + 3] = 1;
  }
  gl.uniform4fv(GL.uniforms.u_palette, flat_palette);
  const glyph_table = new Int32Array(256);
  glyph_table.fill(-1);
  for (let i = 0; i < glyph_of.length && i < 256; i++) {
    glyph_table[i] = glyph_of[i];
  }
  gl.uniform1iv(GL.uniforms.u_glyph_of, glyph_table);

  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function atlas_count() {
  return atlas_paths ? atlas_paths.length : 0;
}

// ---------------------------------------------------------------------------
// Document upload: indexed texture + palette + glyph atlas
// ---------------------------------------------------------------------------

function upload_document(document, dpr) {
  chart_width = document.width ?? 0;
  chart_height = document.height ?? 0;

  // Cell index texture: one byte per cell (color + 1, 0 = empty).
  const data = new Uint8Array(chart_width * chart_height);
  for (const cell of document.cells ?? []) {
    const [x, y, color] = cell;
    if (x >= 0 && x < chart_width && y >= 0 && y < chart_height && color >= 0) {
      data[y * chart_width + x] = Math.min(color + 1, 255);
    }
  }
  if (GL.index_tex != null) {
    gl.deleteTexture(GL.index_tex);
  }
  GL.index_tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, GL.index_tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.R8UI, chart_width, chart_height, 0,
    gl.RED_INTEGER, gl.UNSIGNED_BYTE, data);

  palette = (document.palette ?? []).map(parse_hex_color);

  glyph_of = document.mapping ?? [];

  // Glyph atlas: rasterized from the SVG path data (SingleGlyphSource).
  const glyphs = document.glyphs ?? [];
  const key = JSON.stringify(glyphs.map((glyph) => glyph.path)) + "@" + (dpr || 1);
  if (key !== atlas_key) {
    atlas_key = key;
    atlas_paths = glyphs;
    build_atlas(glyphs, dpr || 1);
  }
}

function parse_hex_color(hex) {
  const value = parseInt(String(hex).replace("#", ""), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function build_atlas(glyphs, dpr) {
  if (GL.atlas_tex != null) {
    gl.deleteTexture(GL.atlas_tex);
    GL.atlas_tex = null;
  }
  if (!glyphs.length) return;
  const count = glyphs.length;
  // Atlas slots scale with the device pixel ratio so a glyph stays crisp up
  // to the zoom where its slot maps 1:1 onto the rendered cell.
  const cell = ATLAS_CELL * dpr;
  const offscreen = new OffscreenCanvas(cell * count, cell);
  const context = offscreen.getContext("2d", { willReadFrequently: true });
  // Transparent background: the atlas is a coverage mask read from the
  // alpha channel, so every non-ink pixel must have alpha 0. (Filling the
  // canvas with opaque paint here would make coverage all-ones and every
  // chart cell would render as a solid square — the glyph would never
  // show.) Glyph ink is opaque white on transparent black.
  context.clearRect(0, 0, offscreen.width, offscreen.height);
  context.fillStyle = "#fff";
  glyphs.forEach((glyph, index) => {
    context.save();
    context.translate(index * cell, 0);
    context.scale(cell / 16, cell / 16);
    try {
      context.fill(new Path2D(glyph.path), "evenodd");
    } catch {
      // Unparseable path data renders as an empty slot, never a crash.
    }
    context.restore();
  });
  const image = context.getImageData(0, 0, offscreen.width, offscreen.height);
  const coverage = new Uint8Array(cell * cell * count);
  for (let i = 0; i < coverage.length; i++) {
    coverage[i] = image.data[i * 4 + 3];
  }
  GL.atlas_tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, GL.atlas_tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.R8, offscreen.width, cell, 0,
    gl.RED, gl.UNSIGNED_BYTE, coverage);
}
