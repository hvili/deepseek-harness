# Agent Note: settings 内存镜像在存储提交点落位

Status: implemented

[English](2026-09-02-settings-mirror-commits-at-storage-durability.md) | 中文

## 问题

settings 基类只在 provider 的 `persist()` promise resolve 之后才更新内存镜像——即 `this.document[ns]`，`settings.get()` 的数据源。文件 provider 的持久化路径先原子写文档，再在 `withFileLock` 的 `finally` 里 unlink 写锁释放跨进程锁；因此该 promise 的 resolve 比分区在磁盘上真正持久化晚一次 unlink。ui-theme 的 `webserver/index-inject` 在每次 index 渲染时都把从该镜像读出的主题偏好内联进 boot 脚本，于是 rename 与锁 unlink 之间被服务的页面 reload 会用陈旧偏好渲染：刚选择深色的用户会看到 loading 页先渲染浅色。settings-chrome 的 boot-theme 用例（"uses the persisted dark preference while plugins are still loading"）轮询磁盘上的 `settings.yaml` 并立即 reload，这正是它间歇失败（完整套件每轮约一次）而单文件重跑通常通过的原因。

## 决策

`SettingsProvider.persist` 接收幂等的 `commit` 与 `notify` 回调。provider 首次持久持有分区时，基类 `write()` 让 `commit` 同步落位原始文档、revision 与解析镜像；`notify` 随后按捕获提交的原顺序分发 `settings/document-updated`、watcher 工作与 `settings/updated`。提供方只在释放任何写锁后调用 `notify`。省略这些调用的提供方由基类在 persist promise settle 后补齐；耐久提交后的后续 settle 即使拒绝，基类也会先发出通知再传播该拒绝。`FileSettingsProvider.persistSection` 在 `writeFileAtomic`（使分区持久化的 rename）后立即调用 `commit()`，并在 `withFileLock` 移除锁后调用 `notify()`。listener 分发仍在文件提供方的操作链内，因此保留其写入间的通知顺序，却不延长跨进程锁持有时间。

## 备选方案

**放宽测试：reload 前先等镜像。** 白闪是用户可见的产品行为而非测试缺陷；在测试里等待等于为竞态背书而不是关闭它。

**index 渲染时读 settings 文件或等待 flush。** 每次 index 渲染都要付一次同步文件读，且渲染路径要复制 provider 的解析/格式化逻辑。镜像的存在就是为了服务读取；让它与存储同步一次性修复 `settings.get()` 的所有消费方。

**把镜像更新整体提前到 `persist` 之前。** 镜像绝不能领先存储：持久化失败的写会发布一个重启后任何读者都无法再观察到的值。

## 后果

镜像与持久化文件不会在 rename 到 unlink 的窗口内不一致：从任一来源服务的读者看到相同分区。同步 settings listener 在写锁消失后运行，其耗时因此不会让第二进程超过 2 s 锁获取期限。同进程操作链仍保留通知顺序，再次写入的 listener 会排在当前操作之后，且不存在同步互斥量。忽略两个回调的 provider 通过基类兜底保留 persist resolve 时序。覆盖用例锁定镜像先于 settle、锁先于 listener 释放、耐久提交后的拒绝行为、revision 顺序与通知幂等性。
