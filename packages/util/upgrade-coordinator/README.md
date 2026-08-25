# @deepseek-ai/dsh-upgrade-coordinator

English | [中文](README.zh.md)

Session-format upgrade guard: reads the persisted format version, refuses to migrate down, and lets untouched stores alone.

## Model Experience

None, as this package guards persisted session-format versions across launches.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- Upgrades this build cannot perform faithfully are refused rather than guessed; in-place format migration is out of scope.
