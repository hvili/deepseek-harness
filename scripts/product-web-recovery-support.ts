/**
 * Non-destructive Web/Host recovery-gate support.
 *
 * The gate deliberately works on a small, test-owned projection of one
 * Workspace, one Session, and one content-addressed image. It never hands the
 * live source home to the child process: the child receives a filtered copy
 * whose cwd and Workspace record are rebased into the gate's private world.
 * @module dsh/product-web-recovery-support
 */

import { execFile as execFileCallback, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, unlink, writeFile,
} from 'node:fs/promises'
import { createServer, createConnection } from 'node:net'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { SESSION_FORMAT_VERSION, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import {
  encodeSegment, eventLines, logPath, projectDir, toHeaderLine,
} from '../packages/session/session-persistence-jsonl/src/format.ts'
import { createZstdFrameDecoder, scanZstdFrames } from '../packages/session/session-persistence-jsonl/src/zstd.ts'

const execFile = promisify(execFileCallback)
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url))
const BUILT_DSH_BIN = join(REPO_ROOT, 'apps', 'cli', 'lib', 'bin.js')
const WEB_DIST_INDEX = join(REPO_ROOT, 'apps', 'web', 'dist', 'index.html')
const ARTIFACT_ROOT = join(REPO_ROOT, '.artifacts')
const DEFAULT_READY_TIMEOUT_MS = 150_000
const READY_POLL_MS = 100
// Cold-session history/attachment reads may cross the first detached
// presenter composition. Keep each request bounded, but do not confuse that
// one-time work with a dead Web process.
const REQUEST_TIMEOUT_MS = 15_000
const GRACEFUL_STOP_TIMEOUT_MS = 8_000
const FORCE_STOP_TIMEOUT_MS = 12_000
const PORT_RELEASE_TIMEOUT_MS = 12_000
const SOURCE_HOME_DENY = /(?:^|_)(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|COOKIE|AUTH)(?:_|$)/iu

/** One image reference and its expected bytes in the recovery fixture. */
export interface RecoveryAttachment {
  /** Content-addressed attachment id. */
  attachmentId: string
  /** Stored image media type. */
  mediaType: string
  /** Stored byte count. */
  bytes: number
  /** Stored image width. */
  width: number
  /** Stored image height. */
  height: number
  /** Optional user-visible file name. */
  name?: string
  /** Exact stored bytes, encoded for API comparison. */
  dataBase64: string
}

/** Durable state expected from one source Workspace/Session. */
export interface RecoveryExpectedState {
  /** Workspace display title. */
  workspaceTitle: string
  /** Durable Workspace tags, in stored order. */
  workspaceTags: string[]
  /** Durable Session tags, in stored order. */
  sessionTags: string[]
  /** Whether the selected Session is archived. */
  archived: boolean
  /** Whether the selected Session is favorited. */
  favorite: boolean
}

/** Read-only source dataset descriptor used by the copy gate. */
export interface RecoveryDataset {
  /** Source DSH home; read-only for the complete gate lifetime. */
  sourceHome: string
  /** Source Workspace directory; read-only for the complete gate lifetime. */
  sourceWorkspace: string
  /** Selected durable Session id. */
  sessionId: string
  /** Selected durable Workspace id. */
  workspaceId: string
  /** Expected durable values. */
  expected: RecoveryExpectedState
  /** Expected content-addressed image. */
  attachment: RecoveryAttachment
}

/** A deterministic checksum snapshot of all regular files below a directory. */
export interface TreeSnapshot {
  /** Root represented by this snapshot. */
  root: string
  /** Sorted relative file entries. */
  files: Array<{ path: string; bytes: number; sha256: string }>
  /** SHA-256 over the sorted relative file entries and their content hashes. */
  digest: string
}

/** Source-home and Workspace snapshots used to prove the source stayed unchanged. */
export interface RecoverySourceSnapshot {
  /** Snapshot of the source DSH home. */
  home: TreeSnapshot
  /** Snapshot of the source Workspace directory. */
  workspace: TreeSnapshot
  /** Combined source proof digest. */
  digest: string
}

/** The filtered, rebased data copy that the real child process is allowed to open. */
export interface RecoveryCopy {
  /** Test-owned DSH home containing only the selected durable records. */
  home: string
  /** Test-owned Workspace cwd. */
  workspace: string
  /** Test-owned Agent home. */
  agentsHome: string
  /** Test-owned bundled-skill directory. */
  bundledSkillDir: string
  /** Test-only overlay forcing plaintext JSONL for a deterministic copy. */
  patchPath: string
}

/** Symlink probe result; an unavailable Windows privilege is not a product failure. */
export type SymlinkProbeResult =
  | { status: 'supported' }
  | { status: 'environment-limitation'; code: 'EPERM' | 'EACCES'; message: string }

/** One process exit/cleanup proof returned by the managed Web child. */
export interface ProcessStopEvidence {
  /** Exact root pid passed to the process-tree cleanup. */
  pid: number
  /** Whether the graceful wait elapsed before the child stopped. */
  timedOut: boolean
  /** Node's observed exit signal, when available. */
  signal: NodeJS.Signals | null
  /** Node's observed exit code, when available. */
  exitCode: number | null
  /** Whether forceful tree termination was needed. */
  forced: boolean
  /** Whether the requested TCP port was confirmed closed. */
  portReleased: boolean
  /** Whether the known process tree was confirmed quiescent. */
  treeQuiescent: boolean
}

/** Explicit external readiness boundary for one real Web process. */
export interface WebReadyBoundary {
  /** URL emitted by the settled Web bundle. */
  url: string
  /** HTTP status from an external GET of the Web root. */
  rootStatus: number
  /** External `host.describe` RPC response. */
  host: Record<string, unknown>
}

/** A real built Web/Host child plus an idempotent, verified teardown. */
export interface ManagedWebProcess {
  /** Exact root pid. */
  pid: number
  /** Concrete test-owned port passed to the child. */
  port: number
  /** Settled Web URL. */
  baseUrl: string
  /** Readiness boundary observed before the process was handed to the caller. */
  ready: WebReadyBoundary
  /** Captured child stdout/stderr, truncated only when used in an error. */
  output(): string
  /** Stop the entire process tree, confirm port release, and return evidence. */
  stop(): Promise<ProcessStopEvidence>
}

/** Browser-free callback used by the Web e2e lane for one real-page smoke. */
export interface RecoveryGateOptions {
  /** Optional source data; omitted creates a deterministic test-owned source fixture. */
  dataset?: RecoveryDataset
  /** Optional callback after the first process reaches the ready boundary. */
  browserSmoke?: (baseUrl: string) => Promise<void>
  /** Readiness deadline per real process. */
  timeoutMs?: number
}

/** Complete evidence returned by the product recovery gate. */
export interface RecoveryGateReport {
  /** Source checksum proof before the first child starts. */
  sourceBefore: RecoverySourceSnapshot
  /** Source checksum proof after both child lifetimes complete. */
  sourceAfter: RecoverySourceSnapshot
  /** Symlink capability classification from the test-owned probe. */
  symlink: SymlinkProbeResult
  /** First process's identity, recovery read, and teardown evidence. */
  firstProcess: { pid: number; port: number; ready: WebReadyBoundary; stop: ProcessStopEvidence }
  /** Second process's identity, recovery read, and teardown evidence. */
  secondProcess: { pid: number; port: number; ready: WebReadyBoundary; stop: ProcessStopEvidence }
  /** True only after source snapshots compare exactly. */
  sourceUnchanged: true
  /** The private world path, which is absent after successful cleanup. */
  tempRoot: string
  /** True only after the private world has been removed. */
  tempRootCleaned: true
}

interface WorkspaceStorageDocument {
  unit?: { name?: unknown; version?: unknown }
  global?: Record<string, unknown>
  tables?: { workspaces?: Record<string, WorkspaceStorageRecord> }
}

interface WorkspaceStorageRecord {
  path?: unknown
  title?: unknown
  sessionIds?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

interface ImageReferenceShape {
  attachmentId: string
  mediaType: string
  bytes: number
  width: number
  height: number
  name?: string
}

interface ChildExit {
  code: number | null
  signal: NodeJS.Signals | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function pathKey(path: string): string {
  const value = resolve(path)
  return process.platform === 'win32' ? value.toLowerCase() : value
}

function pathsEquivalent(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right)
}

function isWithin(parent: string, candidate: string): boolean {
  const child = relative(resolve(parent), resolve(candidate))
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))
}

function assertDisjoint(left: string, right: string, label: string): void {
  if (isWithin(left, right) || isWithin(right, left)) {
    throw new Error(`${label} paths overlap: ${JSON.stringify(resolve(left))} and ${JSON.stringify(resolve(right))}`)
  }
}

async function requireDirectory(path: string, label: string): Promise<string> {
  const absolute = resolve(path)
  const entry = await lstat(absolute)
  if (entry.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${absolute}`)
  if (!entry.isDirectory()) throw new Error(`${label} is not a directory: ${absolute}`)
  return await realpath(absolute)
}

async function requireRegularFile(path: string, label: string): Promise<string> {
  const absolute = resolve(path)
  const entry = await lstat(absolute)
  if (entry.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${absolute}`)
  if (!entry.isFile()) throw new Error(`${label} is not a regular file: ${absolute}`)
  return absolute
}

async function removeOwnedDirectory(path: string, parent: string): Promise<void> {
  const absolute = resolve(path)
  if (!isWithin(parent, absolute) || pathsEquivalent(parent, absolute)) {
    throw new Error(`refusing to remove a non-child test directory: ${absolute}`)
  }
  let entry
  try {
    entry = await lstat(absolute)
  } catch (error: unknown) {
    if (errorCode(error) === 'ENOENT') return
    throw error
  }
  if (entry.isSymbolicLink()) throw new Error(`refusing recursive removal of a symbolic link: ${absolute}`)
  if (!entry.isDirectory()) throw new Error(`refusing to remove a non-directory: ${absolute}`)
  await rm(absolute, { recursive: true, force: true })
}

async function snapshotDirectory(path: string): Promise<TreeSnapshot> {
  const root = await requireDirectory(path, 'snapshot root')
  const files: Array<{ path: string; bytes: number; sha256: string }> = []

  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const absolute = join(directory, entry.name)
      const info = await lstat(absolute)
      const childPath = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (info.isSymbolicLink()) {
        throw new Error(`source snapshot refuses to follow link-shaped entry: ${absolute}`)
      }
      if (info.isDirectory()) {
        await visit(absolute, childPath)
      } else if (info.isFile()) {
        const bytes = await readFile(absolute)
        files.push({ path: childPath, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') })
      } else {
        throw new Error(`source snapshot encountered a non-regular entry: ${absolute}`)
      }
    }
  }

  await visit(root, '')
  const digest = createHash('sha256').update(JSON.stringify(files)).digest('hex')
  return { root, files, digest }
}

/** Snapshot a source home and Workspace without opening either in the Host process. */
export async function snapshotRecoverySource(dataset: RecoveryDataset): Promise<RecoverySourceSnapshot> {
  const home = await snapshotDirectory(dataset.sourceHome)
  const workspace = await snapshotDirectory(dataset.sourceWorkspace)
  const digest = createHash('sha256').update(`${home.digest}\n${workspace.digest}`).digest('hex')
  return { home, workspace, digest }
}

function assertSnapshotUnchanged(before: TreeSnapshot, after: TreeSnapshot, label: string): void {
  if (before.digest !== after.digest || JSON.stringify(before.files) !== JSON.stringify(after.files)) {
    throw new Error(`${label} changed during recovery gate (before ${before.digest}, after ${after.digest})`)
  }
}

/** Assert the source home and Workspace remained byte-identical. */
export function assertRecoverySourceUnchanged(
  before: RecoverySourceSnapshot,
  after: RecoverySourceSnapshot,
): void {
  assertSnapshotUnchanged(before.home, after.home, 'source home')
  assertSnapshotUnchanged(before.workspace, after.workspace, 'source Workspace')
  if (before.digest !== after.digest) throw new Error(`source checksum changed (before ${before.digest}, after ${after.digest})`)
}

async function copyTree(source: string, target: string): Promise<void> {
  const sourceRoot = await requireDirectory(source, 'copy source')
  await mkdir(target, { recursive: true, mode: 0o700 })
  const entries = await readdir(sourceRoot, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    const sourcePath = join(sourceRoot, entry.name)
    const targetPath = join(target, entry.name)
    const info = await lstat(sourcePath)
    if (info.isSymbolicLink()) {
      throw new Error(`copy refuses to follow link-shaped entry: ${sourcePath}`)
    }
    if (info.isDirectory()) {
      await copyTree(sourcePath, targetPath)
    } else if (info.isFile()) {
      await copyFile(sourcePath, targetPath)
    } else {
      throw new Error(`copy encountered a non-regular entry: ${sourcePath}`)
    }
  }
}

async function decodeSessionArtifact(path: string): Promise<string> {
  const bytes = await readFile(path)
  if (!path.endsWith('.zstd')) return bytes.toString('utf8')
  const scan = scanZstdFrames(bytes)
  if (scan.tornStart !== undefined) throw new Error(`source Session artifact has an incomplete zstd frame: ${path}`)
  const decoder = createZstdFrameDecoder()
  const frames: Buffer[] = []
  try {
    for (const frame of decoder.decode(bytes, scan.frames)) frames.push(Buffer.from(frame))
  } finally {
    decoder.close()
  }
  return Buffer.concat(frames).toString('utf8')
}

/** Rebase only the Session header cwd while preserving every durable event row byte-for-byte. */
export function rebaseSessionJsonlForRecovery(text: string, sourceWorkspace: string, targetWorkspace: string): string {
  let recordIndex = 0
  return text.split(/(\r?\n)/u).map((part) => {
    if (part === '\n' || part === '\r\n' || part === '') return part
    let parsed: unknown
    try {
      parsed = JSON.parse(part) as unknown
    } catch (error: unknown) {
      throw new Error(`Session copy contains a non-JSONL row: ${errorMessage(error)}`)
    }
    const currentIndex = recordIndex
    recordIndex += 1
    if (currentIndex !== 0) return part
    if (!isRecord(parsed) || parsed.type !== 'session') {
      throw new Error('Session copy does not begin with a Session header')
    }
    if (typeof parsed.cwd !== 'string' || !pathsEquivalent(parsed.cwd, sourceWorkspace)) {
      throw new Error(`Session header cwd does not match the selected source Workspace: ${String(parsed.cwd)}`)
    }
    return JSON.stringify({ ...parsed, cwd: targetWorkspace })
  }).join('')
}

function firstImageReference(value: unknown): ImageReferenceShape | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstImageReference(item)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (!isRecord(value)) return undefined
  if (value.type === 'image' && isRecord(value.attachment)
    && typeof value.attachment.attachmentId === 'string'
    && typeof value.attachment.mediaType === 'string'
    && typeof value.attachment.bytes === 'number'
    && typeof value.attachment.width === 'number'
    && typeof value.attachment.height === 'number') {
    return {
      attachmentId: value.attachment.attachmentId,
      mediaType: value.attachment.mediaType,
      bytes: value.attachment.bytes,
      width: value.attachment.width,
      height: value.attachment.height,
      ...typeof value.attachment.name === 'string' ? { name: value.attachment.name } : {},
    }
  }
  for (const child of Object.values(value)) {
    const found = firstImageReference(child)
    if (found !== undefined) return found
  }
  return undefined
}

function nonEmptyStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? [...value] : []
}

async function readWorkspaceSource(home: string, workspace: string): Promise<{
  workspaceId: string
  sessionId: string
  record: { title: string; createdAt: string; updatedAt: string }
  global: Record<string, unknown>
}> {
  const storagePath = await requireRegularFile(join(home, 'storages', 'workspace.json'), 'Workspace storage')
  let document: WorkspaceStorageDocument
  try {
    document = JSON.parse(await readFile(storagePath, 'utf8')) as WorkspaceStorageDocument
  } catch (error: unknown) {
    throw new Error(`Workspace storage is not valid JSON: ${errorMessage(error)}`)
  }
  const records = document.tables?.workspaces
  if (document.unit?.name !== 'workspace' || document.unit.version !== 2 || records === undefined) {
    throw new Error('Workspace storage is not a v2 workspace unit')
  }
  const match = Object.entries(records).find(([, record]) => (
    typeof record.path === 'string' && pathsEquivalent(record.path, workspace)
  ))
  if (match === undefined) throw new Error(`Workspace storage has no record for ${workspace}`)
  const [workspaceId, record] = match
  const sessionIds = Array.isArray(record.sessionIds)
    ? record.sessionIds.filter((id): id is string => typeof id === 'string')
    : []
  if (sessionIds.length === 0) throw new Error(`Workspace ${workspaceId} has no Session to recover`)
  if (typeof record.title !== 'string' || typeof record.createdAt !== 'string' || typeof record.updatedAt !== 'string') {
    throw new Error(`Workspace ${workspaceId} has incomplete durable metadata`)
  }
  return {
    workspaceId,
    sessionId: requireValue(sessionIds[0], `Workspace ${workspaceId} has no first Session id`),
    record: { title: record.title, createdAt: record.createdAt, updatedAt: record.updatedAt },
    global: document.global ?? {},
  }
}

async function findSourceSessionArtifact(home: string, workspace: string, sessionId: string): Promise<string> {
  const directory = join(projectDir(join(home, 'sessions'), workspace), encodeSegment(sessionId))
  const plain = join(directory, 'session.jsonl')
  const compressed = join(directory, 'session.jsonl.zstd')
  const candidates = [plain, compressed]
  const found: string[] = []
  for (const candidate of candidates) {
    try {
      found.push(await requireRegularFile(candidate, 'Session artifact'))
    } catch (error: unknown) {
      if (errorCode(error) !== 'ENOENT') throw error
    }
  }
  if (found.length !== 1) throw new Error(`expected exactly one Session artifact in ${directory}, found ${String(found.length)}`)
  return requireValue(found[0], `Session artifact disappeared from ${directory}`)
}

/** Inspect one read-only source home and derive the selected recovery state. */
export async function inspectRecoveryDataset(sourceHome: string, sourceWorkspace: string): Promise<RecoveryDataset> {
  const home = await requireDirectory(sourceHome, 'source home')
  const workspace = await requireDirectory(sourceWorkspace, 'source Workspace')
  const source = await readWorkspaceSource(home, workspace)
  const artifact = await findSourceSessionArtifact(home, workspace, source.sessionId)
  const sessionText = await decodeSessionArtifact(artifact)
  const attachmentRef = firstImageReference(sessionText.split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line) as unknown))
  if (attachmentRef === undefined) throw new Error(`Session ${source.sessionId} has no image attachment reference`)
  const match = /^sha256:([a-f0-9]{64})$/u.exec(attachmentRef.attachmentId)
  if (match?.[1] === undefined) throw new Error(`Session ${source.sessionId} has a non-content-addressed attachment reference`)
  const objectPath = join(home, 'attachments', 'v1', 'objects', match[1].slice(0, 2), match[1])
  const objectBytes = await readFile(await requireRegularFile(objectPath, 'attachment object'))
  const actual = createHash('sha256').update(objectBytes).digest('hex')
  if (actual !== match[1] || objectBytes.byteLength !== attachmentRef.bytes) {
    throw new Error(`attachment object failed source integrity verification: ${objectPath}`)
  }
  const global = source.global
  const archivedSessionIds = nonEmptyStringArray(global.archivedSessionIds)
  const favoriteSessionIds = nonEmptyStringArray(global.favoriteSessionIds)
  const workspaceTagsById = isRecord(global.workspaceTagsById) ? global.workspaceTagsById : {}
  const sessionTagsById = isRecord(global.sessionTagsById) ? global.sessionTagsById : {}
  return {
    sourceHome: home,
    sourceWorkspace: workspace,
    sessionId: source.sessionId,
    workspaceId: source.workspaceId,
    expected: {
      workspaceTitle: source.record.title,
      workspaceTags: nonEmptyStringArray(workspaceTagsById[source.workspaceId]),
      sessionTags: nonEmptyStringArray(sessionTagsById[source.sessionId]),
      archived: archivedSessionIds.includes(source.sessionId),
      favorite: favoriteSessionIds.includes(source.sessionId),
    },
    attachment: {
      ...attachmentRef,
      dataBase64: objectBytes.toString('base64'),
    },
  }
}

/** Create a deterministic, test-owned source home with Workspace, Session, image, tags, favorite, and archive state. */
export async function createRecoveryFixture(root: string): Promise<RecoveryDataset> {
  const fixtureRoot = resolve(root)
  await mkdir(fixtureRoot, { recursive: true, mode: 0o700 })
  const sourceHome = join(fixtureRoot, 'source-home')
  const sourceWorkspace = join(fixtureRoot, 'source-workspace')
  await mkdir(join(sourceHome, 'sessions'), { recursive: true, mode: 0o700 })
  await mkdir(join(sourceHome, 'storages'), { recursive: true, mode: 0o700 })
  await mkdir(sourceWorkspace, { recursive: true, mode: 0o700 })
  await writeFile(join(sourceWorkspace, 'recovery-fixture.txt'), 'test-owned recovery fixture\n', 'utf8')

  const imageBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAYAAAA/xl1SAAAAvklEQVR42u3SMQ0AAAjAMIyhELM4AAe8PD1qYFlk9cCXEAEDYkAwIAYEA2JAMCAGBANiQDAgBgQDYkAwIAYEA2JAMCAGBANiQDAgBgQDYkAwIAYEA2JAMCAGxIBCYEAMCAbEgGBADAgGxIBgQAwIBsSAYEAMCAbEgGBADAgGxIBgQAwIBsSAYEAMCAbEgGBADAgGxIAYEAyIAcGAGBAMiAHBgBgQDIgBwYAYEAyIAcGAGBAMiAHBgBgQDIgB4bYWLb6pnOb1xAAAAABJRU5ErkJggg==',
    'base64',
  )
  const attachmentHash = createHash('sha256').update(imageBytes).digest('hex')
  const attachment: RecoveryAttachment = {
    attachmentId: `sha256:${attachmentHash}`,
    mediaType: 'image/png',
    bytes: imageBytes.byteLength,
    width: 160,
    height: 90,
    name: 'recovery-fixture.png',
    dataBase64: imageBytes.toString('base64'),
  }
  await mkdir(join(sourceHome, 'attachments', 'v1', 'objects', attachmentHash.slice(0, 2)), { recursive: true, mode: 0o700 })
  await writeFile(join(sourceHome, 'attachments', 'v1', 'objects', attachmentHash.slice(0, 2), attachmentHash), imageBytes)

  const sessionId = 'recovery-session'
  const workspaceId = 'recovery-workspace'
  const createdAt = new Date(Date.now() - 60_000).toISOString()
  const createdAtMs = Date.parse(createdAt)
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: sessionId as SessionHeader['id'],
    createdAt: createdAtMs,
    cwd: sourceWorkspace,
    delegationDepth: 0,
  }
  const events = [
    { type: 'turn/start', seq: 0, time: createdAtMs + 1, data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user', rpcId: 'recovery-fixture' } } } },
    {
      type: 'user/message', seq: 1, time: createdAtMs + 2,
      data: {
        content: [
          { type: 'text', text: 'recovery fixture message' },
          { type: 'image', attachment },
        ],
        source: { kind: 'user', rpcId: 'recovery-fixture' },
      },
      surfaceOp: 'append',
    },
    { type: 'session/title', seq: 2, time: createdAtMs + 3, data: { title: 'Recovery fixture session', messageSeqs: [1], source: { kind: 'fallback' } } },
    {
      type: 'assistant/message', seq: 3, time: createdAtMs + 4,
      data: { content: [{ type: 'text', text: 'RECOVERY_SESSION_OK' }], provenance: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
      surfaceOp: 'append',
    },
    { type: 'turn/end', seq: 4, time: createdAtMs + 5, data: { turn: 1, reason: { kind: 'completed' } } },
  ] as unknown as SessionEvent[]
  const artifact = logPath(join(sourceHome, 'sessions'), sourceWorkspace, sessionId as SessionHeader['id'], 'none')
  await mkdir(dirname(artifact), { recursive: true, mode: 0o700 })
  await writeFile(artifact, `${JSON.stringify(toHeaderLine(header))}\n${eventLines(events, false)}\n`, 'utf8')

  const expected: RecoveryExpectedState = {
    workspaceTitle: 'Recovery fixture workspace',
    workspaceTags: ['recovery', 'copied'],
    sessionTags: ['attachment', 'restored'],
    archived: true,
    favorite: true,
  }
  await writeFile(join(sourceHome, 'storages', 'workspace.json'), `${JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: {
      initialized: true,
      workspaceIds: [workspaceId],
      archivedSessionIds: [sessionId],
      favoriteSessionIds: [sessionId],
      workspaceTagsById: { [workspaceId]: expected.workspaceTags },
      sessionTagsById: { [sessionId]: expected.sessionTags },
    },
    tables: {
      workspaces: {
        [workspaceId]: {
          path: sourceWorkspace,
          title: expected.workspaceTitle,
          sessionIds: [sessionId],
          createdAt,
          updatedAt: createdAt,
        },
      },
    },
  }, null, 2)}\n`, 'utf8')
  return { sourceHome, sourceWorkspace, sessionId, workspaceId, expected, attachment }
}

/** Copy only the selected recoverable records into test-owned paths and rebase all stored cwd values. */
export async function copyRecoveryDataset(dataset: RecoveryDataset, targetRoot: string): Promise<RecoveryCopy> {
  const world = resolve(targetRoot)
  const home = join(world, 'copy-home')
  const workspace = join(world, 'copy-workspace')
  const agentsHome = join(world, 'agents-home')
  const bundledSkillDir = join(world, 'bundled-skills')
  const patchPath = join(world, 'session-persistence.cordis.patch.yml')
  assertDisjoint(dataset.sourceHome, home, 'source home/copy home')
  assertDisjoint(dataset.sourceWorkspace, workspace, 'source Workspace/copy Workspace')
  await mkdir(world, { recursive: true, mode: 0o700 })
  await copyTree(dataset.sourceWorkspace, workspace)
  await mkdir(agentsHome, { recursive: true, mode: 0o700 })
  await mkdir(bundledSkillDir, { recursive: true, mode: 0o700 })

  const sourceSessionDirectory = join(projectDir(join(dataset.sourceHome, 'sessions'), dataset.sourceWorkspace), encodeSegment(dataset.sessionId))
  const targetSessionDirectory = join(projectDir(join(home, 'sessions'), workspace), encodeSegment(dataset.sessionId))
  await copyTree(sourceSessionDirectory, targetSessionDirectory)
  const sourceObject = join(dataset.sourceHome, 'attachments', 'v1', 'objects', dataset.attachment.attachmentId.slice('sha256:'.length, 'sha256:'.length + 2), dataset.attachment.attachmentId.slice('sha256:'.length))
  const targetObject = join(home, 'attachments', 'v1', 'objects', dataset.attachment.attachmentId.slice('sha256:'.length, 'sha256:'.length + 2), dataset.attachment.attachmentId.slice('sha256:'.length))
  await mkdir(dirname(targetObject), { recursive: true, mode: 0o700 })
  await copyFile(await requireRegularFile(sourceObject, 'source attachment object'), targetObject)

  const now = new Date().toISOString()
  await mkdir(join(home, 'storages'), { recursive: true, mode: 0o700 })
  await writeFile(join(home, 'storages', 'workspace.json'), `${JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: {
      initialized: true,
      workspaceIds: [dataset.workspaceId],
      archivedSessionIds: dataset.expected.archived ? [dataset.sessionId] : [],
      favoriteSessionIds: dataset.expected.favorite ? [dataset.sessionId] : [],
      workspaceTagsById: { [dataset.workspaceId]: dataset.expected.workspaceTags },
      sessionTagsById: { [dataset.sessionId]: dataset.expected.sessionTags },
    },
    tables: {
      workspaces: {
        [dataset.workspaceId]: {
          path: workspace,
          title: dataset.expected.workspaceTitle,
          sessionIds: [dataset.sessionId],
          createdAt: now,
          updatedAt: now,
        },
      },
    },
  }, null, 2)}\n`, 'utf8')

  const targetPlain = join(targetSessionDirectory, 'session.jsonl')
  const targetCompressed = join(targetSessionDirectory, 'session.jsonl.zstd')
  let sourceArtifact: string | undefined
  for (const candidate of [targetPlain, targetCompressed]) {
    try {
      sourceArtifact = await requireRegularFile(candidate, 'copied Session artifact')
      break
    } catch (error: unknown) {
      if (errorCode(error) !== 'ENOENT') throw error
    }
  }
  if (sourceArtifact === undefined) throw new Error('copied Session artifact disappeared before rebasing')
  const rebased = rebaseSessionJsonlForRecovery(
    await decodeSessionArtifact(sourceArtifact),
    dataset.sourceWorkspace,
    workspace,
  )
  await writeFile(targetPlain, rebased, 'utf8')
  if (sourceArtifact === targetCompressed) await rm(targetCompressed, { force: true })
  await writeFile(patchPath, [
    '- id: session-persistence-jsonl',
    '  config:',
    "    root: !!js dshHomePath('sessions')",
    '    compression: none',
    '',
  ].join('\n'), 'utf8')
  return { home, workspace, agentsHome, bundledSkillDir, patchPath }
}

/** Classify a symlink error; only a Windows capability probe may become an environment limitation. */
export function classifySymlinkError(
  error: unknown,
  operation: 'probe' | 'product-copy',
  platform = process.platform,
): 'environment-limitation' | 'product-failure' {
  const code = errorCode(error)
  return platform === 'win32' && operation === 'probe' && (code === 'EPERM' || code === 'EACCES')
    ? 'environment-limitation'
    : 'product-failure'
}

/** Probe Windows symlink capability in a test-owned directory and never downgrade a product-copy error. */
export async function probeSymlinkSupport(root: string): Promise<SymlinkProbeResult> {
  await mkdir(root, { recursive: true, mode: 0o700 })
  const target = join(root, 'target.txt')
  const link = join(root, 'link.txt')
  await writeFile(target, 'symlink probe\n', 'utf8')
  try {
    await symlink(target, link, process.platform === 'win32' ? 'file' : undefined)
    return { status: 'supported' }
  } catch (error: unknown) {
    if (classifySymlinkError(error, 'probe') === 'environment-limitation') {
      const code = errorCode(error) as 'EPERM' | 'EACCES'
      return { status: 'environment-limitation', code, message: errorMessage(error) }
    }
    throw new Error(`test-owned symlink capability probe failed as a product/test error: ${errorMessage(error)}`, { cause: error })
  } finally {
    await unlink(link).catch((error: unknown) => { if (errorCode(error) !== 'ENOENT') throw error })
    await unlink(target).catch((error: unknown) => { if (errorCode(error) !== 'ENOENT') throw error })
  }
}

/** Fail closed when the validation command would otherwise run stale or missing artifacts. */
export function assertBuiltWebArtifacts(): void {
  if (!existsSync(BUILT_DSH_BIN) || !existsSync(WEB_DIST_INDEX)) {
    throw new Error('product Web recovery requires built artifacts; run `pnpm run build:official` first')
  }
}

/** Reserve one loopback port for a single test-owned Web child. */
export function reserveRecoveryPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    const onError = (error: Error): void => { server.close(); reject(error) }
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close(() => { reject(new Error('recovery port probe returned no address')) })
        return
      }
      server.close((error) => { if (error !== undefined) reject(error); else resolvePort(address.port) })
    })
  })
}

function requestWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, REQUEST_TIMEOUT_MS)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => { clearTimeout(timer) })
}

/** Call one Web RPC over the external HTTP boundary. */
export async function webRpc<T>(baseUrl: string, method: string, payload: unknown): Promise<T> {
  const response = await requestWithTimeout(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `recovery-${method}`, method, payload }),
  })
  const bodyText = await response.text()
  if (!response.ok) throw new Error(`${method} returned HTTP ${String(response.status)}: ${bodyText}`)
  let body: unknown
  try {
    body = JSON.parse(bodyText) as unknown
  } catch (error: unknown) {
    throw new Error(`${method} returned non-JSON HTTP data: ${errorMessage(error)}`)
  }
  if (!isRecord(body) || !isRecord(body.result)) throw new Error(`${method} returned an invalid RPC envelope`)
  if (body.result.ok !== true) {
    const error = isRecord(body.result.error) ? body.result.error : {}
    const code = typeof error.code === 'string' ? error.code : 'unknown'
    const message = typeof error.message === 'string' ? error.message : 'unknown error'
    throw new Error(`${method} failed: ${code}: ${message}`)
  }
  return body.result.value as T
}

async function sanitizedChildEnvironment(copy: RecoveryCopy, world: string): Promise<NodeJS.ProcessEnv> {
  const environment: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (key.startsWith('DSH_') || key.startsWith('DEEPSEEK_') || SOURCE_HOME_DENY.test(key)
      || key === 'NODE_OPTIONS' || key === 'TSX_TSCONFIG_PATH') continue
    environment[key] = value
  }
  const isolatedHome = join(world, 'process-home')
  const isolatedTemp = join(world, 'process-temp')
  const isolatedPaths = [isolatedHome, isolatedTemp, join(world, 'process-appdata'), join(world, 'process-localappdata')]
  await Promise.all(isolatedPaths.map(path => mkdir(path, { recursive: true, mode: 0o700 })))
  environment.DSH_HOME = copy.home
  environment.DSH_AGENTS_HOME = copy.agentsHome
  environment.DSH_BUNDLED_SKILL_DIR = copy.bundledSkillDir
  environment.DSH_TELEMETRY_DISABLED = '1'
  environment.DEEPSEEK_API_KEY = 'recovery-gate-no-network'
  environment.HOME = isolatedHome
  environment.TMPDIR = isolatedTemp
  environment.TEMP = isolatedTemp
  environment.TMP = isolatedTemp
  if (process.platform === 'win32') {
    environment.USERPROFILE = isolatedHome
    environment.APPDATA = join(world, 'process-appdata')
    environment.LOCALAPPDATA = join(world, 'process-localappdata')
  }
  return environment
}

class OutputCollector {
  private textValue = ''

  add(chunk: Buffer | string): void {
    this.textValue += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
  }

  get text(): string {
    return this.textValue
  }
}

function tail(value: string): string {
  return value.length > 20_000 ? value.slice(-20_000) : value
}

function childExit(child: ChildProcess): ChildExit {
  return { code: child.exitCode, signal: child.signalCode }
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<ChildExit | undefined> {
  if (child.exitCode !== null || child.signalCode !== null) return childExit(child)
  return await new Promise<ChildExit | undefined>((resolveExit) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.off('close', onClose)
      resolveExit(undefined)
    }, timeoutMs)
    const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveExit({ code, signal })
    }
    child.once('close', onClose)
  })
}

async function processPairs(): Promise<Map<number, number>> {
  if (process.platform === 'win32') {
    const result = await execFile('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)" }',
    ], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 })
    return new Map(result.stdout.split(/\r?\n/u).flatMap((line) => {
      const [pid, parent] = line.trim().split('|')
      const childPid = Number(pid)
      const parentPid = Number(parent)
      return Number.isInteger(childPid) && Number.isInteger(parentPid) ? [[childPid, parentPid] as const] : []
    }))
  }
  const result = await execFile('ps', ['-eo', 'pid=,ppid='], { maxBuffer: 2 * 1024 * 1024 })
  return new Map(result.stdout.split(/\r?\n/u).flatMap((line) => {
    const [pid, parent] = line.trim().split(/\s+/u)
    const childPid = Number(pid)
    const parentPid = Number(parent)
    return Number.isInteger(childPid) && Number.isInteger(parentPid) ? [[childPid, parentPid] as const] : []
  }))
}

async function descendantPids(rootPid: number): Promise<number[]> {
  const parents = await processPairs()
  const descendants: number[] = []
  const queue = [rootPid]
  const seen = new Set(queue)
  while (queue.length > 0) {
    const parent = requireValue(queue.shift(), `process tree queue lost root ${String(rootPid)}`)
    for (const [pid, parentPid] of parents) {
      if (parentPid !== parent || seen.has(pid)) continue
      seen.add(pid)
      descendants.push(pid)
      queue.push(pid)
    }
  }
  return descendants
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return errorCode(error) === 'EPERM'
  }
}

async function terminateKnownTree(child: ChildProcess, pid: number, knownDescendants: readonly number[]): Promise<void> {
  if (process.platform === 'win32') {
    try {
      await execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, maxBuffer: 512 * 1024 })
    } catch {
      // The root may have exited between the graceful wait and taskkill. Each
      // still-live descendant is handled explicitly below and then verified.
    }
    for (const descendant of knownDescendants) {
      if (!pidAlive(descendant)) continue
      try {
        await execFile('taskkill.exe', ['/PID', String(descendant), '/T', '/F'], { windowsHide: true, maxBuffer: 512 * 1024 })
      } catch {
        // Verification below turns a remaining process into a product failure.
      }
    }
  } else {
    for (const descendant of [...knownDescendants].reverse()) {
      if (pidAlive(descendant)) process.kill(descendant, 'SIGTERM')
    }
    if (pidAlive(pid)) process.kill(pid, 'SIGKILL')
    await new Promise(resolve => setTimeout(resolve, 250))
    for (const descendant of [...knownDescendants].reverse()) {
      if (pidAlive(descendant)) process.kill(descendant, 'SIGKILL')
    }
  }
  await waitForChildExit(child, FORCE_STOP_TIMEOUT_MS)
}

async function waitForPortReleased(port: number): Promise<boolean> {
  const deadline = Date.now() + PORT_RELEASE_TIMEOUT_MS
  while (Date.now() < deadline) {
    const closed = await new Promise<boolean>((resolveClosed) => {
      const socket = createConnection({ host: '127.0.0.1', port })
      let settled = false
      const finish = (closedNow: boolean): void => {
        if (settled) return
        settled = true
        socket.destroy()
        resolveClosed(closedNow)
      }
      socket.once('connect', () => { finish(false) })
      socket.once('error', (error: NodeJS.ErrnoException) => {
        finish(error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET' || error.code === 'ENOTFOUND')
      })
    })
    if (closed) return true
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return false
}

async function stopWebProcess(
  child: ChildProcess,
  pid: number,
  port: number,
  collector: OutputCollector,
): Promise<ProcessStopEvidence> {
  const knownDescendants = await descendantPids(pid)
  let timedOut = false
  let forced = false
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  let exit = await waitForChildExit(child, GRACEFUL_STOP_TIMEOUT_MS)
  if (exit === undefined || knownDescendants.some(pidAlive)) {
    forced = true
    timedOut = exit === undefined
    await terminateKnownTree(child, pid, knownDescendants)
    exit = await waitForChildExit(child, FORCE_STOP_TIMEOUT_MS)
  }
  if (exit === undefined) throw new Error(`Web process ${String(pid)} did not stop; output:\n${tail(collector.text)}`)
  const portReleased = await waitForPortReleased(port)
  const remaining = await descendantPids(pid)
  const knownLive = knownDescendants.filter(pidAlive)
  const treeQuiescent = remaining.length === 0 && knownLive.length === 0 && !pidAlive(pid)
  if (!portReleased) throw new Error(`Web process ${String(pid)} stopped but port ${String(port)} remained bound`)
  if (!treeQuiescent) throw new Error(`Web process tree ${String(pid)} was not quiescent: ${[...remaining, ...knownLive].join(', ')}`)
  return {
    pid,
    timedOut,
    signal: exit.signal,
    exitCode: exit.code,
    forced,
    portReleased,
    treeQuiescent,
  }
}

async function waitForReady(
  child: ChildProcess,
  collector: OutputCollector,
  expectedPort: number,
  timeoutMs: number,
): Promise<WebReadyBoundary> {
  const deadline = Date.now() + timeoutMs
  let url: string | undefined
  let rootStatus: number | undefined
  let host: Record<string, unknown> | undefined
  while (Date.now() < deadline) {
    const match = /dsh web:\s+(http:\/\/127\.0\.0\.1:(\d+))/u.exec(collector.text)
    if (match?.[1] !== undefined && Number(match[2]) === expectedPort) url = match[1]
    if (url !== undefined) {
      try {
        const root = await requestWithTimeout(url)
        if (root.ok) {
          rootStatus = root.status
          host = await webRpc<Record<string, unknown>>(url, 'host.describe', {})
          return { url, rootStatus, host }
        }
      } catch {
        // The URL line is the post-Loader signal; this short external poll
        // allows the HTTP route to finish accepting requests on a slow host.
      }
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`dsh web exited before ready (code ${String(child.exitCode)}, signal ${String(child.signalCode)}); output:\n${tail(collector.text)}`)
    }
    await new Promise(resolve => setTimeout(resolve, READY_POLL_MS))
  }
  throw new Error(`dsh web did not reach URL + GET + host.describe ready boundary in ${String(timeoutMs)}ms; output:\n${tail(collector.text)}`)
}

/** Start the built dsh Web/Host process with an isolated environment and explicit ready boundary. */
export async function startRecoveryWebProcess(
  copy: RecoveryCopy,
  worldRoot: string,
  timeoutMs = DEFAULT_READY_TIMEOUT_MS,
): Promise<ManagedWebProcess> {
  assertBuiltWebArtifacts()
  const port = await reserveRecoveryPort()
  const collector = new OutputCollector()
  const child = spawn(process.execPath, [
    BUILT_DSH_BIN,
    'web',
    '--patch', copy.patchPath,
    '--no-open',
    '--port', String(port),
  ], {
    cwd: copy.workspace,
    env: await sanitizedChildEnvironment(copy, worldRoot),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout.on('data', (chunk: Buffer | string) => { collector.add(chunk) })
  child.stderr.on('data', (chunk: Buffer | string) => { collector.add(chunk) })
  child.on('error', (error) => { collector.add(`\n[child error] ${errorMessage(error)}\n`) })
  const pid = child.pid
  if (pid === undefined) throw new Error('dsh web child did not expose a pid')
  let stopPromise: Promise<ProcessStopEvidence> | undefined
  const stop = (): Promise<ProcessStopEvidence> => {
    stopPromise ??= stopWebProcess(child, pid, port, collector)
    return stopPromise
  }
  try {
    const ready = await waitForReady(child, collector, port, timeoutMs)
    return { pid, port, baseUrl: ready.url, ready, output: () => collector.text, stop }
  } catch (error: unknown) {
    await stop().catch((stopError: unknown) => {
      throw new AggregateError([error, stopError], 'dsh web failed during startup and teardown')
    })
    throw error
  }
}

function equalStringArray(left: unknown, right: readonly string[]): boolean {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index])
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message)
  return value
}

async function assertRecoveredState(baseUrl: string, copy: RecoveryCopy, dataset: RecoveryDataset): Promise<void> {
  const workspaceList = await webRpc<{
    items: Array<{ workspaceId: string; path: string; title: string; sessionIds: string[] }>
    archivedSessionIds: string[]
    favoriteSessionIds: string[]
    workspaceTagsById: Record<string, string[]>
    sessionTagsById: Record<string, string[]>
  }>(baseUrl, 'workspace.list', {})
  const workspace = workspaceList.items.find(item => item.workspaceId === dataset.workspaceId)
  assertCondition(workspace !== undefined, `recovered Workspace ${dataset.workspaceId} was not listed`)
  assertCondition(pathsEquivalent(workspace.path, copy.workspace), `recovered Workspace path was not rebased: ${workspace.path}`)
  assertCondition(workspace.title === dataset.expected.workspaceTitle, 'recovered Workspace title changed')
  assertCondition(workspace.sessionIds.includes(dataset.sessionId), 'recovered Session is not attached to its Workspace')
  assertCondition(dataset.expected.archived === workspaceList.archivedSessionIds.includes(dataset.sessionId), 'archive state did not survive recovery')
  assertCondition(dataset.expected.favorite === workspaceList.favoriteSessionIds.includes(dataset.sessionId), 'favorite state did not survive recovery')
  assertCondition(equalStringArray(workspaceList.workspaceTagsById[dataset.workspaceId], dataset.expected.workspaceTags), 'Workspace tags did not survive recovery')
  assertCondition(equalStringArray(workspaceList.sessionTagsById[dataset.sessionId], dataset.expected.sessionTags), 'Session tags did not survive recovery')

  const sessionList = await webRpc<{ items: Array<{ sessionId: string; cwd?: string; blank: boolean }> }>(baseUrl, 'session.list', {})
  const session = sessionList.items.find(item => item.sessionId === dataset.sessionId)
  assertCondition(session !== undefined, `recovered Session ${dataset.sessionId} was not listed`)
  assertCondition(session.cwd !== undefined && pathsEquivalent(session.cwd, copy.workspace), `recovered Session cwd was not rebased: ${session.cwd ?? '<missing>'}`)
  assertCondition(!session.blank, 'recovered Session was incorrectly classified as blank')

  const history = await webRpc<{ events: Array<{ event: unknown }>; hasMore: boolean }>(baseUrl, 'session.history', {
    sessionId: dataset.sessionId,
    maxMessages: 100,
  })
  assertCondition(!history.hasMore, 'recovery history unexpectedly exceeded the bounded fixture page')
  const recoveredReference = firstImageReference(history.events)
  assertCondition(recoveredReference?.attachmentId === dataset.attachment.attachmentId, 'recovered history lost its attachment reference')
  const attachment = await webRpc<{ attachment: ImageReferenceShape; data: string }>(baseUrl, 'session.attachment', {
    sessionId: dataset.sessionId,
    attachmentId: dataset.attachment.attachmentId,
  })
  assertCondition(attachment.attachment.attachmentId === dataset.attachment.attachmentId, 'recovered attachment id changed')
  assertCondition(attachment.attachment.mediaType === dataset.attachment.mediaType, 'recovered attachment media type changed')
  assertCondition(attachment.attachment.bytes === dataset.attachment.bytes, 'recovered attachment size changed')
  assertCondition(attachment.attachment.width === dataset.attachment.width && attachment.attachment.height === dataset.attachment.height, 'recovered attachment dimensions changed')
  assertCondition(attachment.data === dataset.attachment.dataBase64, 'recovered attachment bytes changed')

  const described = await webRpc<Record<string, unknown>>(baseUrl, 'host.describe', {})
  const processHome = join(dirname(copy.home), 'process-home')
  assertCondition(typeof described.home === 'string' && pathsEquivalent(described.home, processHome), `Host OS home was not test-owned: ${String(described.home)} (expected ${processHome})`)
  assertCondition(typeof described.cwd === 'string' && pathsEquivalent(described.cwd, copy.workspace), `Host cwd was not test-owned: ${String(described.cwd)} (expected ${copy.workspace})`)
}

async function createOwnedWorld(): Promise<string> {
  await mkdir(ARTIFACT_ROOT, { recursive: true, mode: 0o700 })
  return await mkdtemp(join(ARTIFACT_ROOT, 'dsh-web-recovery-'))
}

/** Run Web smoke, cold Session/Workspace recovery in a fresh process, source checksum proof, and cleanup proof. */
export async function runRecoveryGate(options: RecoveryGateOptions = {}): Promise<RecoveryGateReport> {
  assertBuiltWebArtifacts()
  const world = await createOwnedWorld()
  let dataset = options.dataset
  let sourceBefore: RecoverySourceSnapshot | undefined
  let sourceAfter: RecoverySourceSnapshot | undefined
  let first: ManagedWebProcess | undefined
  let second: ManagedWebProcess | undefined
  let report: RecoveryGateReport | undefined
  let mainError: unknown
  const cleanupErrors: unknown[] = []
  try {
    if (dataset === undefined) dataset = await createRecoveryFixture(join(world, 'fixture'))
    else {
      // An externally supplied source may be a real user home, so the private
      // child world must never be inside it (or vice versa). The source itself
      // is only read by snapshot/copy helpers and is never passed to spawn.
      assertDisjoint(dataset.sourceHome, world, 'external source home/private world')
      assertDisjoint(dataset.sourceWorkspace, world, 'external source Workspace/private world')
    }
    sourceBefore = await snapshotRecoverySource(dataset)
    const probeRoot = join(world, 'symlink-probe')
    const symlink = await probeSymlinkSupport(probeRoot)
    await removeOwnedDirectory(probeRoot, world)
    const copy = await copyRecoveryDataset(dataset, world)

    first = await startRecoveryWebProcess(copy, world, options.timeoutMs)
    const firstRecord = { pid: first.pid, port: first.port, ready: first.ready, stop: undefined as ProcessStopEvidence | undefined }
    await assertRecoveredState(first.baseUrl, copy, dataset)
    if (options.browserSmoke !== undefined) await options.browserSmoke(first.baseUrl)
    firstRecord.stop = await first.stop()
    first = undefined

    second = await startRecoveryWebProcess(copy, world, options.timeoutMs)
    const secondRecord = { pid: second.pid, port: second.port, ready: second.ready, stop: undefined as ProcessStopEvidence | undefined }
    assertCondition(second.pid !== firstRecord.pid, 'recovery did not cross a fresh process boundary')
    await assertRecoveredState(second.baseUrl, copy, dataset)
    secondRecord.stop = await second.stop()
    second = undefined

    sourceAfter = await snapshotRecoverySource(dataset)
    assertRecoverySourceUnchanged(sourceBefore, sourceAfter)
    const firstStop = requireValue(firstRecord.stop, 'first Web process stop evidence was not recorded')
    const secondStop = requireValue(secondRecord.stop, 'second Web process stop evidence was not recorded')
    report = {
      sourceBefore,
      sourceAfter,
      symlink,
      firstProcess: { ...firstRecord, stop: firstStop },
      secondProcess: { ...secondRecord, stop: secondStop },
      sourceUnchanged: true,
      tempRoot: world,
      tempRootCleaned: true,
    }
  } catch (error: unknown) {
    mainError = error
  }

  if (second !== undefined) {
    try { await second.stop() } catch (error: unknown) { cleanupErrors.push(error) }
    second = undefined
  }
  if (first !== undefined) {
    try { await first.stop() } catch (error: unknown) { cleanupErrors.push(error) }
    first = undefined
  }
  try {
    await removeOwnedDirectory(world, ARTIFACT_ROOT)
  } catch (error: unknown) {
    cleanupErrors.push(error)
  }

  if (mainError !== undefined && cleanupErrors.length > 0) {
    throw new AggregateError([mainError, ...cleanupErrors], 'Web recovery gate and cleanup both failed')
  }
  if (mainError !== undefined) throw mainError instanceof Error ? mainError : new Error(errorMessage(mainError))
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'Web recovery gate cleanup failed')
  if (report === undefined || sourceAfter === undefined || sourceBefore === undefined) {
    throw new Error('Web recovery gate completed without a report')
  }
  return report
}

/** Format a compact CLI-facing report without retaining child output or source bytes. */
export function compactRecoveryReport(report: RecoveryGateReport): Record<string, unknown> {
  return {
    sourceUnchanged: report.sourceUnchanged,
    sourceDigest: report.sourceBefore.digest,
    sourceFiles: report.sourceBefore.home.files.length + report.sourceBefore.workspace.files.length,
    symlink: report.symlink,
    firstProcess: {
      pid: report.firstProcess.pid,
      port: report.firstProcess.port,
      readyUrl: report.firstProcess.ready.url,
      stop: report.firstProcess.stop,
    },
    secondProcess: {
      pid: report.secondProcess.pid,
      port: report.secondProcess.port,
      readyUrl: report.secondProcess.ready.url,
      stop: report.secondProcess.stop,
    },
    tempRoot: report.tempRoot,
    tempRootCleaned: report.tempRootCleaned,
  }
}
