# Agent Note: Managed desktop Profile

Status: implemented

English | [中文](2026-08-30-managed-desktop-profile.zh.md)

## Problem

The Electron application needs a stable, upgradeable Profile below the shared Harness Home, while a person's profile patch and arbitrary package metadata must remain theirs. Web and Desktop also need one interactive-Host lease even though their transport carriers differ.

## Decision

`ensureDesktopProfile()` owns only `Home/profiles/desktop` when its manifest has `dsh.desktopManaged: true`. First creation seeds package metadata, user patch, and pnpm settings in a unique sibling directory and publishes it with a rename. A pre-existing unmarked directory is rejected rather than adopted. Later launches reconcile only the exact application bundle tuple — base, web-app, enhanced-distribution, desktop-app — and retain user patches, dependencies, and unknown manifest keys.

The desktop bundle overlays the ordinary web composition: it disables CLI startup and browser HMR, replaces `webserver` with the no-listener desktop carrier, suppresses TCP-derived surface messaging, mounts the desktop connection bridge, and changes the shared instance-lock row to `desktop`. The web bundle creates the same lock row with mode `web`, so neither surface can operate against one Home concurrently.

## Verification

Profile tests cover atomic seeding, reconciliation while preserving a user patch and unknown manifest data, and refusal to adopt an unmanaged profile. Bundle tests assert the carrier swap, disabled HMR, IPC bridge, and desktop lock configuration. Focused Web, carrier, IPC, lock, and Profile suites pass together with host/client TypeScript builds and a frozen lockfile install.

## Alternatives considered

**Reuse the normal `web` Profile.** It would let Desktop bundle changes leak into the browser launch path and gives no application-owned marker for a safe upgrade policy.

**Overwrite any `profiles/desktop` manifest.** A name collision is recoverable only if we leave the directory untouched; an automatic overwrite could disconnect user-installed plugins or erase their composition intent.

**Give Desktop a separate lock implementation.** That would make the exclusion contract depend on timing and duplicated file semantics. One lock target in the Web row, overridden only for diagnostic mode, is auditable and symmetric.

## Consequences

Electron Main must call `ensureDesktopProfile()` after fixing `DSH_HOME` and before profile boot. It must also provision the locally enhanced distribution through the profile's module resolution, without modifying the legacy installation. Future profile upgrades may change only the declared managed tuple; user patch content remains out of scope.
