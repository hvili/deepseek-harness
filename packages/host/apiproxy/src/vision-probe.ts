/**
 * End-to-end image-input probe for the `llm.testModel` configuration-plane
 * test. The probe sends one generated 1x1 transparent PNG through the exact
 * adapter path a real image attachment uses, so a route that cannot decode,
 * read, or serialize image input fails here instead of on the first user image.
 *
 * @module @deepseek-ai/dsh-host-apiproxy/vision-probe
 */

import { zlibSync } from 'fflate'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'

/** PNG signature every decoder requires before any chunk. */
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

/** Standard PNG CRC-32 with the PNG polynomial. */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Concatenate byte segments without copying more than once. */
function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** Build one PNG chunk: big-endian length, type, data, CRC over type+data. */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.length)
  for (let index = 0; index < 4; index += 1) {
    chunk[4 + index] = type.charCodeAt(index)
  }
  chunk.set(data, 8)
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)))
  return chunk
}

let cached: Uint8Array | undefined

/** Build the canonical 1x1 transparent RGBA PNG once per process. */
function buildOnePixelPng(): Uint8Array {
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, 1) // width
  view.setUint32(4, 1) // height
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: truecolor with alpha
  const scanline = Uint8Array.of(0, 0, 0, 0, 0) // filter none + one transparent black pixel
  const idat = zlibSync(scanline, { level: 9 })
  return concatBytes(
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', new Uint8Array()),
  )
}

/** The probe image bytes. Immutable and content-addressed once generated. */
export function onePixelPng(): Uint8Array {
  cached ??= buildOnePixelPng()
  return cached
}

/**
 * Consume a probe stream to its terminal finish and throw on an error or
 * aborted finish. A model that returns any completed content — including a
 * tool-call or max-tokens finish — has proven the image-input path works.
 * @param stream - the provider stream for the 1px image request.
 * @returns completion after the terminal finish was observed.
 */
export async function expectVisionProbeFinish(stream: AsyncIterable<StreamChunk>): Promise<void> {
  let finish: Extract<StreamChunk, { type: 'finish' }> | undefined
  for await (const chunk of stream) {
    if (chunk.type === 'finish') finish = chunk
  }
  if (finish === undefined) throw new Error('vision probe ended without a finish signal')
  if (finish.reason.kind === 'error' || finish.reason.kind === 'aborted') {
    throw new Error(finish.reason.failure.message)
  }
}
