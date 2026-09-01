# DeepSeek Harness Desktop

English | [中文](README.zh.md)

Windows x64 Electron shell for DeepSeek Harness. It serves the frontend through
`app://dsh` and carries Host API traffic through a sandboxed, context-isolated
preload bridge; it intentionally opens no TCP listener, tray, or auto-updater.

Runtime data is fixed outside the installation: `D:\DeepSeek\Home` holds the
shared Harness state and the managed `desktop` Profile, while Electron state,
cache, logs, and dumps live beneath `D:\DeepSeek\DesktopData`. A minimal
CommonJS bootstrap establishes those paths and the privileged scheme before it
imports the full Host graph, so an invalid packaged dependency fails closed
without falling back to Electron's default C-drive data directory. Web and
desktop resolve their shared interactive Host lock through app-boot's
`dshHomePath()` expression helper, keeping the shipped overlay in the same
strict YAML dialect that runtime boot validates. The enhanced plugins' legacy
`cordis` peer name is a workspace alias of `@deepseek-ai/cordis`; packaging
materializes it as an ESM forwarding shim, so both names share the Host's one
DI runtime instead of loading a second framework.

Run `pnpm run build:desktop` to build the application, `pnpm run desktop:dev`
for development, and `pnpm run desktop:dist` for an NSIS installer plus a
portable ZIP. Both artifacts are unsigned test builds, so Windows SmartScreen
may require an explicit user confirmation. The distribution keeps
`resources/app` unpacked because the managed Profile needs real package
directories for its module junctions. `desktop:dist` first runs the enhanced
plugin checks and the official Host/Client/Web build, then checks the generated
workspace runtime closure; use `pnpm --filter @deepseek-ai/dsh-desktop
run sync-pack-deps` only when a deliberate dependency change needs to refresh
that manifest. An electron-builder hook copies the Windows x64 packages named
by Koffi, Sharp, Codex, and ripgrep's own `optionalDependencies`, then the
packaged verifier checks every reviewed PE payload and exercises the modules
and executables under Electron's Node runtime. The latter command requires
Electron's Windows binary to be installed and writes `SHA256SUMS.txt` beside
the installer and ZIP after both artifacts pass verification.
