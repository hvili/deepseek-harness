# Agent Note: Electron Main security boundary

Status: implemented

English | [中文](2026-08-31-electron-main-security-boundary.zh.md)

## Problem

The desktop shell must host the existing browser composition without inheriting a network listener or giving renderer code Electron authority. It also needs predictable D-drive persistence and a close operation that terminates the Host instead of hiding in a tray.

## Decision

A minimal CommonJS bootstrap fixes the working directory to `D:\DeepSeek`, fixes `DSH_HOME` to `D:\DeepSeek\Home`, sets userData, cache, logs, and crash dumps below `D:\DeepSeek\DesktopData`, and registers the privileged scheme synchronously before importing the full Host graph. A missing packaged subpath therefore exits explicitly instead of preventing the path policy from running or silently leaving Electron's default C-drive state behind. Electron Main then boots the marked desktop Profile, serves exactly `app://dsh` through the in-memory carrier, and creates one frameless window with sandbox, context isolation, node integration disabled, navigation denial, external HTTPS handoff, and a restrictive CSP.

Preload is CommonJS for Electron sandbox compatibility and exposes only the typed `desktopBridge`. Main validates logical IPC requests before translating them to loopback-equivalent gateway requests, tracks cancellation and subscriptions, owns caption actions, and filters notification intents. It has no tray or update channel. The Web and desktop layers spell their shared lock path as `!!js dshHomePath('interactive-host')`, which remains a Loader expression without relying on a backtick scalar that strict YAML cannot resolve. The enhanced plugins' upstream `cordis` peer is installed as a workspace alias of `@deepseek-ai/cordis`; the packaged alias is a forwarding ESM shim, so both names expose the Host's same framework objects and cannot split Service identity. electron-builder creates unsigned NSIS and ZIP x64 artifacts without an uninstall data purge, keeps `resources/app` unpacked so managed Profile junctions resolve to real package directories, and keeps node-pty's Windows x64 N-API prebuild instead of rebuilding native modules during packaging. The desktop manifest explicitly closes all reachable workspace peers and the local enhanced bundle roots before packaging, so the installed Host does not depend on development-only links. An `afterPack` hook resolves Koffi, Sharp, Codex, and ripgrep's Windows x64 packages from their parents' exact `optionalDependencies`, validates package identity, version, OS, and CPU, and copies the complete packages under the aliases their runtime loaders request. A successful distribution writes an atomic `SHA256SUMS.txt` for the installer and ZIP only after packaged verification passes.

## Verification

Desktop build checks produce a synchronous CommonJS bootstrap, an ESM Main, and a CommonJS preload while leaving Electron external rather than bundling its downloader. Structural tests assert that path and scheme setup precede the dynamic Main import, plus the secure custom origin, sandbox/context isolation, disabled node integration, navigation and popup denial, CSP, and narrow contextBridge surface. Existing carrier, lock, Profile, Bundle, and connection focused tests pass. The packaged dependency verifier rejects non-AMD64 `.node`, `.dll`, and `.exe` payloads, then uses the packaged Electron Node runtime to call Koffi, render through Sharp, open a ConPTY, and run the packaged ripgrep and Codex executables.

## Consequences

Every upgrade that changes one of the reviewed optional package identities, versions, or target fields fails packaging before an artifact is accepted. The complete release gate still proves Host boot, no TCP listeners, child-process cleanup, and artifact hashes. No renderer module may add an arbitrary IPC channel; it must extend the authoritative bridge contract and Main validation first.
