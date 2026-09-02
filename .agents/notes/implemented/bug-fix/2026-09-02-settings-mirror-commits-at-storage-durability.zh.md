# Agent Note: settings 内存镜像在存储提交点落位

Status: implemented

[English](2026-09-02-settings-mirror-commits-at-storage-durability.md) | 中文

## 问题

settings 基类只在 provider 的 `persist()` promise resolve 之后才更新内存镜像——即 `this.document[ns]`，`settings.get()` 的数据源。文件 provider 的持久化路径先原子写文档，再在 `withFileLock` 的 `finally` 里 unlink 写锁释放跨进程锁；因此该 promise 的 resolve 比分区在磁盘上真正持久化晚一次 unlink。ui-theme 的 `webserver/index-inject` 在每次 index 渲染时都把从该镜像读出的主题偏好内联进 boot 脚本，于是 rename 与锁 unlink 之间被服务的页面 reload 会用陈旧偏好渲染：刚选择深色的用户会看到 loading 页先渲染浅色。settings-chrome 的 boot-theme 用例（"uses the persisted dark preference while plugins are still loading"）轮询磁盘上的 `settings.yaml` 并立即 reload，这正是它间歇失败（完整套件每轮约一次）而单文件重跑通常通过的原因。

## 决策

`SettingsProvider.persist` 现在接收一个幂等的 `commit` 回调，基类 `write()` 在其中落位镜像：文档替换、revision 递增与 `settings/updated` 派发都在 provider 首次持久持有该分区的时刻发生。persist promise resolve 后的兜底调用让从不调用回调的 provider 维持原时序，抽象方法的契约因此是：存储持有该分区时调用 `commit`，否则基类在 `persist` resolve 后提交。`FileSettingsProvider.persistSection` 在 `writeFileAtomic`（使分区持久化的 rename）之后立即调用 `commit()`，位于写锁 unlink 之前。一个存储提交严格早于其 persist promise settle 的 provider 单测锁定了新顺序与兜底的幂等性。

## 备选方案

**放宽测试：reload 前先等镜像。** 白闪是用户可见的产品行为而非测试缺陷；在测试里等待等于为竞态背书而不是关闭它。

**index 渲染时读 settings 文件或等待 flush。** 每次 index 渲染都要付一次同步文件读，且渲染路径要复制 provider 的解析/格式化逻辑。镜像的存在就是为了服务读取；让它与存储同步一次性修复 `settings.get()` 的所有消费方。

**把镜像更新整体提前到 `persist` 之前。** 镜像绝不能领先存储：持久化失败的写会发布一个重启后任何读者都无法再观察到的值。

## 后果

镜像与持久化文件不再可能在 rename 到 unlink 的窗口内不一致：从任一来源服务的读者看到相同分区。`settings/updated` 监听器现在在文件 provider 的写锁仍然存在时、共享操作链内部运行——再次写入的监听器与此前完全一样排队在当前操作之后，且该链是 promise 队列而非同步互斥量，重入写不可能死锁。忽略回调的 provider（内存 provider 与测试替身）保持原有计时，已在抽象方法上文档化。settings-chrome 的 boot-theme 用例在此前每轮完整套件运行都间歇失败之后，连续三次完整文件运行全部通过（每次 9/9）。
