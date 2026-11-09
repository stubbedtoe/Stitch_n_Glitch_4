// Thin FFI shim for Spike S5. All spike logic lives in Gleam; this file only
// provides (a) DOM status/result sinks, (b) SVG-path rasterization through the
// browser canvas (Path2D fill) — a browser primitive with no Gleam equivalent,
// and (c) a contact-sheet PNG artifact for the results folder.

function ensureElement(id, tag) {
  let element = document.getElementById(id)
  if (element) return element
  element = document.createElement(tag)
  element.id = id
  document.getElementById('app').appendChild(element)
  return element
}

export function set_status(text) {
  ensureElement('s5-status', 'p').textContent = text
}

export function set_result(text) {
  ensureElement('s5-result', 'pre').textContent = text
}

export function set_error(text) {
  ensureElement('s5-error', 'pre').textContent = text
}

export function set_sheet(data_url) {
  const img = ensureElement('s5-sheet', 'img')
  img.className = 'sheet'
  img.src = data_url
}

// Rasterize SVG path data (16x16 glyph coordinate space) to alpha bitmaps.
// glyphs: List(#(path_d, fill_rule)) where fill_rule is "nonzero" | "evenodd".
// Returns List(Dynamic) of { width, height, pixels } with pixels = alpha 0..255
// as a plain JS array, decoded in Gleam via dynamic/decode.
export function rasterize(glyphs, cell, scale, offset_x, offset_y) {
  const size = Math.round(cell * scale)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const factor = (cell / 16) * scale

  return glyphs.map(([d, rule]) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, size, size)
    ctx.setTransform(factor, 0, 0, factor, offset_x * scale, offset_y * scale)
    ctx.fillStyle = '#000'
    ctx.fill(new Path2D(d), rule)
    const data = ctx.getImageData(0, 0, size, size).data
    const pixels = new Array(size * size)
    for (let i = 0; i < pixels.length; i++) pixels[i] = data[i * 4 + 3]
    return { width: size, height: size, pixels }
  })
}

// Contact sheet: one row per glyph, one column per cell size, white on black
// grid. Returns a PNG data URL for the results artifact.
export function glyph_sheet(glyphs, cell_sizes) {
  const pad = 2
  const label_w = 0
  const cols = cell_sizes.length
  const width = label_w + cols * (16 + pad) + pad
  const height = glyphs.length * (16 + pad) + pad
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#101418'
  ctx.fillRect(0, 0, width, height)
  glyphs.forEach(([d, rule], row) => {
    cell_sizes.forEach((cell, col) => {
      const x = label_w + pad + col * (16 + pad)
      const y = pad + row * (16 + pad)
      const ox = (16 - cell) / 2
      const oy = (16 - cell) / 2
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = '#fff'
      ctx.fillRect(x, y, 16, 16)
      ctx.setTransform(cell / 16, 0, 0, cell / 16, x + ox, y + oy)
      ctx.fillStyle = '#000'
      ctx.fill(new Path2D(d), rule)
      ctx.restore()
    })
  })
  return canvas.toDataURL('image/png')
}
