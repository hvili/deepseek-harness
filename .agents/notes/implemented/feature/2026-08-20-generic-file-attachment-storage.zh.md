# Agent Note: 增加持久化的通用文件附件存储

Status: implemented

[English](2026-08-20-generic-file-attachment-storage.md) | 中文

## 决策

附件边界现在提供 `FileAttachmentRef`：包含 `kind: 'file'` 区分字段、用于路由的 MIME 元数据、字节数、净化后的展示名，以及与图片对象相同的不透明内容寻址 id。`AttachmentStore.saveFile` 与 `readFile` 提供明确的“不支持”默认实现，因此既有测试和第三方存储仍保持源码兼容，而不会意外接受文件。

`LocalAttachmentStore` 覆盖这两个方法。通用字节通过现有的私有暂存、排他硬链接、目录同步和 SHA-256 校验路径发布。本地服务另行采用默认 100 MiB 文件上限，不保存主机路径或浏览器对象 URL。

## 后果

PDF 与 Office 输入现在可以在任意解析开始前保留一个不可变源对象。解析进度、抽取预览和提示词引用可绑定到这个持久 id，而不再保留浏览器本地字节。本变更刻意不宣称解析或会话引用集成已经完成。

共享消息模型现在也具有 `file` 内容块。它持久化文件引用和可选的受限解析预览，绝不保存原始字节或主机路径；尚不了解该块的 provider adapter 仍使用既有未知块降级策略。

## 验证

`pnpm exec vitest run packages/attachment/attachment/tests packages/attachment/attachment-local/tests` 通过：32 个测试通过、1 个跳过。`pnpm exec tsc -b tsconfig.host.json --pretty false` 通过。
