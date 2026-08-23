# Agent Note: 持久 shell 标记容忍 ConPTY 行内填充

Status: implemented

[English](2026-08-23-persistent-shell-conpty-marker-padding.md) | 中文

## 问题

持久 shell 工具从 retained 终端文本解析完成状态：END 标记的状态数字之后必须紧跟换行，START 标记之后的文本只裁掉恰好一个前导换行。Windows 的 ConPTY 渲染会给行尾填充空格，真实的 pwsh 孪生上状态行呈现 `<END>:0   \n`、START 标记行呈现 `<START> \n`。两个解析在该填充下都失败：`commandOutput` 报告未完成，`partialOutput` 的 prompt-fallback 分支——即 2026-08-22 fallback-marker-leak 修复加固的同一条路径——返回原始尾部，把内部 END 标记与填充残留泄漏进面向模型的结果。表现为 Windows lane 上 minimal-preset web 快照的间歇失败（单文件运行约半数失败）；基于 stub 的包级测试从未复现，因为 stub 输出的是无填充的行。

## 决策

完成模式现在接受状态数字与其换行之间的水平填充（`/^(\d+)[ \t]*\r?\n/`），所有裁掉 START 标记后换行的 trim 都接受该换行之前的填充。尾部 trim 刻意保留输出自身的尾随空格：命令可以合法地打印它们（pwsh 孪生的 prompt-collision 测试锁定了与提示符拼写相同的输出），尾部填充与输出不可区分，因此保留。两个孪生携带同一变更（它们是有意的镜像），各自新增两个标记行带 ConPTY 填充的 stub 模式——一个覆盖完成路径，一个覆盖 newest-page-lags 窗口。

## 备选方案

**在终端 sanitizer 里按行裁尾随空格。** 渲染填充与合法以空格结尾的输出在该层不可区分；该裁剪会破坏真实命令输出。

**重试完成检查直到状态行干净。** 填充一旦写入就是稳定的——它不是撕裂写——重试循环只会空转到上限，永远解析不出状态。

## 后果

在 ConPTY 填充下，完成的命令在完成路径与 retention-lag fallback 路径上都精确返回其输出加退出状态。以空格结尾的输出被逐字节保留。
