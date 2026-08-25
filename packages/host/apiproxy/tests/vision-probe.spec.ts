import { describe, expect, it } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { expectVisionProbeFinish } from '../src/vision-probe.ts'

describe('vision probe completion', () => {
  it('rejects a stream that closes without a terminal finish chunk', async () => {
    async function* empty(): AsyncIterable<StreamChunk> {
      await Promise.resolve()
    }

    await expect(expectVisionProbeFinish(empty()))
      .rejects.toThrow('vision probe ended without a finish signal')
  })
})
