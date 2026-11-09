import type { QuantizeResult } from './messages.ts'

interface ProgramState {
  gl: WebGL2RenderingContext
  program: WebGLProgram
  positionLocation: number
  chartTextureLocation: WebGLUniformLocation | null
  paletteLocation: WebGLUniformLocation | null
}

const programs = new WeakMap<HTMLCanvasElement, ProgramState>()

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_chart;
uniform vec3 u_palette[16];
in vec2 v_uv;
out vec4 out_color;
void main() {
  int index = int(texture(u_chart, vec2(v_uv.x, 1.0 - v_uv.y)).r * 255.0 + 0.5);
  out_color = vec4(u_palette[index], 1.0);
}
`

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('WebGL2 shader allocation failed')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`WebGL2 shader compile failed: ${log ?? 'unknown error'}`)
  }
  return shader
}

function programFor(canvas: HTMLCanvasElement): ProgramState {
  const cached = programs.get(canvas)
  if (cached) return cached

  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: true,
  })
  if (!gl) throw new Error('WebGL2 is unavailable')

  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  const program = gl.createProgram()
  if (!program) throw new Error('WebGL2 program allocation failed')
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`WebGL2 program link failed: ${log ?? 'unknown error'}`)
  }

  const state: ProgramState = {
    gl,
    program,
    positionLocation: gl.getAttribLocation(program, 'a_position'),
    chartTextureLocation: gl.getUniformLocation(program, 'u_chart'),
    paletteLocation: gl.getUniformLocation(program, 'u_palette'),
  }
  programs.set(canvas, state)
  return state
}

function paletteFloats(palette: Uint8Array): Float32Array {
  const floats = new Float32Array(16 * 3)
  for (let i = 0; i < 16 * 3; i++) floats[i] = palette[i] / 255
  return floats
}

function readbackStats(gl: WebGL2RenderingContext, width: number, height: number) {
  const pixels = new Uint8Array(width * height * 4)
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  const unique = new Set<number>()
  let checksum = 0x811c9dc5
  for (let i = 0; i < pixels.length; i += 4) {
    unique.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2])
    checksum ^= pixels[i]
    checksum = Math.imul(checksum, 0x01000193) >>> 0
    checksum ^= pixels[i + 1]
    checksum = Math.imul(checksum, 0x01000193) >>> 0
    checksum ^= pixels[i + 2]
    checksum = Math.imul(checksum, 0x01000193) >>> 0
  }
  return { uniqueColors: unique.size, checksum }
}

export function renderChart(canvasId: string, chart: QuantizeResult) {
  const canvas = document.getElementById(canvasId)
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error(`Canvas #${canvasId} not found`)
  if (!(chart.indices instanceof Uint8Array)) throw new Error('Chart indices must be Uint8Array')
  if (!(chart.palette instanceof Uint8Array)) throw new Error('Chart palette must be Uint8Array')

  canvas.width = chart.width
  canvas.height = chart.height
  const { gl, program, positionLocation, chartTextureLocation, paletteLocation } = programFor(canvas)
  const started = performance.now()

  gl.viewport(0, 0, chart.width, chart.height)
  gl.useProgram(program)

  const vertexBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(positionLocation)
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

  const texture = gl.createTexture()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const rgbaIndices = new Uint8Array(chart.width * chart.height * 4)
  for (let i = 0, o = 0; i < chart.indices.length; i++, o += 4) {
    rgbaIndices[o] = chart.indices[i]
    rgbaIndices[o + 1] = chart.indices[i]
    rgbaIndices[o + 2] = chart.indices[i]
    rgbaIndices[o + 3] = 255
  }
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    chart.width,
    chart.height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    rgbaIndices,
  )

  gl.uniform1i(chartTextureLocation, 0)
  gl.uniform3fv(paletteLocation, paletteFloats(chart.palette))
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  gl.finish()

  const error = gl.getError()
  gl.deleteTexture(texture)
  gl.deleteBuffer(vertexBuffer)
  if (error !== gl.NO_ERROR) throw new Error(`WebGL2 draw failed with error ${error}`)

  const stats = readbackStats(gl, chart.width, chart.height)
  return {
    webgl2: true,
    renderMs: performance.now() - started,
    ...stats,
  }
}
