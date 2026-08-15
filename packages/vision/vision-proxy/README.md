# @deepseek-ai/dsh-vision-proxy

Optional image-to-text preprocessing for a text-only conversation model. When
`enabled` is true, images are sent to the configured image-capable provider and
the resulting factual description replaces the image before the ordinary model
step is logged and dispatched.

## Configuration

```yaml
vision-proxy:
  enabled: false
  visionProvider: qwen-token-plan-cn
  visionModel: kimi-k2.5
  maxTokens: 1024
```

The auxiliary route must be registered and must accept image input. The default
route matches the bundled Qwen pi-ai profile; change it when using another
vision-capable provider. The image bytes are sent to that provider and the
description is stored in the session log. The original image block is replaced
in the model-facing history, so later turns see the description rather than
replaying the image.

## Model experience

The vision call consumes its own input and output tokens. The main text model
receives the description as ordinary text, so it does not pay for image tokens
or require image support. Descriptions are capped by `maxTokens`; the default
is 1,024 output tokens.

## Known Limitations and Deferred Work

- The web UI switch is supplied by the web settings plugin; headless users can
  edit the settings namespace directly.
- A failed auxiliary call fails the current step rather than silently sending
  an unsupported image to the text model.
- The current implementation logs the replacement description, not the original
  image block, in the model-visible surface.
