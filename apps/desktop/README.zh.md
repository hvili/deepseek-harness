# DeepSeek Harness Desktop

[English](README.md) | 中文

DeepSeek Harness 的 Windows x64 Electron 壳。它通过 `app://dsh` 服务前端，
并经由 sandbox、context isolation 的 preload bridge 承载 Host API 流量；
有意不开放任何 TCP 监听器、托盘或自动更新器。

运行时数据固定在安装目录之外：`D:\DeepSeek\Home` 保存共享 Harness 状态和
受管 `desktop` Profile，而 Electron 状态、cache、logs 和 dumps 位于
`D:\DeepSeek\DesktopData` 下。一个最小 CommonJS bootstrap 会在导入完整
Host 图之前建立这些路径和特权 scheme，因此无效的打包依赖会失败关闭，且不会
退回 Electron 默认的 C 盘数据目录。Web 与 desktop 通过 app-boot 的
`dshHomePath()` 表达式 helper 解析共享 interactive Host 锁，使发布 overlay
始终采用运行时 boot 会验证的同一严格 YAML 方言。

使用 `pnpm run build:desktop` 构建应用，使用 `pnpm run desktop:dev` 开发，
使用 `pnpm run desktop:dist` 生成 NSIS 安装器和便携 ZIP。两个产物都是未签名
测试版本，因此 Windows SmartScreen 可能要求用户显式确认。分发包保持
`resources/app` 未封装，因为受管 Profile 需要真实包目录来建立模块 junction。
`desktop:dist` 会先检查生成的 workspace 运行时闭包；只有在有意变更依赖、需要
刷新该 manifest 时，才使用 `pnpm --filter @deepseek-ai/dsh-desktop run
sync-pack-deps`。electron-builder hook 会复制 Koffi、Sharp、Codex 和 ripgrep
各自 `optionalDependencies` 命名的 Windows x64 包，然后打包验证器会检查每个
已审查 PE 载荷，并在 Electron 的 Node 运行时下实际执行模块与可执行文件。
后一命令要求已安装 Electron Windows binary，并且只会在安装器和 ZIP 都通过
验证后，在其旁边写入 `SHA256SUMS.txt`。
