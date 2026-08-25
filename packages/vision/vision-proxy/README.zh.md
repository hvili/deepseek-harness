# @deepseek-ai/dsh-vision-proxy

[English](README.md) | 中文

供纯文本对话模型使用的可选图像转文本预处理。当 `enabled` 为 true 时，图像被发送到配置的具备视觉能力的提供方，生成的客观描述会在普通模型步骤写入日志并分发之前替换掉图像。

## 配置

```yaml
vision-proxy:
  enabled: false
  visionProvider: qwen-token-plan-cn
  visionModel: kimi-k2.5
  maxTokens: 1024
  descriptionPrefix: '图片内容（由图像分析模型提取）：'
  errorMode: fail
  timeoutMs: 60000
```

辅助路由必须已注册，且必须接受图像输入。默认路由匹配内置的 Qwen pi-ai 配置档；改用其他具备视觉能力的提供方时请替换它。图像字节被发送给该提供方，描述写入会话日志。模型可见的历史中会替换原始图像块，因此后续轮次看到的是描述，而不是重复回放图像。

`errorMode` 控制辅助视觉调用失败时的行为：

- `fail`（默认）——消息步骤会大声失败，因此纯文本主模型永远不会收到未处理的图像。
- `pass`——原始图像被原样放行。这在主模型确实能处理图像、或你更希望由主模型自身报错而非由 vision-proxy 失败时很有用。

`descriptionPrefix` 设置插入到持久会话日志中生成的描述之前的文本。`timeoutMs` 限制一次辅助调用的时长；默认 60 秒。

重复的图像集会在内存中缓存（最多 64 条，LRU）。缓存键包含提供方、模型、prompt、输出上限和用户文本上下文，因此设置变更或提问不同都不会回放过时的描述。

## 模型体验

间接地，通过配置的图像能力提供方，其描述在面向模型的会话历史中替换原图像。

#### KV Cache 影响

无；描述在面向模型的会话历史中替换原图像，因此没有图像 token 进入请求前缀。

## 已知限制与延期工作

- Web UI 开关由 web settings 插件提供；headless 用户可以直接编辑 settings 命名空间。
- 默认情况下，辅助调用失败会使当前步骤失败；配置 `errorMode: pass` 时则原样放行图像。
- 当前实现记录的是替换后的描述，而非模型可见界面中的原始图像块。