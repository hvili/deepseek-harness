// @vitest-environment jsdom
/** TestWorkspaces default favorites/tag behaviors, recording, and the stub seat. */
import { describe, expect, it } from 'vitest'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TestWorkspaces } from '../src/workspaces.ts'

const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId

/** TestWorkspaces mutates through the owning runtime's act wrapper. */
const stabilize = async (fn: () => void | Promise<void>): Promise<void> => { await fn() }

describe('TestWorkspaces favorites and tags', () => {
  it('mirrors favorites membership into the list state and records the calls', async () => {
    const workspaces = new TestWorkspaces(stabilize)
    await workspaces.favoriteSession(sid('s1'))
    expect(workspaces.list.getSnapshot().favoriteSessionIds).toEqual([sid('s1')])

    await workspaces.unfavoriteSession(sid('s1'))
    expect(workspaces.list.getSnapshot().favoriteSessionIds).toEqual([])

    expect(workspaces.calls).toEqual([
      { method: 'favoriteSession', args: [sid('s1')] },
      { method: 'unfavoriteSession', args: [sid('s1')] },
    ])
  })

  it('normalizes tag proposals, drops emptied entries, and returns the stored list', async () => {
    const workspaces = new TestWorkspaces(stabilize)
    await expect(workspaces.setSessionTags(sid('s1'), [' a ', '', 'a', 'b']))
      .resolves.toEqual(['a', 'b'])
    expect(workspaces.list.getSnapshot().sessionTagsById).toEqual({ s1: ['a', 'b'] })

    // Replacing another id's list preserves the existing entry untouched.
    await expect(workspaces.setSessionTags(sid('s2'), ['c'])).resolves.toEqual(['c'])
    expect(workspaces.list.getSnapshot().sessionTagsById).toEqual({ s1: ['a', 'b'], s2: ['c'] })

    await expect(workspaces.setSessionTags(sid('s1'), [])).resolves.toEqual([])
    expect(workspaces.list.getSnapshot().sessionTagsById).toEqual({ s2: ['c'] })

    await expect(workspaces.setWorkspaceTags(wid('ws1'), [' team-a ']))
      .resolves.toEqual(['team-a'])
    await expect(workspaces.setWorkspaceTags(wid('ws2'), ['team-b']))
      .resolves.toEqual(['team-b'])
    expect(workspaces.list.getSnapshot().workspaceTagsById).toEqual({ ws1: ['team-a'], ws2: ['team-b'] })
    await expect(workspaces.setWorkspaceTags(wid('ws1'), [])).resolves.toEqual([])
    expect(workspaces.list.getSnapshot().workspaceTagsById).toEqual({ ws2: ['team-b'] })
    expect(workspaces.calls.map(call => call.method)).toEqual([
      'setSessionTags', 'setSessionTags', 'setSessionTags',
      'setWorkspaceTags', 'setWorkspaceTags', 'setWorkspaceTags',
    ])
  })

  it('lets stubs replace the default behaviors while calls still record', async () => {
    const workspaces = new TestWorkspaces(stabilize)
    workspaces.stub('favoriteSession', async () => {})
    await expect(workspaces.favoriteSession(sid('s1'))).resolves.toBeUndefined()
    expect(workspaces.list.getSnapshot().favoriteSessionIds).toEqual([])

    workspaces.stub('unfavoriteSession', async () => {})
    await expect(workspaces.unfavoriteSession(sid('s1'))).resolves.toBeUndefined()

    workspaces.stub('setSessionTags', async (_sessionId, tags) => [tags.join('-')])
    await expect(workspaces.setSessionTags(sid('s1'), ['a', 'b'])).resolves.toEqual(['a-b'])

    workspaces.stub('setWorkspaceTags', async (_workspaceId, tags) => [tags.join('+')])
    await expect(workspaces.setWorkspaceTags(wid('ws'), ['a', 'b'])).resolves.toEqual(['a+b'])

    expect(workspaces.calls.map(call => call.method)).toEqual([
      'favoriteSession', 'unfavoriteSession', 'setSessionTags', 'setWorkspaceTags',
    ])
  })

  it('lets a rejecting favorite stub surface failures without mutating the state', async () => {
    const workspaces = new TestWorkspaces(stabilize)
    workspaces.stub('favoriteSession', async () => {
      throw new Error('favorite rejected')
    })
    await expect(workspaces.favoriteSession(sid('s1'))).rejects.toThrow('favorite rejected')
    expect(workspaces.calls).toEqual([{ method: 'favoriteSession', args: [sid('s1')] }])
    expect(workspaces.list.getSnapshot().favoriteSessionIds).toEqual([])
  })
})
