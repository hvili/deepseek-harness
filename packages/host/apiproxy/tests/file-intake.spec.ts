import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { intakeFileText } from '../src/file-intake.ts'

function ref(mediaType: string, name = 'material'): Parameters<typeof intakeFileText>[0] {
  return { kind: 'file', attachmentId: AttachmentId('sha256:test'), mediaType, bytes: 1, name }
}

describe('file intake', () => {
  it('keeps a bounded UTF-8 preview and durable ready status', () => {
    const result = intakeFileText(ref('text/markdown', 'notes.md'), strToU8('# Heading\nUseful context'))
    expect(result).toMatchObject({
      preview: '[Attached file: notes.md (text/markdown)]\n# Heading\nUseful context',
      extraction: { status: 'ready', extractedChars: 24, truncated: false },
    })
  })

  it('extracts OOXML document text without exposing a host path', () => {
    const docx = zipSync({ 'word/document.xml': strToU8('<w:document><w:t>First</w:t><w:t>second</w:t></w:document>') })
    const result = intakeFileText(ref('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'brief.docx'), docx)
    expect(result.preview).toContain('First second')
    expect(result.extraction).toMatchObject({ status: 'ready' })
  })

  it('reports PDF and malformed Office failures explicitly', () => {
    expect(intakeFileText(ref('application/pdf', 'brief.pdf'), strToU8('%PDF')).extraction)
      .toEqual({ status: 'failed', code: 'PDF_TEXT_EXTRACTION_UNAVAILABLE', message: 'PDF text extraction is not enabled in this build.' })
    expect(intakeFileText(ref('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), strToU8('not a zip')).extraction)
      .toEqual({ status: 'failed', code: 'MALFORMED_OFFICE_DOCUMENT', message: 'The Office document could not be opened.' })
  })
})
