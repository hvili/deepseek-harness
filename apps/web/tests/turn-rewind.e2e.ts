// Web e2e scenario: Turn Rewind restores a real Git worktree and continues
// from a forked session. The shipped web profile now enables turn-rewind, so
// this test exercises the assembled plugin: a seeded session owns one user
// message whose turn has a durable Change Ledger checkpoint captured BEFORE the
// workspace file changed. The browser rewind dialog previews the drift, and
// "restore and continue" reverts the file, creates a rescue point, forks a
// child session, and opens it. The original session log is never truncated.
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  SESSION_FORMAT_VERSION, Session, SessionId, type SessionEvent, type SessionHeader,
} from '@deepseek-ai/dsh-session'
import {
  launchWebScaffold, watchConsole, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SEED_ID = 'turn-rewind-web-e2e'
const PROMPT = 'Modify notes.txt to say after.'
const INITIAL = 'before\n'
const MODIFIED = 'after\n'

/** Minimal host-side view of ctx.changeLedger (the plugin is a bundle dependency, not a host-graph import). */
interface RestorePointLike {
  readonly kind: string
  readonly sessionId?: string
}

interface ChangeLedgerLike {
  createTurnCheckpoint(options: {
    readonly cwd: string
    readonly sessionId: string
    readonly turn: number
    readonly turnStartSeq: number
  }): Promise<unknown>
  list(options: {
    readonly cwd: string
    readonly includeRescue?: boolean
    readonly includeTurnCheckpoints?: boolean
  }): Promise<RestorePointLike[]>
}

function changeLedger(scaffold: WebScaffold): ChangeLedgerLike {
  return (scaffold.ctx as unknown as { changeLedger: ChangeLedgerLike }).changeLedger
}

function git(cwd: string, args: readonly string[]): void {
  execFileSync('git', [...args], { cwd, stdio: 'pipe' })
}

/** Build a two-turn session whose second turn modifies notes.txt. */
function rewindFixture(): { fixture: string; turnStartSeq: number } {
  const session = Session.create(SessionId('turn-rewind-source'))
  session.append('turn/start', { turn: 1 })
  const firstUser = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'First turn.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'Turn Rewind E2E',
    messageSeqs: [firstUser.seq],
    source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: 'First reply.' }],
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  session.append('turn/start', { turn: 2 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: PROMPT }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn: 2, step: 1 })
  const callId = CallId('turn-rewind-write')
  const args = JSON.stringify({ file_path: 'notes.txt', content: MODIFIED })
  session.append('assistant/message', {
    turn: 2,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'tool-call', id: callId, name: 'write', arguments: args }],
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
  }, { surfaceOp: 'append' })
  const call = session.append('tool/call', {
    turn: 2, step: 1, callId, name: 'write', arguments: args,
  })
  session.append('tool/result', {
    turn: 2,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text: 'Updated notes.txt' }],
      isError: false,
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  session.append('step/end', { turn: 2, step: 1 })
  session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

  const turnStart = session.events.findLast((event): event is SessionEvent<'turn/start'> =>
    event.type === 'turn/start' && event.data.turn === 2)
  if (turnStart === undefined) throw new Error('fixture turn/start missing')
  const eventTimeOrigin = new Date().setHours(12, 0, 0, 0)
  const fixture = [
    JSON.stringify({
      type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}',
      createdAt: 0, cwd: '{{cwd}}',
    }),
    ...session.events.map(event => JSON.stringify({
      ...event, time: eventTimeOrigin + event.seq * 1_000,
    })),
    '',
  ].join('\n')
  return { fixture, turnStartSeq: turnStart.seq }
}

describe('web e2e: turn rewind restore and fork', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let projectDir: string

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    // Use a dedicated project subdirectory as the real Git worktree. The
    // scaffold root also owns harness homes, so snapshotting the root would
    // sweep unrelated internal files; the product session cwd is the project.
    projectDir = join(scaffold.workspaceCwd, 'project')
    await mkdir(projectDir, { recursive: true })
    git(projectDir, ['init'])
    git(projectDir, ['config', 'user.email', 'dsh-web-e2e@example.com'])
    git(projectDir, ['config', 'user.name', 'DSH Web E2E'])
    await writeFile(join(projectDir, 'notes.txt'), INITIAL)
    git(projectDir, ['add', 'notes.txt'])
    git(projectDir, ['commit', '-m', 'initial'])

    const { fixture, turnStartSeq } = rewindFixture()
    const events = fixture.trim().split('\n').slice(1).map(line => JSON.parse(line) as SessionEvent)
    const meta: SessionHeader = {
      version: SESSION_FORMAT_VERSION,
      id: SessionId(SEED_ID),
      createdAt: Date.now() - 60_000,
      cwd: projectDir,
      delegationDepth: 0,
    }
    await scaffold.ctx.sessionPersistence.create(meta)
    await scaffold.ctx.sessionPersistence.append(meta.id, events)

    // The durable turn checkpoint must capture the pre-mutation tree, exactly
    // like the plugin's agent/pre-step coordinator does before a real turn.
    await changeLedger(scaffold).createTurnCheckpoint({
      cwd: projectDir,
      sessionId: SEED_ID,
      turn: 2,
      turnStartSeq,
    })
    // Simulate the model's write after the checkpoint was captured.
    await writeFile(join(projectDir, 'notes.txt'), MODIFIED)

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('previews the drift, restores files, preserves the original, and forks a child', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-turn-rewind'))
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    if (await groupRow.getAttribute('aria-expanded') !== 'true') await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await expect.poll(() => page.locator('[data-chat-flow-kind="user"]').count(), {
      timeout: 15_000,
    }).toBeGreaterThan(0)

    const rewindButton = page.getByRole('button', { name: '恢复到发送这条消息之前' })
    await rewindButton.waitFor({ timeout: 15_000 })
    await rewindButton.click()
    const dialog = page.locator('.dcl-rewind-dialog')
    await dialog.waitFor({ timeout: 15_000 })
    await expect.poll(() => dialog.getByText('notes.txt', { exact: true }).count(), {
      timeout: 30_000,
    }).toBeGreaterThan(0)

    // Default mode is "restore files and continue", the full vertical path.
    const restoreResponse = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/turn-rewind' && response.request().method() === 'POST')
    await dialog.getByRole('button', { name: '恢复并从这里继续' }).click()
    const restorePayload = await (await restoreResponse).json() as { sessionId?: string }

    await expect.poll(async () => readFile(join(projectDir, 'notes.txt'), 'utf8'), {
      timeout: 15_000,
    }).toBe(INITIAL)

    // The engine wrote a durable rescue point before mutating the tree.
    const rescue = await changeLedger(scaffold).list({
      cwd: projectDir,
      includeRescue: true,
    })
    expect(rescue.some(point => point.kind === 'rescue')).toBe(true)

    // The turn checkpoint remains inspectable for future rewinds.
    const turns = await changeLedger(scaffold).list({
      cwd: projectDir,
      includeTurnCheckpoints: true,
    })
    expect(turns.some(point => point.kind === 'turn' && point.sessionId === SEED_ID)).toBe(true)

    // A recoverable child revision was created; the original is never truncated.
    expect(typeof restorePayload.sessionId).toBe('string')
    const childId = SessionId(restorePayload.sessionId as string)
    const child = await scaffold.ctx.sessionQuery.readSession(childId)
    expect(child.session.parentSession).toBe(SessionId(SEED_ID))
    const stored = await scaffold.ctx.sessionQuery.readSession(SessionId(SEED_ID))
    expect(stored.events.filter(event => event.type === 'turn/end')).toHaveLength(2)
    expect(stored.events.filter(event => event.type === 'tool/result')).toHaveLength(1)

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 90_000)
})
