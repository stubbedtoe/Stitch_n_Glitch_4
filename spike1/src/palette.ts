/**
 * Sample thread palette for the benchmark.
 *
 * NOTE: hex values are approximate sRGB conversions of well-known DMC floss
 * colors, sufficient for benchmarking. CIEDE2000 nearest-color search cost is
 * independent of the exact values; production palette data (F-010) will use
 * curated official conversions.
 */
export interface ThreadColor {
  code: string
  name: string
  hex: string
}

export const DMC_SAMPLE: ThreadColor[] = [
  { code: '310', name: 'Black', hex: '#000000' },
  { code: '433', name: 'Brown MED', hex: '#8A5A44' },
  { code: '434', name: 'Brown LT', hex: '#9B6A49' },
  { code: '435', name: 'Brown VY LT', hex: '#C08A4B' },
  { code: '436', name: 'Tan', hex: '#B78E56' },
  { code: '437', name: 'Tan LT', hex: '#D0AC7E' },
  { code: '738', name: 'Tan VY LT', hex: '#E3C194' },
  { code: '739', name: 'Tan ULTRA LT', hex: '#F0E0C0' },
  { code: '640', name: 'Beige VY DK', hex: '#A08860' },
  { code: '642', name: 'Beige DK', hex: '#9F8064' },
  { code: '644', name: 'Beige MED', hex: '#C8BB9E' },
  { code: '3782', name: 'LT Mocha Brown', hex: '#9C8460' },
  { code: '3031', name: 'Mocha Brown VY DK', hex: '#4A3428' },
  { code: '3799', name: 'Pewter VY DK', hex: '#3A3436' },
  { code: '413', name: 'Pewter DK', hex: '#565A63' },
  { code: '414', name: 'Pewter MED', hex: '#8C8F9E' },
  { code: '415', name: 'Pearl Gray', hex: '#B8BCD0' },
  { code: '762', name: 'Pearl Gray VY LT', hex: '#D6D8E4' },
  { code: '169', name: 'Pewter LT', hex: '#848A96' },
  { code: '317', name: 'Gray DK', hex: '#6B6270' },
  { code: '318', name: 'Steel Gray LT', hex: '#B0B4C0' },
  { code: '400', name: 'Mahogany DK', hex: '#813428' },
  { code: '402', name: 'Mahogany VY LT', hex: '#C08080' },
  { code: '498', name: 'Red DK', hex: '#8A1E2D' },
  { code: '666', name: 'Bright Red', hex: '#CE1B33' },
  { code: '321', name: 'Red', hex: '#C72B3B' },
  { code: '304', name: 'Red MED', hex: '#A6203B' },
  { code: '815', name: 'Garnet MED', hex: '#8E2344' },
  { code: '814', name: 'Garnet DK', hex: '#7B1B3E' },
  { code: '606', name: 'Bright Orange-Red', hex: '#FA3200' },
  { code: '900', name: 'Burnt Orange DK', hex: '#D3521A' },
  { code: '946', name: 'Burnt Orange MED', hex: '#EE5626' },
  { code: '947', name: 'Burnt Orange', hex: '#FC8405' },
  { code: '741', name: 'Tangerine MED', hex: '#FC9704' },
  { code: '742', name: 'Tangerine LT', hex: '#FCB404' },
  { code: '743', name: 'Yellow MED', hex: '#FEDB04' },
  { code: '744', name: 'Yellow PALE', hex: '#FCF404' },
  { code: '745', name: 'Yellow LT PALE', hex: '#FCECA4' },
  { code: '726', name: 'Yellow PL LT', hex: '#FAE904' },
  { code: '729', name: 'Old Gold MED', hex: '#DBA43A' },
  { code: '680', name: 'Old Gold DK', hex: '#B27A2E' },
  { code: '935', name: 'Avocado DK', hex: '#445520' },
  { code: '936', name: 'Avocado MED', hex: '#5C6E28' },
  { code: '3347', name: 'Yellow Green DK', hex: '#5D8A4C' },
  { code: '3348', name: 'Yellow Green LT', hex: '#64B36B' },
  { code: '470', name: 'Green LT', hex: '#758E4C' },
  { code: '471', name: 'Green VY LT', hex: '#9EC27A' },
  { code: '472', name: 'Green ULTRA LT', hex: '#C5E0A6' },
  { code: '503', name: 'Blue Green MED', hex: '#2F6B5E' },
  { code: '500', name: 'Blue Green DK', hex: '#1E5945' },
  { code: '3818', name: 'Emerald Ult DK', hex: '#00503A' },
  { code: '699', name: 'Green DK', hex: '#047251' },
  { code: '907', name: 'Parrot Green LT', hex: '#A3D357' },
  { code: '911', name: 'Emerald MED', hex: '#209268' },
  { code: '913', name: 'Green VY LT', hex: '#8FD3AC' },
  { code: '912', name: 'Emerald LT', hex: '#36B786' },
  { code: '3817', name: 'Turquoise LT', hex: '#3AAE9C' },
  { code: '3765', name: 'Peacock Blue', hex: '#0AA5A8' },
  { code: '825', name: 'Blue DK', hex: '#21364C' },
  { code: '792', name: 'Cornflower Blue DK', hex: '#2A407E' },
  { code: '797', name: 'Royal Blue', hex: '#2D2C89' },
  { code: '820', name: 'Royal Blue DK', hex: '#172070' },
  { code: '813', name: 'Blue LT', hex: '#A5C5D9' },
  { code: '775', name: 'Baby Blue', hex: '#D6EAF8' },
  { code: '828', name: 'Blue Ult VY LT', hex: '#DDE3F0' },
  { code: '3756', name: 'Baby Blue Ult VY LT', hex: '#E9F0F8' },
  { code: '550', name: 'Violet VY DK', hex: '#58086C' },
  { code: '552', name: 'Violet MED', hex: '#8032A8' },
  { code: '554', name: 'Violet LT', hex: '#A868C8' },
  { code: '333', name: 'Blue Violet VY DK', hex: '#56357B' },
  { code: '340', name: 'Blue Violet MED', hex: '#706EA9' },
]

export interface Rgb {
  r: number
  g: number
  b: number
}

export function hexToRgb(hex: string): Rgb {
  const v = parseInt(hex.slice(1), 16)
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff }
}

/**
 * Pick `n` evenly spaced colors from the sample palette, preserving hue
 * spread at every size (the full table is ordered roughly by hue family).
 */
export function paletteSubset(n: number): Rgb[] {
  const all = DMC_SAMPLE.map((c) => hexToRgb(c.hex))
  if (n >= all.length) return all
  const out: Rgb[] = []
  for (let i = 0; i < n; i++) {
    out.push(all[Math.floor((i * all.length) / n)])
  }
  return out
}
