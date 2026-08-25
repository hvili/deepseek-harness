# @deepseek-ai/dsh-codex-app-server

English | [中文](README.zh.md)

Version-locked integration primitives for the official Codex app-server. The package resolves the `@openai/codex` wrapper from its own dependency, supplies stable TypeScript/JSON Schema commands, performs the required JSON-RPC initialization handshake, and waits for managed process-tree exit.

Product adapters own thread selection, turn streaming, approval policy, persistence, and UI projection. The shared client does not opt into Codex experimental APIs, authenticate an account, select a model, create product records, or start a process by itself.

## Compatibility

`CODEX_RUNTIME_VERSION` and both command builders refer to the exact package dependency. Upgrading the dependency requires regenerating stable schemas and rerunning handshake, thread resume, approval, review, cancellation, malformed-protocol, and process-quiescence tests. Generated output is version-specific; do not mix schemas from another Codex binary.

`schema/stable-json-schema.manifest.json` records the deterministic aggregate fingerprint of the stable JSON Schema output. The package test regenerates that output from the package-local runtime and rejects file-count or content drift. Experimental methods are intentionally excluded.

Codex is Apache-2.0 licensed. Distribution artifacts retain the official package's license and generated third-party notices. Model use can still consume OpenAI/Codex quota.

## Model Experience

### Infrastructure seam

#### What the model sees

Nothing by itself. This package exposes no model-facing tool or prompt; product adapters decide which `request()` payloads and results enter a model context.

#### Token effect

None by itself. Token usage belongs to the consuming adapter and its selected Codex turn.

#### KV Cache effect

None by itself. Cache behavior is determined by the consuming adapter's model-facing request shape.

## Known Limitations and Deferred Work

- The package exposes stable JSON-RPC requests as method names plus object payloads; consumers bind them to generated schemas.
- WebSocket, remote relay, plugin installation, authentication UI, and Codex's project database are outside this package.
