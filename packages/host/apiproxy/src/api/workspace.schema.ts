/**
 * workspace domain zod schemas (names derived from map keys). The
 * WorkspaceId brand cast lives in sessions.schema (see the note there) and
 * is re-exported here as the domain-local name.
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { WorkspaceView } from './workspace.ts'
import { sessionIdSchema, workspaceIdSchema } from './sessions.schema.ts'

export { workspaceIdSchema } from './sessions.schema.ts'

/** WorkspaceView row of every workspace.* response. */
export const workspaceViewSchema = z.object({
  workspaceId: workspaceIdSchema,
  path: z.string(),
  title: z.string(),
  sessionIds: z.array(sessionIdSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<Wire<WorkspaceView>>

/** workspace.list request payload (empty object literal). */
export const workspaceListRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'workspace.list'>>>

/** workspace.list response value. */
export const workspaceListValueSchema = z.object({
  items: z.array(workspaceViewSchema),
  archivedSessionIds: z.array(sessionIdSchema),
  favoriteSessionIds: z.array(sessionIdSchema),
  workspaceTagsById: z.record(z.string(), z.array(z.string())),
  sessionTagsById: z.record(z.string(), z.array(z.string())),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.list'>>>

/** workspace.create request payload: the existing directory to adopt. */
export const workspaceCreateRequestSchema = z.object({
  path: z.string(),
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.create'>>>

/** workspace.create response value. */
export const workspaceCreateValueSchema = z.object({
  workspace: workspaceViewSchema,
  created: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.create'>>>

/** workspace.rename request payload: the new title must be non-blank. */
export const workspaceRenameRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
  title: z.string(),
}).refine(
  payload => payload.title.trim() !== '',
  { message: 'workspace.rename requires a non-blank title' },
) satisfies z.ZodType<Wire<RequestPayload<'workspace.rename'>>>

/** workspace.rename response value. */
export const workspaceRenameValueSchema = z.object({
  workspace: workspaceViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.rename'>>>

/** workspace.delete request payload. */
export const workspaceDeleteRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.delete'>>>

/** workspace.delete response value. */
export const workspaceDeleteValueSchema = z.object({
  deleted: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.delete'>>>

/** workspace.insertBefore request payload (anchor omitted = append to end). */
export const workspaceInsertBeforeRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
  beforeWorkspaceId: workspaceIdSchema.optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.insertBefore'>>>

/** workspace.insertBefore response value: the complete durable display order. */
export const workspaceInsertBeforeValueSchema = z.object({
  workspaceIds: z.array(workspaceIdSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.insertBefore'>>>

/** workspace.insertSessionBefore request payload (anchor omitted = append to end). */
export const workspaceInsertSessionBeforeRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
  sessionId: sessionIdSchema,
  beforeSessionId: sessionIdSchema.optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.insertSessionBefore'>>>

/** workspace.insertSessionBefore response value. */
export const workspaceInsertSessionBeforeValueSchema = z.object({
  workspace: workspaceViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.insertSessionBefore'>>>

/** workspace.archiveSession request payload. */
export const workspaceArchiveSessionRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.archiveSession'>>>

/** workspace.archiveSession response value: the full updated archive set. */
export const workspaceArchiveSessionValueSchema = z.object({
  archivedSessionIds: z.array(sessionIdSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.archiveSession'>>>

/** workspace.unarchiveSession request payload. */
export const workspaceUnarchiveSessionRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.unarchiveSession'>>>

/** workspace.unarchiveSession response value: the full updated archive set. */
export const workspaceUnarchiveSessionValueSchema = z.object({
  archivedSessionIds: z.array(sessionIdSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.unarchiveSession'>>>

/** workspace.favoriteSession request payload. */
export const workspaceFavoriteSessionRequestSchema = z.object({ sessionId: sessionIdSchema }) satisfies z.ZodType<Wire<RequestPayload<'workspace.favoriteSession'>>>
/** workspace.favoriteSession response value: the full updated favorite set. */
export const workspaceFavoriteSessionValueSchema = z.object({ favoriteSessionIds: z.array(sessionIdSchema) }) satisfies z.ZodType<Wire<ResponseValue<'workspace.favoriteSession'>>>
/** workspace.unfavoriteSession request payload. */
export const workspaceUnfavoriteSessionRequestSchema = z.object({ sessionId: sessionIdSchema }) satisfies z.ZodType<Wire<RequestPayload<'workspace.unfavoriteSession'>>>
/** workspace.unfavoriteSession response value: the full updated favorite set. */
export const workspaceUnfavoriteSessionValueSchema = z.object({ favoriteSessionIds: z.array(sessionIdSchema) }) satisfies z.ZodType<Wire<ResponseValue<'workspace.unfavoriteSession'>>>

const workspaceTagsSnapshotSchema = z.object({
  workspaceTagsById: z.record(z.string(), z.array(z.string())),
  sessionTagsById: z.record(z.string(), z.array(z.string())),
})
/** workspace.setWorkspaceTags request payload. */
export const workspaceSetWorkspaceTagsRequestSchema = z.object({ workspaceId: workspaceIdSchema, tags: z.array(z.string()) }) satisfies z.ZodType<Wire<RequestPayload<'workspace.setWorkspaceTags'>>>
/** workspace.setWorkspaceTags response value: the updated tag snapshots. */
export const workspaceSetWorkspaceTagsValueSchema = workspaceTagsSnapshotSchema satisfies z.ZodType<Wire<ResponseValue<'workspace.setWorkspaceTags'>>>
/** workspace.setSessionTags request payload. */
export const workspaceSetSessionTagsRequestSchema = z.object({ sessionId: sessionIdSchema, tags: z.array(z.string()) }) satisfies z.ZodType<Wire<RequestPayload<'workspace.setSessionTags'>>>
/** workspace.setSessionTags response value: the updated tag snapshots. */
export const workspaceSetSessionTagsValueSchema = workspaceTagsSnapshotSchema satisfies z.ZodType<Wire<ResponseValue<'workspace.setSessionTags'>>>

/** workspace.removeArchivedSession request payload. */
export const workspaceRemoveArchivedSessionRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.removeArchivedSession'>>>

/** workspace.removeArchivedSession response value: the updated archive set and removal flag. */
export const workspaceRemoveArchivedSessionValueSchema = z.object({
  archivedSessionIds: z.array(sessionIdSchema),
  removed: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.removeArchivedSession'>>>
