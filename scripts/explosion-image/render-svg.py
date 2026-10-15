"""Renders the mod's explosion (frames.json) as one looping SVG: a terminal panel over a desktop panel.

Both panels share one image, so they loop on one clock and stay in step.
"""
import json, re, sys

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
terminal_height = (ROWS + 3) * CELL_H + 2 * PAD
CAPTION_H = 28
DESKTOP_H = 230
height = CAPTION_H + terminal_height + CAPTION_H + DESKTOP_H
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
<text x="2" y="19" fill="#8a8f98" font-size="14">Terminal</text>
<g transform="translate(0 {CAPTION_H})">
<rect width="{width}" height="{terminal_height}" rx="8" fill="#1d1f21"/>
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
parts.append('</g>')

def loop_desktop(svg):
    """Stretches each one-shot SMIL animation to the shared cycle and repeats it, holding its last value."""
    def stretch(match):
        tag = match.group(0)
        dur = float(re.search(r'dur="([\d.]+)ms"', tag).group(1))
        values = re.search(r'values="([^"]*)"', tag).group(1).split(';')
        key_times = [float(t) * dur / cycle_ms for t in re.search(r'keyTimes="([^"]*)"', tag).group(1).split(';')]
        tag = re.sub(r'dur="[^"]*"', f'dur="{cycle_ms}ms"', tag)
        tag = re.sub(r'values="[^"]*"', 'values="' + ';'.join(values + [values[-1]]) + '"', tag)
        tag = re.sub(r'keyTimes="[^"]*"', 'keyTimes="' + ';'.join(f'{t:.4f}' for t in key_times + [1]) + '"', tag)
        return tag.replace('fill="freeze"', 'repeatCount="indefinite"')
    return re.sub(r'<animate(Transform)?\b[^>]*/>', stretch, svg)

desktop_svg = loop_desktop(spec['desktopSvg'])
svg_width = int(re.search(r'width="(\d+)"', desktop_svg).group(1))
svg_height = int(re.search(r'height="(\d+)"', desktop_svg).group(1))
desktop_top = CAPTION_H + terminal_height + CAPTION_H
parts.append(f'<text x="2" y="{desktop_top - 9}" fill="#8a8f98" font-size="14">Desktop app</text>')
parts.append(f'<g transform="translate(0 {desktop_top})">')
parts.append(f'<rect width="{width}" height="{DESKTOP_H}" rx="8" fill="#262624"/>')
parts.append(desktop_svg.replace('<svg ', f'<svg x="{(width - svg_width) // 2}" y="{PAD}" ', 1))
parts.append(f'<text class="label" x="{PAD}" y="{PAD + svg_height + 26}" fill="#e5534b" font-weight="bold" font-size="14">{label}</text>')
parts.append('</g>')
parts.append('</svg>\n')
open(out_path, 'w').write('\n'.join(parts))
print(out_path, sum(len(p) for p in parts), 'bytes')
