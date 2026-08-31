# Agent Note：受管 Desktop Profile

状态：已实施

[English](2026-08-30-managed-desktop-profile.md) | 中文

## 问题

Electron 应用需要在共享 Harness Home 下拥有稳定、可升级的 Profile，同时用户自己的 Profile 补丁和任意包元数据必须保留。Web 与 Desktop 的物理载体不同，却仍必须共享同一把交互式 Host 锁。

## 决策

`ensureDesktopProfile()` 只在清单带有 `dsh.desktopManaged: true` 时管理 `Home/profiles/desktop`。首次创建先在唯一的相邻临时目录写入包清单、用户补丁和 pnpm 设置，再通过重命名发布。对于已存在但未标记的目录会拒绝接管。之后启动仅协调应用拥有的精确 Bundle 顺序——base、web-app、enhanced-distribution、desktop-app——并保留用户补丁、依赖及未知清单字段。

Desktop Bundle 覆盖普通 Web 组合：禁用 CLI 启动和浏览器 HMR，以无监听器的 desktop carrier 替换 `webserver`，关闭依赖 TCP URL 的表面提示，挂载 desktop connection bridge，并把共享 instance-lock 行的模式改成 `desktop`。Web Bundle 使用同一路径、模式为 `web` 的锁行，因此两种表面不能同时操作同一个 Home。

## 验证

Profile 测试覆盖原子初始化、在保留用户补丁和未知清单数据时的协调，以及拒绝接管非受管 Profile。Bundle 测试断言 carrier 替换、禁用 HMR、IPC bridge 和 desktop 锁配置。聚焦的 Web、carrier、IPC、lock、Profile 套件全部通过，host/client TypeScript 构建和 frozen lockfile 安装也通过。

## 考虑过的替代方案

**复用普通 `web` Profile。** 这会让 Desktop Bundle 改动泄漏到浏览器启动路径，且没有应用拥有的标记来实施安全升级策略。

**覆盖任意 `profiles/desktop` 清单。** 名称冲突只有保持目录不变才可恢复；自动覆盖可能断开用户安装的插件或清除其组合意图。

**给 Desktop 另写一套锁实现。** 排他性契约会依赖时序和重复的文件语义。在 Web 行中声明一个锁目标、仅覆盖诊断模式，具有可审计且对称的行为。

## 后果

Electron Main 必须在固定 `DSH_HOME` 后、Profile 启动前调用 `ensureDesktopProfile()`。它还必须通过 Profile 的模块解析准备本地增强发行版，且不得修改旧安装。未来 Profile 升级只可改变声明的受管 Bundle 顺序；用户补丁内容始终不在其范围内。
