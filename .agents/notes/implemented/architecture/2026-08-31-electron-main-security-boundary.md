# Agent Note: Electron Main security boundary

Status: implemented

English | [中文](2026-08-31-electron-main-security-boundary.zh.md)

## Problem

The desktop shell must host the existing browser composition without inheriting a network listener or giving renderer code Electron authority. It also needs predictable D-drive persistence and a close operation that terminates the Host instead of hiding in a tray.

## Decision

Electron Main fixes its working directory to `D:\DeepSeek`, fixes `DSH_HOME` to `D:\DeepSeek\Home`, and sets userData, cache, logs, and crash dumps below `D:\DeepSeek\DesktopData` before readiness. It boots the marked desktop Profile, serves exactly `app://dsh` through the in-memory carrier, and creates one frameless window with sandbox, context isolation, node integration disabled, navigation denial, external HTTPS handoff, and a restrictive CSP.

Preload is CommonJS for Electron sandbox compatibility and exposes only the typed `desktopBridge`. Main validates logical IPC requests before translating them to loopback-equivalent gateway requests, tracks cancellation and subscriptions, owns caption actions, and filters notification intents. It has no tray or update channel. electron-builder creates unsigned NSIS and ZIP x64 artifacts without an uninstall data purge, keeps `resources/app` unpacked so managed Profile junctions resolve to real package directories, and keeps node-pty's Windows x64 N-API prebuild instead of rebuilding native modules during packaging.

## Verification

Desktop build checks produce an ESM Main and CommonJS preload while leaving Electron external rather than bundling its downloader. Structural tests assert the secure custom origin, sandbox/context isolation, disabled node integration, navigation and popup denial, CSP, fixed data paths, and narrow contextBridge surface. Existing carrier, lock, Profile, Bundle, and connection focused tests pass.

## Consequences

The remaining runtime gate needs Electron's Windows binary: only then can the packaged app prove Host boot, no TCP listeners, child-process cleanup, and artifact hashes. No renderer module may add an arbitrary IPC channel; it must extend the authoritative bridge contract and Main validation first.
