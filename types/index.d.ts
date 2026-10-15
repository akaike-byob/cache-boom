export type BlastKind = 'miss' | 'write'

export type BlastReading = {
  kind: BlastKind
  cacheWriteTokens: number
  cacheReadTokens: number
  isSubagent: boolean
}

// id tells one explosion from the next; frame drives the terminal raster.
export type Blast = BlastReading & { id: number; frame: number }

// What the status line reads from ~/.claude/cache-boom/<session id>.json.
export type PromptReport = {
  blastCount: number
  lastBlast: BlastReading | null
}

declare module 'claude-code' {
  interface PluginState {
    'cache-boom': { blast: Blast | null }
  }
}
