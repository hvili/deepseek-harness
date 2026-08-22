# Agent Note: 将种子里的 shell 工具名折叠到平台活体 shell

Status: implemented

[English](2026-08-22-seeded-shell-tool-fold.md) | 中文

## 问题

种子会话的工具行经活体注册表呈现：api-proxy 按日志里的工具名查找并重算渲染意图。携带 `bash` 调用的 POSIX 录制种子在 pwsh 主机上因此渲染出通用行——没有终端卡、没有展开开关、没有复制按钮——navigation-panes 的终端卡场景与 chat-long-interactions 的行断言在 Windows 上失败。回放会话不受影响，因为 installLlmReplay 的 toolNames 映射早已把分发改名为活体工具，持久日志携带的是平台自己的名字。

## 决策

`seedSession` 在 win32 上把种子录制的 `bash` 工具调用折叠为 `liveShellToolName`——回放映射在种子时刻的孪生——同时改写 `tool/call` 事件与 assistant 消息里的 tool-call 块（容忍个别种子携带的手写扁平消息形状，解析后的日志属于持久文件边界）。POSIX 主机逐字保留 fixture。`normalizeAria` 新增轨迹账本折叠——`row "TOOL, pwsh {` 与 `cell "pwsh{`——让渲染持久事件名的种子账本与 golden 携带的 POSIX 录制一致；agent-preset-authoring lane 的 `withPresetRoot` 现在锚定任一路径分隔符并把子路径折叠到 POSIX 拼写，使 preset-root token 在反斜杠的 Windows 渲染下仍然成立。

## 备选方案

**在 api-proxy 的 `viewFor` 里折叠查找。** 真实的跨平台日志也将渲染出终端卡，但那是产品行为决策（哪个呈现者拥有外来平台记录的名字），超出本 lane 的范围；种子折叠转而镜像既有的回放映射。

**把已提交的种子 fixture 改写成 pwsh。** 一份 fixture 无法逐字服务两个平台；折叠保住了单一录制。

## 后果

种子与回放日志现在携带同样的平台一致 shell 名，终端行覆盖（展开、退出药丸、复制、几何）在 Windows 上与 POSIX 完全一致地运行。折叠是单向的（win32 上 bash 折向活体孪生）；POSIX 上的 pwsh 录制种子保持原样，因为 pwsh-terminal lane 自带 overlay。