/** Workspace command implementation and stable Remote failure mapping. */

import type { Context } from '@deepseek-ai/cordis'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import {
  WorkspaceId,
  WorkspaceMoveInvalidError,
  WorkspaceOrderInvalidError,
  WorkspaceTagLimitError,
  WorkspaceUnknownSessionError,
  WorkspaceUnknownWorkspaceError,
} from '@deepseek-ai/dsh-workspace'
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { workspaceView } from './feed.ts'
import type {
  WorkspaceArchiveSessionRequest,
  WorkspaceArchiveValue,
  WorkspaceCreateRequest,
  WorkspaceCreateValue,
  WorkspaceDeleteRequest,
  WorkspaceDeleteValue,
  WorkspaceFavoriteSessionRequest,
  WorkspaceFavoriteValue,
  WorkspaceInsertBeforeRequest,
  WorkspaceInsertSessionBeforeRequest,
  WorkspaceOrderValue,
  WorkspaceRenameRequest,
  WorkspaceSessionTagsValue,
  WorkspaceSetSessionTagsRequest,
  WorkspaceSetWorkspaceTagsRequest,
  WorkspaceUnfavoriteSessionRequest,
  WorkspaceValue,
  WorkspaceWorkspaceTagsValue,
} from './types.ts'

/** Implements Workspace mutations against the authoritative registry. */
export class WorkspaceCommands {
  private operationTail = Promise.resolve()

  /** @param ctx - Host context containing the Workspace registry. */
  constructor(private readonly ctx: Context) {}

  /**
   * Create or resolve one Workspace over an existing directory.
   * @param request - directory path to register.
   * @returns the Workspace and whether this call created it.
   */
  create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue> {
    return this.enqueue(async () => {
      try {
        const existing = await this.ctx.workspaceRegistry.resolveByPath(request.path)
        if (existing !== undefined) {
          return { workspace: workspaceView(existing), created: false }
        }
        const workspace = await this.ctx.workspaceRegistry.create(request.path)
        return { workspace: workspaceView(workspace), created: true }
      } catch (error) {
        if (remoteErrorOf(error) !== undefined) throw error
        throw new RemoteError(
          'workspace/invalid-path',
          `cannot create a Workspace at "${request.path}": ${errorMessage(error)}`,
          { path: request.path },
          { cause: error },
        )
      }
    })
  }

  /**
   * Rename one Workspace after serializing title ownership checks.
   * @param request - Workspace identity and proposed title.
   * @returns the updated Workspace projection.
   */
  rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue> {
    const title = request.title.trim()
    if (title === '') {
      return Promise.reject(new RemoteError('gateway/bad-request', 'Workspace rename requires a non-blank title', {}))
    }
    return this.enqueue(async () => {
      const workspace = this.requireWorkspace(request.workspaceId)
      if (title !== workspace.title) {
        if (this.ctx.workspaceRegistry.list().some(candidate =>
          candidate.id !== workspace.id && candidate.title === title)) {
          throw new RemoteError(
            'workspace/name-conflict',
            `Workspace name '${title}' is already in use`,
            { name: title },
          )
        }
        await workspace.setTitle(title)
      }
      return { workspace: workspaceView(workspace) }
    })
  }

  /**
   * Delete one Workspace registration without deleting its directory or Sessions.
   * @param request - Workspace identity to remove.
   * @returns deletion confirmation.
   */
  delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue> {
    return this.enqueue(async () => {
      if (!await this.ctx.workspaceRegistry.delete(WorkspaceId(request.workspaceId))) {
        throw workspaceNotFound(request.workspaceId)
      }
      return { deleted: true }
    })
  }

  /**
   * Move one Workspace within the durable registry order.
   * @param request - moved Workspace and optional anchor.
   * @returns the complete resulting Workspace order.
   */
  async insertBefore(request: WorkspaceInsertBeforeRequest): Promise<WorkspaceOrderValue> {
    try {
      const workspaceIds = await this.ctx.workspaceRegistry.insertBefore(
        WorkspaceId(request.workspaceId),
        request.beforeWorkspaceId === undefined
          ? undefined
          : WorkspaceId(request.beforeWorkspaceId),
      )
      return { workspaceIds: [...workspaceIds] }
    } catch (error) {
      if (!(error instanceof WorkspaceOrderInvalidError)) throw error
      throw workspaceNotFound(error.workspaceId)
    }
  }

  /**
   * Move one accounted Session within a Workspace's manual order.
   * @param request - Workspace, Session, and optional anchor identities.
   * @returns the updated Workspace projection.
   */
  async insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<WorkspaceValue> {
    const workspace = this.requireWorkspace(request.workspaceId)
    try {
      await workspace.insertSessionBefore(request.sessionId, request.beforeSessionId)
    } catch (error) {
      if (!(error instanceof WorkspaceMoveInvalidError)) throw error
      throw new RemoteError(
        'workspace/move-invalid',
        error.message,
        {
          workspaceId: request.workspaceId,
          sessionId: request.sessionId,
          ...request.beforeSessionId === undefined
            ? {}
            : { beforeSessionId: request.beforeSessionId },
        },
        { cause: error },
      )
    }
    return { workspace: workspaceView(workspace) }
  }

  /**
   * Add one known Session to the registry-global archive set.
   * @param request - Session identity to archive.
   * @returns the complete resulting archive set.
   */
  async archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    try {
      await this.ctx.workspaceRegistry.archiveSession(request.sessionId)
    } catch (error) {
      if (!(error instanceof WorkspaceUnknownSessionError)) throw error
      throw new RemoteError('session/not-found', error.message, { sessionId: request.sessionId }, { cause: error })
    }
    return { archivedSessionIds: [...this.ctx.workspaceRegistry.archivedSessionIds] }
  }

  /**
   * Add one known Session to the registry-global favorites set.
   * @param request - Session identity to favorite.
   * @returns the complete resulting favorites set.
   */
  async favoriteSession(request: WorkspaceFavoriteSessionRequest): Promise<WorkspaceFavoriteValue> {
    try {
      await this.ctx.workspaceRegistry.favoriteSession(request.sessionId)
    } catch (error) {
      if (!(error instanceof WorkspaceUnknownSessionError)) throw error
      throw new RemoteError('session/not-found', error.message, { sessionId: request.sessionId }, { cause: error })
    }
    return { favoriteSessionIds: [...this.ctx.workspaceRegistry.favoriteSessionIds] }
  }

  /**
   * Remove one Session from the registry-global favorites set.
   * @param request - Session identity to unfavorite.
   * @returns the complete resulting favorites set.
   */
  async unfavoriteSession(request: WorkspaceUnfavoriteSessionRequest): Promise<WorkspaceFavoriteValue> {
    await this.ctx.workspaceRegistry.unfavoriteSession(request.sessionId)
    return { favoriteSessionIds: [...this.ctx.workspaceRegistry.favoriteSessionIds] }
  }

  /**
   * Replace one Session's complete tag list.
   * @param request - Session identity and proposed tags.
   * @returns the complete resulting Session tag map.
   */
  async setSessionTags(request: WorkspaceSetSessionTagsRequest): Promise<WorkspaceSessionTagsValue> {
    try {
      await this.ctx.workspaceRegistry.setSessionTags(request.sessionId, request.tags)
    } catch (error) {
      if (error instanceof WorkspaceUnknownSessionError) {
        throw new RemoteError('session/not-found', error.message, { sessionId: request.sessionId }, { cause: error })
      }
      if (error instanceof WorkspaceTagLimitError) {
        throw new RemoteError('workspace/invalid-tags', error.message, { reason: error.reason }, { cause: error })
      }
      throw error
    }
    return { sessionTagsById: copyTags(this.ctx.workspaceRegistry.sessionTagsById) }
  }

  /**
   * Replace one Workspace's complete tag list.
   * @param request - Workspace identity and proposed tags.
   * @returns the complete resulting Workspace tag map.
   */
  async setWorkspaceTags(request: WorkspaceSetWorkspaceTagsRequest): Promise<WorkspaceWorkspaceTagsValue> {
    try {
      await this.ctx.workspaceRegistry.setWorkspaceTags(request.workspaceId, request.tags)
    } catch (error) {
      if (error instanceof WorkspaceUnknownWorkspaceError) {
        throw new RemoteError(
          'workspace/not-found',
          error.message,
          { workspaceId: request.workspaceId },
          { cause: error },
        )
      }
      if (error instanceof WorkspaceTagLimitError) {
        throw new RemoteError('workspace/invalid-tags', error.message, { reason: error.reason }, { cause: error })
      }
      throw error
    }
    return { workspaceTagsById: copyTags(this.ctx.workspaceRegistry.workspaceTagsById) }
  }

  private requireWorkspace(workspaceId: WorkspaceId): Workspace {
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(workspaceId))
    if (workspace === undefined) throw workspaceNotFound(workspaceId)
    return workspace
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => undefined, () => undefined)
    return result
  }
}

/** Detach one durable tag map into fresh arrays for Remote transport. */
function copyTags(map: Readonly<Record<string, readonly string[]>>): Record<string, readonly string[]> {
  return Object.fromEntries(Object.entries(map).map(([id, tags]) => [id, [...tags]]))
}

function workspaceNotFound(workspaceId: WorkspaceId): RemoteError<'workspace/not-found'> {
  return new RemoteError(
    'workspace/not-found',
    `Workspace "${workspaceId}" not found`,
    { workspaceId },
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
