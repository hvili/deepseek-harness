# Agent Note: Desktop zero-port carriers

Status: implemented

English | [中文](2026-08-30-desktop-zero-port-carriers.zh.md)

## Problem

The desktop application must reuse the Web composition and its API vocabulary without starting an HTTP, WebSocket, or TCP listener. Its privileged local workflows remain available only to an Electron renderer protected by sandboxing and context isolation. Web and Desktop Hosts also share one Home and must never run concurrently.

## Decision

`dsh-host-desktop-carrier` implements the `webServer` route, fallback, index-tap, and upgrade-registration surface in memory. Electron's future `app://dsh` protocol handler dispatches `Request` objects to it, so Web composition plugins mount unchanged while the carrier never creates a socket.

`dsh-client-connection` adds a clone-safe desktop bridge vocabulary and IPC implementations of its unary RPC and mux/host downlinks. The renderer receives only this narrow preload API. It validates each server envelope and concrete frame before forwarding it to the existing connection controller, cancels individual calls by caller id, and releases stream subscriptions on abort. The bridge is treated as loopback-equivalent for existing local-only settings, credential, directory, and path actions.

The host adapter uses the same API gateway as the Web route. Browser trust checks remain in the shared gateway; Electron Main is the sole bridge authority and dispatches only its own normalized logical requests.

`dsh-host-instance-lock` uses `proper-lockfile` on a configured Home-owned target for `web` and `desktop` modes. Owner diagnostics live beside, not inside, the library lock directory, because `proper-lockfile` releases with directory removal. Lease teardown removes matching metadata only after unlock, preventing an old owner from deleting a newly acquired owner's record.

## Verification

Focused carrier, connection, and lock tests cover route precedence, route disposal, index transforms, IPC selection, RPC cancellation, frame validation, subscription release, lock contention metadata, and release. The host and client TypeScript aggregate builds compile the packages together.

## Alternatives considered

**Run the existing Web server on loopback.** A loopback port still introduces port allocation, firewall, process-ownership, and local-network attack surface. The required transport is in-process IPC, so a socket is neither necessary nor acceptable.

**Expose Electron IPC directly to renderer packages.** That would let every client feature name arbitrary IPC channels and Electron objects, defeating the preload allowlist and making the transport semantics diverge from `IApiClient`.

**Store owner JSON inside the lock directory.** `proper-lockfile` removes its lock with `rmdir`; any metadata child prevents release and leaves a false contention state. A sibling record preserves diagnostics without changing the library's ownership protocol.

## Consequences

The Web and Desktop surfaces retain separate physical carriers but share API semantics, trust logic, and client controller behavior. Electron Main must later own URL validation, handler dispatch, request cancellation, and stream pumps; it cannot delegate raw IPC to the renderer. The lock path remains a configurable composition concern so both launch modes select exactly one shared Home target.
