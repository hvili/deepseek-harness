# @deepseek-ai/dsh-host-instance-lock

English | [中文](README.zh.md)

Reference package for the cross-process lease shared by the Web and Electron desktop surfaces. The configured path is locked with `proper-lockfile`; a sibling owner record carries only PID, mode, hostname, and acquisition time so a contending launcher can report who owns the Harness home. Cordis disposal awaits release, and an unrefreshed lease becomes recoverable after the configured stale interval.

## Model Experience

None; this package controls Host process ownership and contributes no model-visible content.

## Known Limitations and Deferred Work

The lease coordinates processes that mount this plugin. Older Harness installations that do not include the row cannot participate.
