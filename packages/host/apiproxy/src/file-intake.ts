/** Bounded text intake for durable generic attachments. @module */

import { strFromU8, unzipSync } from 'fflate'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { FileExtraction } from '@deepseek-ai/dsh-llm'

/** Maximum source bytes decoded for a prompt preview. */
const MAX_SOURCE_BYTES = 1 << 20
/** Maximum UTF-16 code units retained in the durable session event. */
const MAX_PREVIEW_CHARS = 16_000

/** Model-visible and session-restorable file parsing outcome. */
export interface FileIntakeResult {
  readonly preview: string
  readonly extraction: FileExtraction
}

/** Convert safe XML text fragments to human-readable text. */
function xmlText(xml: string): string {
  return xml
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** Extract document XML text from a ZIP-based Office payload. */
function officeText(data: Uint8Array, mediaType: string): string {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(data)
  } catch (error: unknown) {
    /* v8 ignore next -- fflate's synchronous unzip contract throws Error
     * instances; String preserves a defensive foreign-throw diagnostic. */
    throw new Error(`malformed Office ZIP: ${error instanceof Error ? error.message : String(error)}`)
  }
  const names = mediaType.includes('wordprocessingml')
    ? ['word/document.xml']
    : mediaType.includes('presentationml')
      ? Object.keys(entries).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      : mediaType.includes('spreadsheetml')
        ? ['xl/sharedStrings.xml', ...Object.keys(entries).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort()]
        : []
  if (names.length === 0 || names.every(name => entries[name] === undefined)) throw new Error('required Office document XML is missing')
  return names.map((name) => {
    const entry = entries[name]
    return entry === undefined ? '' : xmlText(strFromU8(entry))
  }).filter(Boolean).join('\n')
}

/** Build a bounded, self-identifying preview from extracted text. */
function ready(ref: FileAttachmentRef, text: string, sourceTruncated: boolean): FileIntakeResult {
  const truncated = sourceTruncated || text.length > MAX_PREVIEW_CHARS
  const body = text.slice(0, MAX_PREVIEW_CHARS)
  const suffix = truncated ? '\n[Text preview truncated.]' : ''
  return {
    preview: `[Attached file: ${ref.name ?? 'unnamed file'} (${ref.mediaType})]\n${body}${suffix}`,
    extraction: { status: 'ready', extractedChars: text.length, truncated },
  }
}

/** Build an explicit, model-visible failure while retaining machine-readable cause. */
function failed(ref: FileAttachmentRef, code: Extract<FileExtraction, { status: 'failed' }>['code'], message: string): FileIntakeResult {
  return {
    preview: `[Attached file: ${ref.name ?? 'unnamed file'} (${ref.mediaType}). Text extraction failed: ${message}]`,
    extraction: { status: 'failed', code, message },
  }
}

/** Whether this media type is safe to read as UTF-8 text without a specialized parser. */
function isPlainText(mediaType: string): boolean {
  return mediaType.startsWith('text/') || [
    'application/json', 'application/xml', 'application/javascript', 'application/x-javascript',
    'application/yaml', 'application/x-yaml',
  ].includes(mediaType)
}

/**
 * Extract a durable bounded prompt preview without retaining raw browser bytes.
 * PDF input deliberately yields a stable unavailable result until a full PDF
 * engine is configured; no unreliable regex parsing is presented as text.
 * @param ref - immutable file reference just admitted by the attachment store.
 * @param data - verified source bytes from the same admission request.
 * @returns a preview and durable success/failure status.
 */
export function intakeFileText(ref: FileAttachmentRef, data: Uint8Array): FileIntakeResult {
  if (ref.mediaType === 'application/pdf') {
    return failed(ref, 'PDF_TEXT_EXTRACTION_UNAVAILABLE', 'PDF text extraction is not enabled in this build.')
  }
  const sourceTruncated = data.byteLength > MAX_SOURCE_BYTES
  if (isPlainText(ref.mediaType)) {
    try {
      return ready(ref, new TextDecoder('utf-8', { fatal: true }).decode(data.slice(0, MAX_SOURCE_BYTES)), sourceTruncated)
    } catch {
      return failed(ref, 'INVALID_TEXT_ENCODING', 'The file is not valid UTF-8 text.')
    }
  }
  if (ref.mediaType.includes('openxmlformats-officedocument')) {
    try {
      return ready(ref, officeText(data, ref.mediaType), false)
    } catch {
      return failed(ref, 'MALFORMED_OFFICE_DOCUMENT', 'The Office document could not be opened.')
    }
  }
  return failed(ref, 'UNSUPPORTED_FILE_TYPE', `No text extractor supports ${ref.mediaType}.`)
}
