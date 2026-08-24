# @deepseek-ai/dsh-session-backup

English | [中文](README.zh.md)

Zero-dependency session-store snapshot/verify/restore primitives: integrity-hashed full-directory backups for harness upgrade and recovery.

## Model Experience

None, as this package performs durable directory snapshots and integrity verification.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- Backups are full-directory snapshots keyed by content hashes; incremental or delta backup is deferred.
