// Prints every explosion frame the mod draws as JSON: one list of [col, row, glyph, rgb] cells per frame,
// plus the desktop's animated SVG.
const modPath = process.argv[2]
const { drawAnimatedSvg, drawFrame } = await import(modPath)
const COLUMNS = 64, ROWS = 9, FRAME_COUNT = 48, DEFAULT_COLOR = 0x01000000
const frames = []
for (let frame = 0; frame < FRAME_COUNT; frame++) {
  const bytes = Uint8Array.from(atob(drawFrame(frame, COLUMNS, ROWS)), (c) => c.charCodeAt(0))
  const words = new Uint32Array(bytes.buffer)
  const cells = []
  for (let cell = 0; cell < COLUMNS * ROWS; cell++) {
    const [glyph, fg] = [words[cell * 3], words[cell * 3 + 1]]
    if (glyph !== 0x20) cells.push([cell % COLUMNS, Math.floor(cell / COLUMNS), String.fromCodePoint(glyph), fg === DEFAULT_COLOR ? null : fg])
  }
  frames.push(cells)
}
console.log(JSON.stringify({ columns: COLUMNS, rows: ROWS, frameMs: 33, frames, desktopSvg: drawAnimatedSvg(1) }))
