# Agent Note：过时 gap-repair 诊断

Status: implemented

[English](2026-09-03-stale-gap-repair-diagnostics.md) | 中文

## 问题

浏览器 reload 可能在 Session gap-repair 的 history 请求尚未完成时取代它。旧请求随后会以 `Failed to fetch` 等传输异常拒绝。`doOpen` 已会同时丢弃被取代连接代的成功与失败结果，但 `repairGap` 会记录每一个拒绝。因此，Web 回归的 tripwire 会把死连接的预期结果误报为活跃的 gap-repair 失败。

## 决策

`repairGap` 与之前一样，在启动时捕获 Session `openGeneration`。它的 catch 路径现在仅当该代仍为当前代且 Session 窗口仍处于 open 状态时才报错。完整 `resync()` 会先递增代，再打开替换窗口，因此被替换连接的拒绝会保持静默。属于当前 open 窗口的失败仍然可见，并保持现有的 fail-soft 行为。

这个代栅栏只改变诊断。过时 repair 仍然不会安装任何 history，`resync()` 仍是替换窗口的唯一所有者，`finally` 路径仍然清除 stitching 守卫。

## 测试

Session runtime 套件保留了当前代失败用例：它必须记录错误并清除 stitching。新的延迟请求用例先启动 gap repair，再用完整 resync 取代它，随后以 `Failed to fetch` 拒绝旧请求，并证明既没有记录错误，又只安装了新一代的 history。已构建 Web 回归仍是主动页面 reload 的端到端见证。

## 后果

- 主动重连或 reload 不再从其已取代的连接代产生虚假 gap-repair warning。
- 当前 open 连接上的真实 repair 失败仍然可观测。
- 浏览器 tripwire 仍保持严格；没有更宽泛地过滤或确认任何 warning 文本。
