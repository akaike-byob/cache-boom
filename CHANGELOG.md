# Changelog

## 0.1.0

- First release. Plays an explosion above the prompt when a model call misses the prompt cache or writes 50k tokens or more to it.
- Covers the main thread and subagents.
- Writes a per-session report to `~/.claude/cache-boom/<session id>.json` for a status line.
- `/boom` plays a sample explosion.
