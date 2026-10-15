import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnStepInput, TurnUsage } from 'claude-code'

import { classifyUsage, drawAnimatedSvg, drawFrame } from '../hooks/register'

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
} as const

const STEP: TurnStepInput = { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3 }

function usage(cacheWriteTokens: number, cacheReadTokens: number): TurnUsage {
  return {
    model: 'claude-opus-5-5',
    input_tokens: 10,
    output_tokens: 200,
    cache_creation_input_tokens: cacheWriteTokens,
    cache_read_input_tokens: cacheReadTokens,
  }
}

// Stands in for the engine: one model response, an empty band, blits taken,
// and a disk that keeps the last report written.
function answerStep(on: On, stepUsage: TurnUsage) {
  const writes = new Map<string, string>()
  mock.env(on, { HOME: '/home/test' })
  on('session.id', () => ({ value: 'session-1' }))
  on('fs.write', (_$, e) => {
    writes.set(e.path, e.text)
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('ui.blit', () => ({ value: {} }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: stepUsage }
  })
  return { reportText: () => writes.get('/home/test/.claude/cache-boom/session-1.json') }
}

async function runStep($: Engine, input: TurnStepInput) {
  const stream = $.turn.step(input)
  for await (const _chunk of stream) {
    // drain the stream so its result settles
  }
  return stream.result
}

describe('classifyUsage', () => {
  test('a large write over a small read is a miss', () => {
    expect(classifyUsage(usage(80_000, 20_000))).toBe('miss')
  })
  test('a warm cache with a huge write is a huge write', () => {
    expect(classifyUsage(usage(60_000, 120_000))).toBe('write')
  })
  test('a warm cache with a small write is quiet', () => {
    expect(classifyUsage(usage(3_000, 120_000))).toBeNull()
  })
  test('a tiny cold write is quiet', () => {
    expect(classifyUsage(usage(800, 0))).toBeNull()
  })
})

test('every frame encodes one triplet per cell', () => {
  for (const frame of [0, 10, 47]) {
    const bytes = atob(drawFrame(frame, 64, 9)).length
    expect(bytes).toBe(64 * 9 * 12)
  }
})

test('the desktop explosion fits the Svg limit and differs per blast', () => {
  const first = drawAnimatedSvg(1)
  expect(first.length).toBeLessThan(131_072)
  expect(first.match(/<line/g)?.length).toBe(44)
  expect(drawAnimatedSvg(2)).not.toBe(first)
})

test('a cache miss explodes in the band and clears after the animation', async ($, on) => {
  const clock = mock.clock(on)
  const disk = answerStep(on, usage(90_000, 4_000))

  await runStep($, STEP)

  expect(JSON.parse(disk.reportText() ?? 'null')).toEqual({
    blastCount: 1,
    lastBlast: { kind: 'miss', cacheWriteTokens: 90_000, cacheReadTokens: 4_000, isSubagent: false },
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'cache-boom', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /cache miss, 90\.0k written, 4\.0k read/ })).toBeDefined()
    if (surface === 'terminal') {
      expect(await ui.find({ key: 'boom' })).toBeDefined()
    } else {
      const svg = await ui.find({ type: 'Svg' })
      expect(svg?.props.isInteractive).toBe(true)
      expect(String(svg?.props.source)).toContain('<animate')
    }
    await ui.unmount()
  }

  await clock.advance(2_000)
  const ui = await $.ui.mount({ plugin: 'cache-boom', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /BOOM/ })).toBeUndefined()
})

test('a subagent miss explodes and says it came from a subagent', async ($, on) => {
  mock.clock(on)
  const disk = answerStep(on, usage(90_000, 0))

  await runStep($, { ...STEP, agentId: 'agent-1' })

  const ui = await $.ui.mount({ plugin: 'cache-boom', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /BOOM: subagent prompt cache miss/ })).toBeDefined()
  expect(JSON.parse(disk.reportText() ?? 'null')?.lastBlast?.isSubagent).toBe(true)
})
