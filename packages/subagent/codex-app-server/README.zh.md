# @deepseek-ai/dsh-codex-app-server

[English](README.md) | 中文

官方 Codex app-server 的版本锁定集成原语。此包从自己的依赖中解析 `@openai/codex` wrapper，提供稳定 TypeScript/JSON Schema 命令，完成必需的 JSON-RPC 初始化握手，并等待受管进程树完全退出。

产品适配器负责线程选择、turn 流、审批策略、持久化和 UI 投影。共享客户端不会选择 Codex 实验 API、登录账户、选择模型、创建产品记录，也不会自行启动进程。

## 兼容性

`CODEX_RUNTIME_VERSION` 与两个命令构造器都指向精确的 package 依赖。升级依赖时必须重新生成稳定 schema，并重跑握手、线程恢复、审批、review、取消、异常协议和进程静默退出测试。生成结果与版本绑定，不得混用其他 Codex 二进制生成的 schema。

`schema/stable-json-schema.manifest.json` 记录稳定 JSON Schema 输出的确定性聚合指纹。包测试会从包内运行时重新生成该输出，并拒绝文件数量或内容漂移。实验性方法会被刻意排除。

Codex 使用 Apache-2.0 许可证。发行制品保留官方 package 的许可证和生成的第三方声明。模型调用仍可能消耗 OpenAI/Codex 额度。

## 模型体验

### 基础设施边界

#### 模型看到的内容

本包自身不会让模型看到任何内容。它不公开面向模型的工具或提示词；由产品适配器决定哪些 `request()` 载荷与结果进入模型上下文。

#### 对 token 的影响

本包自身没有影响。Token 用量属于消费方适配器及其选择的 Codex turn。

#### 对 KV Cache 的影响

本包自身没有影响。缓存行为由消费方适配器面向模型的请求形态决定。

## 已知限制与待处理工作

- 此包以方法名和对象参数公开稳定 JSON-RPC 请求；消费者需要把它们绑定到生成的 schema。
- WebSocket、远程 relay、插件安装、认证界面和 Codex 项目数据库不属于此包。
