# @deepseek-ai/dsh-build-manifest

English | [中文](README.zh.md)

Immutable artifact identity stamped at build time: the host app's version, git commit, release build hash, and session-format schema version, exposed through one context key.

## Model Experience

None, as this package only reports the artifact identity the current launch was built from.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- The manifest is stamped by the build pipeline; ad-hoc dev launches report an unstamped manifest with `commit` absent.
