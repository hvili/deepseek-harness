// @vitest-environment jsdom

import { expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { MessageFilesProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { MessageFiles } from '../src/client/MessageFiles.tsx'

it('renders a restored extraction failure and its persisted preview', () => {
  const t = ((key: string, params?: Readonly<Record<string, unknown>>) => {
    if (key === 'file.bytes') return `${String(params?.bytes)} bytes`
    if (key === 'file.extractionFailed') return `Failed: ${String(params?.message)}`
    return key
  }) as MessageFilesProps['t']
  const props = {
    sessionId: 's1', useSession: vi.fn(), useSessions: vi.fn(), useWorkspaces: vi.fn(), useProjection: vi.fn(), useInput: vi.fn(), inputActions: {},
    align: 'end', t,
    files: [{
      attachment: { kind: 'file' as const, attachmentId: AttachmentId('file-1'), mediaType: 'application/pdf', bytes: 2, name: 'brief.pdf' },
      preview: '[Attached file: brief.pdf]',
      extraction: { status: 'failed' as const, code: 'PDF_TEXT_EXTRACTION_UNAVAILABLE' as const, message: 'PDF text extraction is not enabled in this build.' },
    }],
  } as unknown as MessageFilesProps
  const view = render(<MessageFiles {...props} />)
  expect(view.getByText('brief.pdf')).toBeTruthy()
  expect(view.getByText(/PDF text extraction is not enabled/)).toBeTruthy()
  expect(view.getByText('[Attached file: brief.pdf]')).toBeTruthy()
})
