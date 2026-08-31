# DeepSeek Harness Desktop

Windows x64 Electron shell for DeepSeek Harness. It serves the frontend through
`app://dsh` and carries Host API traffic through a sandboxed, context-isolated
preload bridge; it intentionally opens no TCP listener, tray, or auto-updater.

Runtime data is fixed outside the installation: `D:\DeepSeek\Home` holds the
shared Harness state and the managed `desktop` Profile, while Electron state,
cache, logs, and dumps live beneath `D:\DeepSeek\DesktopData`.

Run `pnpm run build:desktop` to build the application, `pnpm run desktop:dev`
for development, and `pnpm run desktop:dist` for an NSIS installer plus a
portable ZIP. Both artifacts are unsigned test builds, so Windows SmartScreen
may require an explicit user confirmation. The distribution keeps
`resources/app` unpacked because the managed Profile needs real package
directories for its module junctions. `desktop:dist` checks the generated
workspace runtime closure first; use `pnpm --filter @deepseek-ai/dsh-desktop
run sync-pack-deps` only when a deliberate dependency change needs to refresh
that manifest. The latter command requires Electron's Windows binary to be
installed.
