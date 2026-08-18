/**
 * Attachment seam surface test: the durable immutable attachment vocabulary and
 * the failure shape the host RPC layer routes on. The concrete store behaviour
 * (save/read/validate, content addressing, sharp decode) lives in the
 * attachment-local companion suite; this file pins the seam's own contracts so
 * every provider so far shares one perimeter.
 */
import { describe, expect, it } from 'vitest'
import { AttachmentError } from '../src/error.ts'
import { AttachmentId } from '../src/brand.ts'
import type { ImageAttachmentRef, StoredImageAttachment } from '../src/types.ts'

describe('attachment seam', () => {
  it('brands an opaque identifier without leaking text', () => {
    const id = AttachmentId('sha256:abcdef')
    // Runtime brand keeps the string intact...
    expect(id).toBe('sha256:abcdef')
    // ...but the type is never a plain string at the seam boundary.
    const assignable: AttachmentId = id
    expect(typeof assignable).toBe('string')
  })

  it('carries a stable machine-routing code on AttachmentError', () => {
    const err = new AttachmentError('image rejected', 'IMAGE_TOO_LARGE')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('AttachmentError')
    expect(err.code).toBe('IMAGE_TOO_LARGE')
    expect(err.message).toBe('image rejected')
  })

  it('propagates a chained cause through ErrorOptions', () => {
    const cause = new Error('decode failed')
    const err = new AttachmentError('image rejected', 'INVALID_IMAGE', { cause })
    expect(err.cause).toBe(cause)
  })

  it('exposes the element contract a provider must fulfil', () => {
    // `AttachmentRef` carries only opaque ids and verified dimensions — never a
    // filesystem path or bearer URL — and `StoredImageAttachment` returns bytes
    // alongside the canonical reference.
    const ref = {
      attachmentId: AttachmentId('sha256:abcdef'),
      mediaType: 'image/png',
      bytes: 128,
      width: 640,
      height: 480,
      name: 'scan.png',
    } satisfies ImageAttachmentRef
    const stored = { ref, data: new Uint8Array([1, 2, 3]) } satisfies StoredImageAttachment
    expect(stored.data.length).toBe(3)
    expect(stored.ref).toBe(ref)
    expect(ref.attachmentId).not.toContain('/')
    expect(ref.attachmentId).not.toContain('\\')
  })
})