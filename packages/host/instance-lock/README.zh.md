# @deepseek-ai/dsh-host-instance-lock

[English](README.md) | 中文

Web 与 Electron 桌面界面共用的跨进程租约参考。插件使用 `proper-lockfile` 锁定配置路径；相邻的 owner 记录只保存 PID、模式、主机名和获取时间，使冲突启动器能够说明谁占用了 Harness Home。Cordis 销毁会等待释放，超过配置 stale 时间且未刷新的租约可以恢复。

## 模型体验

无；本包只控制 Host 进程所有权，不产生模型可见内容。

## 已知限制与延期工作

租约只能协调挂载了本插件的进程；未包含该行的旧版 Harness 安装无法参与。
