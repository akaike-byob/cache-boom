"""Renders the mod's explosion frames (frames.json) as a looping animated SVG terminal."""
import json, sys

frames_path, out_path = sys.argv[1], sys.argv[2]
spec = json.load(open(frames_path))
COLS, ROWS, FRAME_MS = spec['columns'], spec['rows'], spec['frameMs']
frames = spec['frames']
CELL_W, CELL_H, PAD = 10, 20, 16
PAUSE_MS = 1200
cycle_ms = len(frames) * FRAME_MS + PAUSE_MS
label = 'BOOM: prompt cache miss, 87.4k written, 1.2k read'
# Block glyphs become rects so they tile without font gaps.
BLOCK_OPACITY = {'█': 1.0, '▓': 0.75, '▒': 0.5, '░': 0.28}

width = COLS * CELL_W + 2 * PAD
height = (ROWS + 3) * CELL_H + 2 * PAD
blast_pct = 100 * len(frames) * FRAME_MS / cycle_ms
slot_pct = 100 * FRAME_MS / cycle_ms

def color(rgb):
    return '#ffffff' if rgb is None else f'#{rgb:06x}'

parts = [f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" font-family="Menlo, Monaco, Consolas, monospace" font-size="16">
<style>
.f {{ visibility: hidden; animation: slot {cycle_ms}ms infinite steps(1, end); }}
@keyframes slot {{ 0% {{ visibility: visible; }} {slot_pct:.3f}% {{ visibility: hidden; }} 100% {{ visibility: hidden; }} }}
.label {{ visibility: hidden; animation: blast {cycle_ms}ms infinite steps(1, end); }}
@keyframes blast {{ 0% {{ visibility: visible; }} {blast_pct:.3f}% {{ visibility: hidden; }} 100% {{ visibility: hidden; }} }}
</style>
<rect width="{width}" height="{height}" rx="8" fill="#1d1f21"/>
''']
for index, cells in enumerate(frames):
    parts.append(f'<g class="f" style="animation-delay:{index * FRAME_MS}ms">')
    for col, row, glyph, rgb in cells:
        x, y = PAD + col * CELL_W, PAD + row * CELL_H
        if glyph in BLOCK_OPACITY:
            parts.append(f'<rect x="{x}" y="{y}" width="{CELL_W}" height="{CELL_H}" fill="{color(rgb)}" fill-opacity="{BLOCK_OPACITY[glyph]}"/>')
        else:
            parts.append(f'<text x="{x + CELL_W / 2}" y="{y + CELL_H - 5}" text-anchor="middle" fill="{color(rgb)}">{glyph}</text>')
    parts.append('</g>')
label_y = PAD + ROWS * CELL_H + CELL_H - 4
prompt_y = label_y + 2 * CELL_H
parts.append(f'<text class="label" x="{PAD}" y="{label_y}" fill="#e53935" font-weight="bold">{label}</text>')
parts.append(f'<text x="{PAD}" y="{prompt_y}" fill="#8a8f98">&gt; <tspan fill="#c5c8c6">_</tspan></text>')
parts.append('</svg>\n')
open(out_path, 'w').write('\n'.join(parts))
print(out_path, sum(len(p) for p in parts), 'bytes')
