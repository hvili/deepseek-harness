import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { intakeFileText } from '../src/file-intake.ts'

function ref(mediaType: string, name?: string): Parameters<typeof intakeFileText>[0] {
  return {
    kind: 'file', attachmentId: AttachmentId('sha256:test'), mediaType, bytes: 1,
    ...name === undefined ? {} : { name },
  }
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

  it('covers bounded text, UTF-8 failures, unnamed files, and unsupported media', () => {
    const long = strToU8(`&lt;&gt;&amp;&quot;&apos; ${'x'.repeat((1 << 20) + 1)}`)
    const bounded = intakeFileText(ref('application/xml'), long)
    expect(bounded.preview).toContain('[Attached file: unnamed file (application/xml)]')
    expect(bounded.preview).toContain('[Text preview truncated.]')
    expect(bounded.extraction).toMatchObject({ status: 'ready', truncated: true })

    expect(intakeFileText(ref('application/json'), Uint8Array.of(0xff)).extraction)
      .toMatchObject({ status: 'failed', code: 'INVALID_TEXT_ENCODING' })
    expect(intakeFileText(ref('application/octet-stream'), Uint8Array.of(1)).extraction)
      .toMatchObject({ status: 'failed', code: 'UNSUPPORTED_FILE_TYPE' })
  })

  it('extracts presentation and spreadsheet XML in deterministic order', () => {
    const pptx = zipSync({
      'ppt/slides/slide10.xml': strToU8('<a:t>ten</a:t>'),
      'ppt/slides/slide2.xml': strToU8('<a:t>two &amp; more</a:t>'),
    })
    const presentation = intakeFileText(
      ref('application/vnd.openxmlformats-officedocument.presentationml.presentation'),
      pptx,
    )
    expect(presentation.preview).toContain('two & more\nten')

    const xlsx = zipSync({
      'xl/worksheets/sheet2.xml': strToU8('<v>second</v>'),
      'xl/worksheets/sheet1.xml': strToU8('<v>first</v>'),
    })
    const spreadsheet = intakeFileText(
      ref('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      xlsx,
    )
    expect(spreadsheet.preview).toContain('first\nsecond')
  })

  it('rejects Office archives whose declared document payload is absent', () => {
    const unrelated = zipSync({ 'other.xml': strToU8('<x>unused</x>') })
    expect(intakeFileText(
      ref('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      unrelated,
    ).extraction).toMatchObject({ status: 'failed', code: 'MALFORMED_OFFICE_DOCUMENT' })
    expect(intakeFileText(
      ref('application/vnd.openxmlformats-officedocument.unknown'),
      unrelated,
    ).extraction).toMatchObject({ status: 'failed', code: 'MALFORMED_OFFICE_DOCUMENT' })
  })
})
