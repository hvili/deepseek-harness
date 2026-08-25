# @deepseek-ai/dsh-restore-wizard

English | [中文](README.zh.md)

Cordis service exposing the real session restore over `ctx.sandbox` (read-only preview) and `ctx.approval` (operator confirmation before mutation).

## Model Experience

None, as this package drives sandbox-confined restore previews and approval flows.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- The wizard restores whole backups; per-path selection inside a backup and cross-session merge are deferred.
