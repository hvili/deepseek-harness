# Agent Note：Electron Main 安全边界

状态：已实施

[English](2026-08-31-electron-main-security-boundary.md) | 中文

## 问题

桌面壳必须承载现有浏览器组合，但不能继承网络监听器，也不能把 Electron 权限交给渲染器代码。它还需要可预测的 D 盘持久化，并在关闭时终止 Host 而不是隐藏到托盘。

## 决策

Electron Main 在 ready 前将工作目录固定为 `D:\DeepSeek`、将 `DSH_HOME` 固定为 `D:\DeepSeek\Home`，并把 userData、cache、logs、crash dumps 都设在 `D:\DeepSeek\DesktopData` 下。它启动带标记的 desktop Profile，只经由内存 carrier 服务 `app://dsh`，并创建一个无边框窗口：sandbox、context isolation、禁用 node integration、拒绝导航、仅将 HTTPS 外链交给系统，以及严格 CSP。

Preload 为兼容 Electron sandbox 使用 CommonJS，仅暴露有类型的 `desktopBridge`。Main 在把逻辑 IPC 请求转成等价 loopback gateway 请求前验证输入，跟踪取消和订阅，拥有标题栏动作，并过滤通知意图。不存在托盘或更新通道。electron-builder 生成未签名的 NSIS 与 ZIP x64 产物，卸载时不清除数据；它保持 `resources/app` 未封装，使受管 Profile 的 junction 能解析到真实包目录，并保留 node-pty 的 Windows x64 N-API 预编译产物而不在打包中重编 native modules。

## 验证

Desktop build 产出 ESM Main 和 CommonJS preload，并将 Electron 保持为外部依赖而非打包下载器。结构测试断言安全自定义来源、sandbox/context isolation、禁用 node integration、拒绝导航和弹窗、CSP、固定数据路径及窄 contextBridge 表面。既有 carrier、lock、Profile、Bundle、connection 聚焦测试全部通过。

## 后果

剩余运行时门禁需要 Electron Windows 二进制：只有拿到它后，才能证明打包应用启动、无 TCP 监听、子进程清理和产物哈希。任何渲染器模块都不得新增任意 IPC channel；必须先扩展权威 bridge 合同和 Main 验证。
