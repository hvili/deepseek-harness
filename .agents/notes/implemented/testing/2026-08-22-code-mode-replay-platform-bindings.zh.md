# Agent Note: 让 Code Mode 程序按活体平台 shell 回放

Status: implemented

[English](2026-08-22-code-mode-replay-platform-bindings.md) | 中文

## 问题

回放层的工具名映射改写的是工具"调用"，而 Code Mode fixture 的 `run_code` 程序通过录制时的 `tools.` SDK 绑定寻址子工具：程序源码里白纸黑字写着 `tools.bash(...)`。Windows 上调用以 `pwsh` 分发、程序却仍在调用录制时的绑定，执行器于是抛出 "tools.bash is not a function"，场景的子派发一无所获。aria golden 的比对还分叉在另外两个维度上：快照的 YAML 会把 Windows 原生路径的反斜杠双写（{{cwd}} 折叠后留下 `workspace\\missing.txt`），而结算后的会话会渲染 turn-rewind 传送门按钮（编辑、恢复到发送之前）——录制 golden 时它们还不存在。

## 决策

`renameToolCallNames` 额外改写 `run_code` 块参数内的 `tools.<录制名>` 成员访问，且只在 block-end 上进行——那是装配器冻结执行调用的权威 chunk。流式 delta 保留录制拼写；它们只用于呈现。被改写的记号拒绝后继单词字符，因此 `tools.bashx` 永不匹配 `tools.bash`；其他工具的参数原样流出：命令字符串里合法出现的字面量 `tools.bash` 属于录制场景本身。

`normalizeAria` 在 basename 折叠之前先吃掉 YAML 双写的 cwd 拼写，在其后再把残余的双反斜杠折叠为 POSIX 斜杠；引号前的单个反斜杠是 YAML 转义而非分隔符，保持原样。POSIX 全程空操作——其路径不含反斜杠。code-mode-round 的 golden 在结算态补上两个 turn-rewind 按钮，与工具名映射提交一并刷新过的 golden 同属一簇。

## 备选方案

**把 fixture 的程序源码改成 `tools.pwsh`。** 已提交的日志是真实 POSIX 录制；改写它要么让场景失去 bash 覆盖，要么分叉出必须同步重录的按平台 fixture。

**连 delta 一起改写。** 没有任何消费者从 delta 读取执行调用——装配器从 block-end 冻结它——为一个行为改写两层拼写只会让表面积翻倍。

**按 golden 归一化 Windows 路径或维护按平台 golden。** 为仅分隔符不同的内容把已提交 golden 翻倍；折叠属于每个 golden 都已经流经的那一个归一化器。

## 后果

一份 bash 录制的 Code Mode fixture 现在可在 Windows 上回放，子派发以 pwsh 分发并记入日志（CODE_ROUND_OK 内容断言成立），POSIX 则逐字回放程序。绑定改写有单元覆盖并含反例——命令数据里含字面量 `tools.bash` 的非程序调用原样流出——每个场景继续只持有一份 golden：标题折叠（Pwsh 折为 Bash）、路径折叠（反斜杠折为斜杠）、turn-rewind 按钮挂载后两平台渲染一致。未来若有消费者从 delta 读取程序，看到的将是录制拼写；当下可接受，因为只有装配器消费它们。
