/** Real built Web/Host smoke plus copied-data recovery across two processes. */

import type { Browser } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runRecoveryGate } from '../../../scripts/product-web-recovery-support.ts'

let browser: Browser | undefined

describe('non-destructive Web copy recovery gate', () => {
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
  })

  afterAll(async () => {
    await browser?.close()
    browser = undefined
  })

  it('serves the built Web surface and reopens copied state in a fresh process', async () => {
    const report = await runRecoveryGate({
      browserSmoke: async (baseUrl) => {
        if (browser === undefined) throw new Error('browser was not initialized')
        const page = await browser.newPage({ locale: 'en-US' })
        try {
          const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
          expect(response?.ok()).toBe(true)
          await page.waitForFunction(
            () => (document.body.textContent?.trim().length ?? 0) > 0,
            undefined,
            { timeout: 30_000 },
          )
          const bootPayload = await page.evaluate(() => (window as Window & { __DSH_BOOT__?: unknown }).__DSH_BOOT__)
          expect(bootPayload).toBeDefined()
        } finally {
          await page.close()
        }
      },
    })
    expect(report.sourceUnchanged).toBe(true)
    expect(report.sourceBefore.digest).toBe(report.sourceAfter.digest)
    expect(report.firstProcess.stop.portReleased).toBe(true)
    expect(report.firstProcess.stop.treeQuiescent).toBe(true)
    expect(report.secondProcess.stop.portReleased).toBe(true)
    expect(report.secondProcess.stop.treeQuiescent).toBe(true)
    expect(report.tempRootCleaned).toBe(true)
  }, 360_000)
})
