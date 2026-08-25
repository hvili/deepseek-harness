import type { MessageFilesProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './MessageFiles.module.css'

/** Render durable file references, extraction status, and their stored preview. */
export function MessageFiles({ files, align, t }: MessageFilesProps) {
  if (files.length === 0) return null
  return (
    <div className={css.root} data-align={align} aria-label={t('file.attachments')}>
      {files.map(({ attachment, preview, extraction }) => (
        <article key={attachment.attachmentId} className={css.card} data-file-extraction={extraction?.status}>
          <div className={css.name}>{attachment.name ?? t('file.unnamed')}</div>
          <div className={css.meta}>{attachment.mediaType} · {t('file.bytes', { bytes: attachment.bytes })}</div>
          {extraction?.status === 'ready' && (
            <div className={css.status}>{t('file.extracted', { chars: extraction.extractedChars })}</div>
          )}
          {extraction?.status === 'failed' && (
            <div className={`${css.status} ${css.failed}`}>{t('file.extractionFailed', { message: extraction.message })}</div>
          )}
          {preview !== undefined && (
            <details className={css.preview}>
              <summary>{t('file.preview')}</summary>
              {preview}
            </details>
          )}
        </article>
      ))}
    </div>
  )
}
