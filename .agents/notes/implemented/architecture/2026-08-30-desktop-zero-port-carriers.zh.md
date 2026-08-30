# Agent Note: 桌面零端口载体

Status: implemented

[English](2026-08-30-desktop-zero-port-carriers.md) | 中文

## Problem

桌面应用必须复用 Web 组合及其 API 词汇，但不得启动 HTTP、WebSocket 或 TCP 监听器。其特权本机工作流只能提供给受 sandbox 和 context isolation 保护的 Electron Renderer。Web 与 Desktop Host 还共享同一个 Home，且不能并行运行。

## Decision

`dsh-host-desktop-carrier` 在内存中实现 `webServer` 的 route、fallback、index-tap 和 upgrade 注册接口。后续 Electron 的 `app://dsh` protocol handler 会把 `Request` 分派给它，因此 Web 组合插件可以原样挂载，而该载体绝不创建 socket。

`dsh-client-connection` 增加 clone-safe 的桌面 bridge 词汇，以及其 unary RPC、mux/host 下行流的 IPC 实现。Renderer 仅获得这一狭窄的 preload API。它在交给既有 connection controller 前校验每个 server envelope 和具体 frame，按调用方 id 取消单个调用，并在 abort 时释放流订阅。该 bridge 被视为 loopback 等效面，从而保留既有仅限本机的设置、凭据、目录和路径操作。

Host adapter 使用与 Web route 相同的 API gateway。浏览器信任检查保留在共享 gateway 中；Electron Main 是唯一的 bridge 权威，只分派由自己规范化的逻辑请求。

`dsh-host-instance-lock` 在一个由配置指定、归属 Home 的目标上为 `web` 与 `desktop` 模式使用 `proper-lockfile`。owner 诊断信息位于库锁目录旁，而不是其中，因为 `proper-lockfile` 用目录删除来释放锁。lease teardown 仅在 unlock 后删除匹配的元数据，避免旧 owner 删除新 owner 的记录。

## Verification

Focused carrier、connection 和 lock 测试覆盖 route 优先级、route 释放、index transform、IPC 选择、RPC 取消、frame 校验、订阅释放，以及锁竞争元数据与释放。host 与 client 的 TypeScript aggregate build 会一起编译这些包。

## Alternatives considered

**在 loopback 上运行既有 Web server。** loopback 端口仍会引入端口分配、防火墙、进程所有权和本地网络攻击面。所需传输是进程内 IPC，因此 socket 既非必要也不可接受。

**把 Electron IPC 直接暴露给 Renderer 包。** 这样每个客户端功能都能任意命名 IPC channel 并取得 Electron 对象，破坏 preload allowlist，也会使传输语义偏离 `IApiClient`。

**把 owner JSON 存在锁目录内。** `proper-lockfile` 使用 `rmdir` 删除其锁；任何元数据子项都会阻止释放并留下错误的竞争状态。相邻记录能保留诊断信息而不改变库的所有权协议。

## Consequences

Web 与 Desktop 表面保留不同的物理载体，但共享 API 语义、信任逻辑和 client controller 行为。Electron Main 后续必须拥有 URL 校验、handler 分派、请求取消和流 pump；它不能把原始 IPC 委托给 Renderer。锁路径仍是一个可配置的组合项，因此两种启动模式会选择同一个共享 Home 目标。
