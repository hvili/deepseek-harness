# Agent Note: 在 aria golden 中折叠平台形态的后台任务详情

Status: implemented

[English](2026-08-22-background-jobs-platform-outcome.md) | 中文

## 问题

background-job-list e2e 通过脚手架的活体工具集派发一次真实的 `run_in_background` shell 调用，因此其硬编码的 `name: 'bash'` 在 Windows 上无法分发（标准预设搭载 pwsh），job-id 探测 `\bbash-\d+\b` 也匹配不到注册表的 `pwsh-N` 形态。aria golden 还分叉在另外两个维度上：任务行把注册表 kind 渲染为 listitem 的首个 token（POSIX 录制显示 `bash`，Windows 显示 `pwsh`）；被杀死任务的结局详情是真正的平台形态——POSIX 以 `signal: SIGTERM` 结算，而 Windows 强杀不携带信号、以 `killed before exit` 结算（pwsh 工具文档将这一差异记载为有意行为）。

## 决策

测试通过 `liveShellToolName`（脚手架中平台 shell 工具的唯一事实来源）派发与探测，POSIX 继续逐字练习 bash。`normalizeAria` 新增两处折叠：任务行的 kind 在 win32 上把 `listitem: ` 之后的 `pwsh ` 折为 `bash `——既有标题折叠的小写孪生；两种结局拼写（`signal: SIGTERM`、`killed before exit`）在所有平台上都折叠为 `{{outcome}}`，并把 POSIX 冒号引发的 YAML 引号在已折叠值周围剥掉，使两平台的行收敛。settled golden 改为携带 token 拼写。

结局折叠刻意不做"改名"：把 `killed before exit` 改写成 `signal: SIGTERM` 会让 golden 断言一个 Windows 永远不会交付的信号。token 断言的是结算详情"已渲染"（详情缺失时会留下状态词 `killed`，它不匹配折叠规则），而不断言任一平台的 kill 语义；该词汇本身在 tool-pwsh 的 `processOutcome` 套件中有单元覆盖。

## 备选方案

**把 Windows 拼写折叠为 POSIX 拼写。** 伪造了文档记载的平台行为——golden 会宣称在一个没有信号的平台交付了 SIGTERM。

**按平台维护 settled golden。** 为结构、翻转时机、词汇位置完全一致的行把已提交 golden 翻倍；差异只在详情一词。

**在测试里而不是 golden 里断言详情。** golden 的职责就是渲染出的行；把详情断言移出去会把一条交付路径的检查拆到两套机制里。

## 后果

每个状态一份 golden 同时服务两个平台：running 行只差被折叠的 kind token，settled 行只差被折叠的 outcome token。剥引号规则只作用于已携带 `{{outcome}}` 的行（只有这些 golden 会产生它），由其他内容驱动的 YAML 引号不受影响。未来在 aria 行中渲染的新 job kind（第三个 shell、容器工具）需要把 kind 折叠模式扩展到其位置；结局折叠的窄拼写意味着新的结算词汇（例如 `exit code: N`）只在某个 golden 首次需要时才加入折叠。
