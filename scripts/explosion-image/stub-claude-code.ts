// Stands in for the engine's 'claude-code' module so the mod's pure drawing code can run under Bun.
import { plugin } from 'bun'
plugin({
  name: 'claude-code-stub',
  setup(build) {
    build.module('claude-code', () => ({
      exports: { atom: (ref: unknown, initial: unknown) => ({ ref, initial }), read: () => null, update: () => undefined },
      loader: 'object',
    }))
  },
})
