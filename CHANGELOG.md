# Changelog

## 0.2.0

- The desktop app plays the explosion too, as an animated SVG above the label. It previously showed the label alone.
- The sample command is now `/cache-boom:boom`, declared in `commands/boom.md`. The desktop app lists it in a new session before the session starts. `/boom` is gone.

## 0.1.0

- First release. Plays an explosion above the prompt when a model call misses the prompt cache or writes 50k tokens or more to it.
- Covers the main thread and subagents.
- Writes a per-session report to `~/.claude/cache-boom/<session id>.json` for a status line.
- `/boom` plays a sample explosion.
