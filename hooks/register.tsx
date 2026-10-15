import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, PluginOptions, Register } from 'claude-code'

import type { Blast, BlastKind, BlastReading, PromptReport } from '../types'


const FRAME_MS = 33
const FRAME_COUNT = 48
const MAX_COLUMNS = 64
const ROWS = 9
const RASTER_KEY = 'boom'
const SVG_WIDTH_PX = 260
const SVG_HEIGHT_PX = 150
const SVG_KEYFRAMES = 14
const DEBRIS_COUNT = 44
const FIREBALL_BLOBS = 10
const SMOKE_PUFFS = 9
const FLASH_FRAMES = 6
const REPORT_DIR = '.claude/cache-boom'

const DEFAULT_COLOR = 0x01000000

const blast = atom({ plugin: 'cache-boom', key: 'blast' } as const, null)

export type BlastSettings = {
  // Below this a write is too small to be worth a bang (one tool result, a short prompt).
  missMinWriteTokens: number
  hugeWriteTokens: number
  // The label outlives the animation long enough to be read.
  labelLingerMs: number
}

const DEFAULT_SETTINGS: BlastSettings = { missMinWriteTokens: 5_000, hugeWriteTokens: 50_000, labelLingerMs: 8_000 }

// The engine checks options against the manifest; this still refuses a value it cannot use, naming the field.
export function readSettings(options: PluginOptions): { settings: BlastSettings; problems: string[] } {
  const problems: string[] = []
  const field = (name: string, fallback: number) => {
    const value = options[name]
    if (value === undefined) {
      return fallback
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      problems.push(`${name} must be a number of 0 or more, got ${JSON.stringify(value)}; using ${fallback}`)
      return fallback
    }
    return value
  }
  return {
    settings: {
      missMinWriteTokens: field('missMinWriteTokens', DEFAULT_SETTINGS.missMinWriteTokens),
      hugeWriteTokens: field('hugeWriteTokens', DEFAULT_SETTINGS.hugeWriteTokens),
      labelLingerMs: field('labelLingerSeconds', DEFAULT_SETTINGS.labelLingerMs / 1000) * 1000,
    },
    problems,
  }
}

// A miss writes more than it reads: the cached prefix lapsed or changed.
export function classifyUsage(usage: ModelUsage, settings: BlastSettings = DEFAULT_SETTINGS): BlastKind | null {
  const written = usage.cache_creation_input_tokens
  if (written >= settings.missMinWriteTokens && written > usage.cache_read_input_tokens) {
    return 'miss'
  }
  if (written >= settings.hugeWriteTokens) {
    return 'write'
  }
  return null
}

type Particle = { angle: number; speed: number; lifespan: number }

// Fixed seed so every explosion has the same shape and tests can read frames.
function seededRandom(): () => number {
  let seed = 0x9e3779b9
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x100000000
  }
}

function particlesFor(count: number): Particle[] {
  const random = seededRandom()
  return Array.from({ length: count }, () => ({
    angle: random() * Math.PI * 2,
    speed: 0.35 + random() * 0.65,
    lifespan: 0.55 + random() * 0.45,
  }))
}

const PARTICLES = particlesFor(70)

const GLYPHS_BY_HEAT = ['█', '▓', '▒', '░', '*', '·']

function heatColor(heat: number): number {
  const stops = [0xffffff, 0xfff176, 0xffa000, 0xe53935, 0x6d4c41, 0x424242]
  const scaled = Math.min(heat, 0.999) * (stops.length - 1)
  const low = stops[Math.floor(scaled)] ?? 0xffffff
  const high = stops[Math.ceil(scaled)] ?? low
  const mix = scaled - Math.floor(scaled)
  const channel = (shift: number) => {
    const a = (low >> shift) & 0xff
    const b = (high >> shift) & 0xff
    return Math.round(a + (b - a) * mix) << shift
  }
  return channel(16) | channel(8) | channel(0)
}

type Layout = { centerX: number; centerY: number; reachX: number; reachY: number; rows: number }

function layoutFor(columns: number, rows: number): Layout {
  // Terminal cells are about twice as tall as wide, so x travels double.
  const reachY = rows * 0.55
  return {
    centerX: (columns - 1) / 2,
    centerY: (rows - 1) / 2,
    reachX: Math.min(reachY * 2.2, columns / 2),
    reachY,
    rows,
  }
}

// Where a particle sits at a point of the animation, in cells, or null once it has burnt out.
function particleAt(particle: Particle, progress: number, layout: Layout): { x: number; y: number; heat: number } | null {
  const age = progress / particle.lifespan
  if (age >= 1) {
    return null
  }
  const travel = 1 - (1 - age) ** 2
  const gravity = age * age * layout.rows * 0.35
  return {
    x: layout.centerX + Math.cos(particle.angle) * particle.speed * travel * layout.reachX,
    y: layout.centerY + Math.sin(particle.angle) * particle.speed * travel * layout.reachY + gravity,
    heat: age,
  }
}

export function drawFrame(frame: number, columns: number, rows: number): string {
  const words = new Uint32Array(columns * rows * 3)
  for (let cell = 0; cell < columns * rows; cell++) {
    words.set([0x20, DEFAULT_COLOR, DEFAULT_COLOR], cell * 3)
  }
  const plot = (x: number, y: number, heat: number) => {
    const col = Math.round(x)
    const row = Math.round(y)
    if (col < 0 || col >= columns || row < 0 || row >= rows) {
      return
    }
    const glyph = GLYPHS_BY_HEAT[Math.min(GLYPHS_BY_HEAT.length - 1, Math.floor(heat * GLYPHS_BY_HEAT.length))] ?? '·'
    words.set([glyph.codePointAt(0) ?? 0x20, heatColor(heat), DEFAULT_COLOR], (row * columns + col) * 3)
  }

  const layout = layoutFor(columns, rows)
  if (frame < FLASH_FRAMES) {
    const radius = (frame + 1) * 0.6
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const distance = Math.hypot((col - layout.centerX) / 2, row - layout.centerY)
        if (distance <= radius) {
          plot(col, row, (distance / radius) * 0.4 + frame / FLASH_FRAMES * 0.2)
        }
      }
    }
  }

  for (const particle of PARTICLES) {
    const spot = particleAt(particle, frame / FRAME_COUNT, layout)
    if (spot) {
      plot(spot.x, spot.y, spot.heat)
    }
  }

  return encodeBase64(new Uint8Array(words.buffer))
}

function cssColor(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, '0')}`
}

const round = (n: number) => Math.round(n * 10) / 10

// Keyframes bunch up at the start, where the blast moves fastest.
const SVG_KEY_TIMES = Array.from({ length: SVG_KEYFRAMES + 1 }, (_, i) => round((i / SVG_KEYFRAMES) ** 1.6 * 1000) / 1000)

function animate(attribute: string, values: Array<string | number>, keyTimes: number[] = SVG_KEY_TIMES): string {
  const durationMs = FRAME_COUNT * FRAME_MS
  return `<animate attributeName="${attribute}" dur="${durationMs}ms" values="${values.join(';')}" keyTimes="${keyTimes.join(';')}" fill="freeze"/>`
}

// Burning debris: streaks that leave fast, slow down, fall and char.
function debrisSvg(random: () => number, centerX: number, centerY: number): string {
  const streaks: string[] = []
  for (let i = 0; i < DEBRIS_COUNT; i++) {
    const angle = random() * Math.PI * 2
    const reach = 25 + random() ** 0.7 * 110
    const lifespan = 0.3 + random() * 0.4
    const position = (t: number) => {
      const age = Math.min(t / lifespan, 1)
      const travel = 1 - (1 - age) ** 3
      return {
        x: centerX + Math.cos(angle) * reach * travel,
        y: centerY + Math.sin(angle) * reach * 0.6 * travel + age * age * 60,
        age,
      }
    }
    const x1: number[] = []
    const y1: number[] = []
    const x2: number[] = []
    const y2: number[] = []
    const stroke: string[] = []
    const opacity: number[] = []
    for (const t of SVG_KEY_TIMES) {
      const head = position(t)
      // The tail lags the head, so a streak is long while fast and shrinks as it slows.
      const tail = position(Math.max(0, t - 0.06))
      x1.push(round(tail.x))
      y1.push(round(tail.y))
      x2.push(round(head.x))
      y2.push(round(head.y))
      stroke.push(cssColor(heatColor(head.age * 0.9)))
      opacity.push(head.age >= 1 ? 0 : 1)
    }
    const width = round(1.5 + random() * 2)
    streaks.push(
      `<line stroke-width="${width}" stroke-linecap="round">${animate('x1', x1)}${animate('y1', y1)}${animate('x2', x2)}${animate('y2', y2)}${animate('stroke', stroke)}${animate('opacity', opacity)}</line>`,
    )
  }
  return streaks.join('')
}

// The fireball is lumpy: blobs that swell, cool from white to soot, and shrink.
function fireballSvg(random: () => number, centerX: number, centerY: number): string {
  const keyTimes = [0, 0.04, 0.12, 0.25, 0.45, 0.7, 1]
  const palette = ['#ffffff', '#fff7c2', '#ffb300', '#f4511e', '#8d2a14', '#3e2723', '#3e2723']
  const blobs: string[] = []
  for (let i = 0; i < FIREBALL_BLOBS; i++) {
    const angle = (i / FIREBALL_BLOBS) * Math.PI * 2 + random()
    const offset = i === 0 ? 0 : 12 + random() * 18
    const peak = i === 0 ? 22 : 10 + random() * 14
    const cx = round(centerX + Math.cos(angle) * offset)
    const cy = round(centerY + Math.sin(angle) * offset * 0.7)
    const radius = [0, peak * 0.8, peak, peak * 1.05, peak * 0.8, peak * 0.4, 0].map(round)
    // Each blob burns a little hotter or cooler, so the ball is mottled.
    const shift = Math.floor(random() * 2)
    const colors = palette.slice(shift).concat(palette.slice(palette.length - shift))
    blobs.push(
      `<circle cx="${cx}" cy="${cy}" r="0">${animate('r', radius, keyTimes)}${animate('fill', colors, keyTimes)}${animate('opacity', [1, 1, 1, 0.95, 0.8, 0.3, 0], keyTimes)}</circle>`,
    )
  }
  return `<g filter="url(#ragged)">${blobs.join('')}</g>`
}

// Smoke rolls up out of the fireball once it starts to cool.
function smokeSvg(random: () => number, centerX: number, centerY: number): string {
  const keyTimes = [0, 0.18, 0.4, 0.75, 1]
  const puffs: string[] = []
  for (let i = 0; i < SMOKE_PUFFS; i++) {
    const cx = round(centerX + (random() - 0.5) * 50)
    const rise = 25 + random() * 30
    const peak = 12 + random() * 14
    const cy = [centerY, centerY, centerY - rise * 0.4, centerY - rise, centerY - rise * 1.2].map(round)
    puffs.push(
      `<circle cx="${cx}" r="0" fill="${random() < 0.5 ? '#7a6f69' : '#5b524d'}">${animate('cy', cy, keyTimes)}${animate('r', [0, peak * 0.4, peak, peak * 1.3, peak * 1.4].map(round), keyTimes)}${animate('opacity', [0, 0.9, 0.8, 0.4, 0], keyTimes)}</circle>`,
    )
  }
  return `<g filter="url(#ragged)">${puffs.join('')}</g>`
}

// The desktop has no Raster, so it draws the explosion as one SMIL-animated SVG.
// The surface plays it by itself: no redraws over the wire while it runs.
export function drawAnimatedSvg(blastId: number): string {
  const random = seededRandom()
  const width = SVG_WIDTH_PX
  const height = SVG_HEIGHT_PX
  const centerX = width / 2
  const centerY = height * 0.55
  const durationMs = FRAME_COUNT * FRAME_MS

  const flash =
    `<circle cx="${centerX}" cy="${centerY}" r="0" fill="url(#flash)">` +
    animate('r', [0, 120, 130, 130], [0, 0.03, 0.08, 1]) +
    animate('opacity', [1, 1, 0, 0], [0, 0.03, 0.1, 1]) +
    `</circle>`
  const shockwave =
    `<circle cx="${centerX}" cy="${centerY}" r="0" fill="none" stroke="#ffe0b2">` +
    animate('r', [0, 40, 110, 130], [0, 0.05, 0.25, 1]) +
    animate('stroke-width', [8, 5, 1, 0], [0, 0.05, 0.25, 1]) +
    animate('opacity', [1, 0.9, 0, 0], [0, 0.05, 0.25, 1]) +
    `</circle>`
  // A hard jolt in the first fifth of a second.
  const shake = `<animateTransform attributeName="transform" type="translate" dur="${durationMs}ms" values="0,0;-6,3;5,-4;-4,4;3,-2;-1,1;0,0;0,0" keyTimes="0;0.02;0.04;0.06;0.08;0.1;0.13;1" fill="freeze"/>`

  // data-blast makes each explosion a new source, so a second blast replays instead of keeping the finished one.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-blast="${blastId}">` +
    `<defs><radialGradient id="flash"><stop offset="0" stop-color="#ffffff"/><stop offset="0.35" stop-color="#fff59d" stop-opacity="0.9"/><stop offset="1" stop-color="#ff6f00" stop-opacity="0"/></radialGradient>` +
    // Turbulence tears the round blobs into ragged flame and smoke edges.
    `<filter id="ragged" x="-30%" y="-30%" width="160%" height="160%"><feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="16" xChannelSelector="R" yChannelSelector="G"/></filter></defs>` +
    `<g>${shake}` +
    flash +
    smokeSvg(random, centerX, centerY) +
    fireballSvg(random, centerX, centerY) +
    debrisSvg(random, centerX, centerY) +
    shockwave +
    `</g></svg>`
  )
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// es2023 has no Uint8Array.toBase64, so encode by hand.
function encodeBase64(bytes: Uint8Array): string {
  let encoded = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const triple = (a << 16) | (b << 8) | c
    encoded += BASE64_ALPHABET[(triple >> 18) & 63]
    encoded += BASE64_ALPHABET[(triple >> 12) & 63]
    encoded += i + 1 < bytes.length ? BASE64_ALPHABET[(triple >> 6) & 63] : '='
    encoded += i + 2 < bytes.length ? BASE64_ALPHABET[triple & 63] : '='
  }
  return encoded
}

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)
}

// The module reloads whole, so these restart with each load as the hooks do.
let bandRequestId: string | null = null
let rasterColumns = MAX_COLUMNS
let stopAnimation: (() => void) | null = null
let promptReport: PromptReport = { blastCount: 0, lastBlast: null }
let blastSequence = 0
let settings = DEFAULT_SETTINGS

async function writePromptReport($: EngineInterface) {
  const home = await $.env.get('HOME')
  if (!home) {
    $.ui.log('cache-boom: HOME is unset, so the status line report was not written')
    return
  }
  const sessionId = await $.session.id()
  await $.fs.write(`${home}/${REPORT_DIR}/${sessionId}.json`, JSON.stringify(promptReport))
}

async function explode($: EngineInterface, reading: BlastReading) {
  stopAnimation?.()
  promptReport = { blastCount: promptReport.blastCount + 1, lastBlast: reading }
  await writePromptReport($)
  blastSequence += 1
  await update($, blast, () => ({ ...reading, id: blastSequence, frame: 0 }))
  let frame = 0
  const timer = $.clock.every(FRAME_MS, () => {
    frame += 1
    if (frame >= FRAME_COUNT) {
      timer.cancel()
      void update($, blast, current => current && { ...current, frame: FRAME_COUNT })
      const linger = $.clock.after(settings.labelLingerMs, () => {
        stopAnimation = null
        void update($, blast, () => null)
      })
      stopAnimation = () => {
        linger.cancel()
        stopAnimation = null
      }
      return
    }
    if (bandRequestId) {
      void $.ui.blit({ requestId: bandRequestId, key: RASTER_KEY, cells: drawFrame(frame, rasterColumns, ROWS) })
    }
  })
  stopAnimation = () => {
    timer.cancel()
    stopAnimation = null
  }
}

export const register: Register = (on, options) => {
  const configured = readSettings(options)
  settings = configured.settings

  on('session.start', async ($, e, next) => {
    for (const problem of configured.problems) {
      $.ui.log(`cache-boom: ${problem}`)
    }
    return next(e)
  })

  // commands/boom.md declares the command, so the desktop lists it before the session's engine starts.
  on('command.run', { command: 'cache-boom:boom' }, async $ => {
    await explode($, { kind: 'miss', cacheWriteTokens: 87_400, cacheReadTokens: 1_200, isSubagent: false })
    return { text: 'Test explosion played.' }
  })

  on('prompt.submit', async ($, e, next) => {
    promptReport = { blastCount: 0, lastBlast: null }
    // The report only feeds a status line, so a failed write must not hold up the prompt.
    await writePromptReport($).catch((error: unknown) => {
      $.ui.log(`cache-boom: status line report not written: ${String(error)}`)
    })
    return next(e)
  })

  // Every loop steps through here: main, subagents, and their subagents.
  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    const kind = response.usage ? classifyUsage(response.usage, settings) : null
    if (kind && response.usage) {
      await explode($, {
        kind,
        cacheWriteTokens: response.usage.cache_creation_input_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens,
        isSubagent: e.agentId !== undefined,
      })
    }
    return response
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current: Blast | null = await read($, blast)
    if (e.props.hasSurvey || current === null) {
      return next(e)
    }
    bandRequestId = e.requestId
    rasterColumns = Math.max(1, Math.min(MAX_COLUMNS, e.props.bodyColumns))

    const where = current.isSubagent ? 'subagent ' : ''
    const label =
      current.kind === 'miss'
        ? `BOOM: ${where}prompt cache miss, ${formatTokens(current.cacheWriteTokens)} written, ${formatTokens(current.cacheReadTokens)} read`
        : `BOOM: ${where}huge cache write, ${formatTokens(current.cacheWriteTokens)} tokens`

    const elements = $.ui.resolve(e)
    const { Box, Text } = elements
    const isAnimating = current.frame < FRAME_COUNT
    if (isAnimating && e.surface === 'terminal' && 'Raster' in elements) {
      const { Raster } = elements
      return (
        <Box flexDirection="column">
          <Raster key={RASTER_KEY} columns={rasterColumns} rows={ROWS} cells={drawFrame(current.frame, rasterColumns, ROWS)} />
          <Text color="red" bold>{label}</Text>
        </Box>
      )
    }
    if (isAnimating && 'Svg' in elements) {
      const { Svg } = elements
      return (
        <Box flexDirection="column">
          <Svg source={drawAnimatedSvg(current.id)} alt={label} isInteractive />
          <Text color="red" bold>{label}</Text>
        </Box>
      )
    }
    return (
      <Box>
        <Text color="red" bold>{label}</Text>
      </Box>
    )
  })
}
