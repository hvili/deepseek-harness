# @deepseek-ai/dsh-vision-proxy

English | [中文](README.zh.md)

Optional image-to-text preprocessing for a text-only conversation model. When `enabled` is true, images are sent to the configured image-capable provider and the resulting factual description replaces the image before the ordinary model step is logged and dispatched.

## Configuration

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

The auxiliary route must be registered and must accept image input. The default route matches the bundled Qwen pi-ai profile; change it when using another vision-capable provider. The image bytes are sent to that provider and the description is stored in the session log. The original image block is replaced in the model-facing history, so later turns see the description rather than replaying the image.

`errorMode` controls what happens when the auxiliary vision call fails:

- `fail` (default) — the message step fails loudly, so a text-only main model never receives an undealt image.
- `pass` — the original image is allowed through unchanged. This is useful when experimenting with a main model that can actually handle images, or when you prefer the main model's own error rather than a vision-proxy failure.

`descriptionPrefix` sets the text inserted before the generated description in the durable session log. `timeoutMs` bounds one auxiliary call; the default is 60 seconds.

Repeated image sets are cached in memory (up to 64 entries, LRU). The cache key includes provider, model, prompt, output cap, and the user text context, so a settings change or a different question will not replay a stale description.

## Model Experience

Indirectly, through the configured image-capable provider, whose description replaces the image in the model-facing history.

#### KV Cache effect

None; the description replaces the image in the model-facing history, so no image tokens enter the request prefix.

## Known Limitations and Deferred Work

- The web UI switch is supplied by the web settings plugin; headless users can edit the settings namespace directly.
- A failed auxiliary call fails the current step by default, or allows the image through unchanged when `errorMode: pass` is configured.
- The current implementation logs the replacement description, not the original image block, in the model-visible surface.
