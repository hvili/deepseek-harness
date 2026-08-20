# Agent Note: 以完整快照同步持久化的工作区与会话标签

Status: implemented

[English](2026-08-20-workspace-tag-snapshots.md) | 中文

## 问题

工作区和会话标签已持久化在 workspace domain 中，但浏览器客户端需要一个重连基线、一次变更的结果，以及不会在多客户端之间独立漂移的实时更新。

## 决策

`workspace.list` 携带完整的 `workspaceTagsById` 与 `sessionTagsById` map。`workspace.setWorkspaceTags` 和 `workspace.setSessionTags` 替换目标的规范化标签列表，并返回这两个 map。任一 map 在全局 workspace-domain 写入后变化时，`host/workspace-tags-changed` 推送相同的完整快照。

注册表为该投影暴露只读的完整标签 map。API proxy 在发出前复制每个数组。客户端 workspace manager 同时整体替换两个 map，并复制接收到的数组；刷新期间到达的 frame 或 unary 结果优先于该刷新中较旧的基线。

workspace 侧栏在每个目标标题旁渲染标签。项目和会话操作菜单都打开同一个浏览器自有的逗号分隔编辑器；提交时保留原始列表供注册表规范化，随后返回的快照更新每一条可见行。

侧栏搜索将工作区与会话标签作为本地元数据，与标题和工作区名称一同匹配。归档会话在任何元数据匹配之前仍被排除。

项目分组从 `SessionSummary.parentId` 投影可见的普通 fork lineage：子会话紧随可见父会话，并带有受限的侧栏缩进。缺失父项和循环会降级为可见根项，subagent-origin 行仍由独立的 subagent catalog 管理。

## 已考虑的替代方案

**按单个标签发增量 frame。** 否决：set/remove 操作会要求每个客户端处理合并、删除、顺序与重连协调规则。

**把标签嵌入每个工作区或会话列表行。** 否决：会话标签也必须适用于 Ungrouped 会话，而 workspace list 不是权威的会话列表。

## 后果

每个已连接客户端会在变更、host frame 或重连后收敛到同一份持久化标签快照。wire payload 会重复较小的 map，这是以字节换取简单整体替换语义以及丢帧后的恢复能力。共享编辑器让标签保持可访问，同时不在紧凑的侧栏行中新增内联控件。

## 验证

workspace API 测试覆盖了规范化持久化、完整 list 重建基线、host frame 与未知会话拒绝。runtime 测试覆盖 unary 安装与较新的 host frame 替换。fetch carrier 和编译器覆盖全部有类型的 route 与 fixture 实现。
