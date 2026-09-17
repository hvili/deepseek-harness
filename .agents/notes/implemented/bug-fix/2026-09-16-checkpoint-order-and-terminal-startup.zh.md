# Agent Note：检查点顺序与终端启动观测

Status: implemented

[English](2026-09-16-checkpoint-order-and-terminal-startup.md) | 中文

## 问题

fork 串行 CI 暴露了两个顺序缺陷。创建检查点在进入存储域队列前等待 Session 日志刷盘，释放检查点可能先进入队列，随后又被延迟的创建值覆盖。pwsh 启动时，按静默结算的发送可能已经捕获提示符，而后续 `stdin_read` 结果没有新输出，导致启动消息被清空。输出是否为空还被错误地用于决定是否重新提交设置命令。

macOS 上的 Linux scope 单元夹具有另一个宿主资源泄漏：假 pid 到达了真实 `process.kill`，因此宿主机上已有的进程组可能接收信号，而不进入假子进程的回退路径。Windows npm 解析在 90 秒覆盖率测试档位中使用了 10 秒子进程上限，冷启动超过了这个嵌套上限。

## 决策

[SessionProjectionCache](../../../../packages/session/session-projection-cache/src/index.ts) 同步截取投影切面，并在等待日志持久化前确定逐 Session 写入链的顺序。失败的前序写入先结算，后序写入再继续。完成的链会移出待完成映射；释放会等待剩余写入，再关闭存储域。不同 Session 仍有各自独立的日志屏障，持久发布仍由存储域负责。

[终端启动](../../../../packages/terminal/terminal-bash/src/index.ts) 会反复重新提交 pwsh 设置，直到提示符标记确认；[标记就绪笔记](2026-09-17-pwsh-startup-marker-readiness.zh.md) 拥有当前的启动决策。后续结果为空时仍保留最近的非空有界视口，且仅打印提示符文本仍不能证明就绪。

每个 Linux scope 单元用例都在使用假子进程前拦截进程组信号，并在结束后恢复 mock。需要模拟成功投递到进程组的测试会明确换成记录调用的假实现。npm 解析测试采用 Windows 档位的 90 秒用例预算，其中子进程占 80 秒，终止和断言保留 10 秒；单独的故意超时测试仍保留短截止时间。

Workspace UI 的收藏和标签方法签名从现有 controller 接口派生。独立 connection 夹具复用自身的 payload 接口构造 wire 帧，并保留自身的标签映射实现。这避免了导入依赖于传输包的 controller。克隆阈值、排除范围和运行时检查保持不变。

## 曾考虑的替代方案

**延长最终检查点的轮询。** 否决：延迟的创建写入可能永久覆盖释放写入，额外等待不能修复顺序。由屏障控制的测试无需负载或休眠即可复现该交错。

**把空 pwsh 输出视为启动失败，或把提示符文本视为就绪。** 否决：空的后续结果可能正是成功的就绪观测，而设置回显可能在 shell 就绪前就包含提示符。输出与就绪必须保持为两个独立事实。

**重试 CI，或为假 pid 修改生产信号处理。** 否决：夹具必须隔离自己使用的宿主资源。模拟信号成功返回的反例无需向真实进程组发送信号，即可复现原始断言失败。

## 后果

确定性回归覆盖了延迟创建与释放的交错，以及非空启动输出后接空就绪结果的情况。相关源文件的定向覆盖率保持 100%；本地主机是 Windows 时，真实 POSIX 终端组合仍由 CI 验证。真实 npm 启动受所属测试档位预算约束，不再受无关的更短上限约束。

替代关系审查保留[投影提案](../../proposed/architecture/2026-07-27-session-projection-and-command-log.zh.md)、[原生进程约束决策](../architecture/2026-08-28-subprocess-native-containment.zh.md)和 [fork 容量策略](../process/2026-08-24-fork-hosted-validation-profile.zh.md)：它们分别负责独立的架构与运行器选择。本记录修复实现边界，不替代这些决策。不修改任何已归档记录。
