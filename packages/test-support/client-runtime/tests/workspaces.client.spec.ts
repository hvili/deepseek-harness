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

    await expect(workspaces.setSessionTags(sid('s1'), [])).resolves.toEqual([])
    expect(workspaces.list.getSnapshot().sessionTagsById).toEqual({})

    await expect(workspaces.setWorkspaceTags(wid('ws'), [' team-a ']))
      .resolves.toEqual(['team-a'])
    expect(workspaces.list.getSnapshot().workspaceTagsById).toEqual({ ws: ['team-a'] })
    expect(workspaces.calls.map(call => call.method)).toEqual([
      'setSessionTags', 'setSessionTags', 'setWorkspaceTags',
    ])
  })

  it('lets a stub replace the default favorite behavior while still recording', async () => {
    const workspaces = new TestWorkspaces(stabilize)
    workspaces.stub('favoriteSession', async () => {
      throw new Error('favorite rejected')
    })
    await expect(workspaces.favoriteSession(sid('s1'))).rejects.toThrow('favorite rejected')
    expect(workspaces.calls).toEqual([{ method: 'favoriteSession', args: [sid('s1')] }])
    expect(workspaces.list.getSnapshot().favoriteSessionIds).toEqual([])
  })
})
