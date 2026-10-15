import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { Blast, BlastKind, BlastReading, PromptReport } from '../types'

// Below this a write is too small to be worth a bang (one tool result, a short prompt).
const MISS_MIN_WRITE_TOKENS = 5_000
const HUGE_WRITE_TOKENS = 50_000

const FRAME_MS = 33
const FRAME_COUNT = 48
const MAX_COLUMNS = 64
const ROWS = 9
const RASTER_KEY = 'boom'
const REPORT_DIR = '.claude/cache-boom'

const DEFAULT_COLOR = 0x01000000

const blast = atom({ plugin: 'cache-boom', key: 'blast' } as const, null)

// A miss writes more than it reads: the cached prefix lapsed or changed.
export function classifyUsage(usage: ModelUsage): BlastKind | null {
  const written = usage.cache_creation_input_tokens
  if (written >= MISS_MIN_WRITE_TOKENS && written > usage.cache_read_input_tokens) {
    return 'miss'
  }
  if (written >= HUGE_WRITE_TOKENS) {
    return 'write'
  }
  return null
}

type Particle = { angle: number; speed: number; lifespan: number }

// Fixed seed so every explosion has the same shape and tests can read frames.
function particlesFor(count: number): Particle[] {
  let seed = 0x9e3779b9
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x100000000
  }
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

  const progress = frame / FRAME_COUNT
  const centerX = (columns - 1) / 2
  const centerY = (rows - 1) / 2
  // Terminal cells are about twice as tall as wide, so x travels double.
  const reachY = rows * 0.55
  const reachX = Math.min(reachY * 2.2, columns / 2)

  const flashFrames = 6
  if (frame < flashFrames) {
    const radius = (frame + 1) * 0.6
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const distance = Math.hypot((col - centerX) / 2, row - centerY)
        if (distance <= radius) {
          plot(col, row, (distance / radius) * 0.4 + frame / flashFrames * 0.2)
        }
      }
    }
  }

  for (const particle of PARTICLES) {
    const age = progress / particle.lifespan
    if (age >= 1) {
      continue
    }
    const travel = 1 - (1 - age) ** 2
    const gravity = age * age * rows * 0.35
    plot(
      centerX + Math.cos(particle.angle) * particle.speed * travel * reachX,
      centerY + Math.sin(particle.angle) * particle.speed * travel * reachY + gravity,
      age,
    )
  }

  return encodeBase64(new Uint8Array(words.buffer))
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
  await update($, blast, () => ({ ...reading, frame: 0 }))
  let frame = 0
  const timer = $.clock.every(FRAME_MS, () => {
    frame += 1
    if (frame >= FRAME_COUNT) {
      stopAnimation?.()
      void update($, blast, () => null)
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'boom', description: 'Play the cache-boom explosion once, with sample numbers' })
    return next(e)
  })

  on('command.run', { command: 'boom' }, async $ => {
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
    const kind = response.usage ? classifyUsage(response.usage) : null
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
    if (e.surface === 'terminal' && 'Raster' in elements) {
      const { Raster } = elements
      return (
        <Box flexDirection="column">
          <Raster key={RASTER_KEY} columns={rasterColumns} rows={ROWS} cells={drawFrame(current.frame, rasterColumns, ROWS)} />
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
