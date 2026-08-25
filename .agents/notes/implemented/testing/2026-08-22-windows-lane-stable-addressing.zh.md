# Agent Note: Windows web lane 的稳定寻址与平台派生

Status: implemented

[English](2026-08-22-windows-lane-stable-addressing.md) | 中文

## 问题

Windows 全量扫描暴露出一批场景级假设：它们在 lane 的编写机上成立，在标准 Windows 主机上不成立。pwsh 键现在经键控 BashRow 渲染（自 471128b175 起 `[data-tool="pwsh"]` 永远匹配不到，该行携带的是 `data-sample`）；侧栏 Ungrouped 标签嵌套四层包装（上溯两级落在布局 span 上，`aria-expanded` 读出 null，展开循环变成反复开合分组而不是驱动 Show-more）；侧栏分组行也携带 `titleRow` 类且在 DOM 中先于会话头出现（头部捕获录到裸的工作区标签）；hmr-live 经子进程运行时派发裸 `pnpm`（libuv 在 Windows 上只解析 .exe 名，而 corepack 管理的 pnpm 只有 .CMD shim）、让页面跟随宿主 locale（zh-CN Windows 把 hero 渲染成中文，英文编辑锚点永不出现）、并为 dev-web 初次构建预算了 60s 而较慢磁盘需要 77s；minimal-preset 快照按录制名 `bash` 对活体注册表分发；粘贴的文本文件如今是会话摄取而非拒绝 toast。

## 决策

每个场景现在寻址它的语义而非布局恰好所在：pwsh 行按其 `data-sample` shell 家族属性定位；Ungrouped 开关与会话头按角色/作用域（`getByRole('treeitem', …)`、`[class*="centerCol"] [class*="titleRow"]`）；hmr-live 在 win32 上经 `cmd /c` 启动 watcher（cmd 的 PATHEXT 解析找得到 .CMD shim）、通过 lane 共享助手把页面钉在 en-US、并为较慢的初次构建重设就绪与测试预算；minimal-preset 派生持久 shell 方言并把工具列表折叠到 POSIX 快照拼写；image-display 断言摄取如今产出的文件栏。golden 中的 turn-rewind 漏网者（lifecycle-chrome 的 reload、subagent-interrupt 的 offline composer）已刷新——它们场景本身健全，interrupt 套件的下游失败正是陈旧 golden 中途中止场景引发的级联。

唯一不可寻址的场景是 goal-multi-turn-actions：它的录制是全套件唯一绑定 POSIX 的模型转录（模型手写了 find/awk/python3/shuf，golden 保留 macOS 拼写），pwsh 真实地令这些命令失败，而 Windows golden 将不得不固化 POSIX golden 拒绝的 Failed 行。其 replay 测试在 win32 跳过（record 保持可用）——该场景的回放覆盖留在测试政策限定 fixture 回放的 macOS/Linux 主机上。

## 备选方案

**为受影响场景做按平台 golden 或跳过。** 上述每处分歧都可寻址；没有一处断言折叠会伪造的平台特定行为。

**保留依赖 locale 的 hero 等待并断言译文。** 编辑锚点是英文源常量；钉住页面是更小且与 locale 无关的契约。

steering lane 的 mid 快照患的是时间而非空间上的同一病症：它只等待 think 块 settle，于是在快主机上"两连拍一致"的稳定轮询可能落定在 ask-question 行（及其后随的用量统计）渲染之前的间隙里，捕获到 golden 并不携带的提问前状态。捕获现在先等待 question 行进入 running 状态。

## 后果

lane 的定位器在重命名包装深度的布局重构后依然存活，HMR 场景在 corepack 管理 pnpm 的任何地方都能运行。粘贴断言如今记载的是摄取契约（非图片文件携移除控件停在文件栏），而不是已被该功能替换掉的 toast。