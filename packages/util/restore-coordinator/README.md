# @deepseek-ai/dsh-restore-coordinator

English | [中文](README.zh.md)

Transactional restore coordination over the session-backup primitives: verifies a snapshot, replays the restore through the store seam, and refuses operations that cannot be performed faithfully.

## Model Experience

None, as this package coordinates durable restore transactions.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- Restore is transactional per backup; cross-backup merge or partial-path restore selection is deferred.
