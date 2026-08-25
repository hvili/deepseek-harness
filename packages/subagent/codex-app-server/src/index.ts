/**
 * Version-locked Codex app-server integration primitives. This package owns
 * package-local executable resolution, the stable schema command, the required
 * initialization handshake, and child-process quiescence. Product adapters own
 * thread, turn, approval, and presentation policy.
 *
 * @module @deepseek-ai/dsh-codex-app-server
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'

interface CodexPackageManifest {
  readonly version: string
  readonly bin: {
    readonly codex: string
  }
}

const codexPackageJsonPath = createRequire(import.meta.url).resolve('@openai/codex/package.json')
const codexPackageManifest = JSON.parse(
  readFileSync(codexPackageJsonPath, 'utf8'),
) as CodexPackageManifest

const CODEX_PACKAGE_BIN = resolve(
  dirname(codexPackageJsonPath),
  codexPackageManifest.bin.codex,
)

/** Exact official Codex package version that defines this client's protocol. */
export const CODEX_RUNTIME_VERSION = codexPackageManifest.version

/** Generated schema output supported by the official app-server command. */
export type CodexSchemaFormat = 'typescript' | 'json-schema'

/** Metadata sent in the required app-server initialization request. */
export interface CodexClientInfo {
  /** Stable compliance-log client identifier. */
  readonly name: string
  /** Human-readable integration name. */
  readonly title: string
  /** Integration version, independent of the Codex runtime version. */
  readonly version: string
}

/** Stable initialization capabilities used without experimental API opt-in. */
export interface CodexInitializeCapabilities {
  readonly experimentalApi?: false
  readonly requestAttestation?: boolean
  readonly optOutNotificationMethods?: readonly string[]
}

/**
 * Fixed package-local app-server command, independent of the host `PATH`.
 * @returns the executable and arguments for the package-local app-server.
 */
export function codexAppServerArgv(): string[] {
  return [process.execPath, CODEX_PACKAGE_BIN, 'app-server', '--stdio']
}

/**
 * Build the package-local stable schema-generation command.
 * @param format - TypeScript files or the JSON Schema bundle.
 * @param outDir - caller-owned output directory.
 * @param experimental - include unstable methods and fields only when explicitly requested.
 * @returns the complete argv for the current pinned runtime.
 */
export function codexAppServerSchemaArgv(
  format: CodexSchemaFormat,
  outDir: string,
  experimental = false,
): string[] {
  if (outDir === '') throw new Error('codex-app-server: schema output directory must not be empty')
  return [
    process.execPath,
    CODEX_PACKAGE_BIN,
    'app-server',
    format === 'typescript' ? 'generate-ts' : 'generate-json-schema',
    '--out',
    outDir,
    ...(experimental ? ['--experimental'] : []),
  ]
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`codex-app-server: invalid ${label}`)
  }
  return value as Record<string, unknown>
}

/**
 * One initialized app-server JSON-RPC connection over caller-owned streams.
 * The client deliberately exposes raw method names and object payloads because
 * generated schemas belong to the pinned runtime and product adapters select
 * which stable methods they support.
 */
export class CodexAppServerClient {
  private readonly transport: JsonRpcLineTransport
  private initialized = false
  private closed = false

  constructor(input: Readable, output: Writable) {
    this.transport = new JsonRpcLineTransport(input, output)
  }

  /** Begin reading frames after handlers have been installed. Idempotent. */
  start(): void {
    this.transport.start()
  }

  /**
   * Replace the handler for app-server requests directed to the client.
   * @param handler - callback for a request method and object payload.
   */
  onRequest(handler: (method: string, params: Record<string, unknown>) => Promise<unknown>): void {
    this.transport.onRequest(handler)
  }

  /**
   * Replace the handler for app-server notifications.
   * @param handler - callback for a notification method and object payload.
   */
  onNotification(handler: (method: string, params: Record<string, unknown>) => void): void {
    this.transport.onNotification(handler)
  }

  /**
   * Perform the single required initialize/initialized handshake.
   * @param clientInfo - integration identity sent to Codex.
   * @param capabilities - stable connection capabilities; experimental opt-in is unavailable here.
   * @param signal - optional cancellation while awaiting the response or write barrier.
   * @returns the validated initialization response object.
   */
  async initialize(
    clientInfo: CodexClientInfo,
    capabilities: CodexInitializeCapabilities,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (this.closed) throw new Error('codex-app-server: connection is closed')
    if (this.initialized) throw new Error('codex-app-server: connection is already initialized')
    const response = object(await this.transport.request('initialize', {
      clientInfo,
      capabilities: {
        experimentalApi: false,
        ...capabilities,
      },
    }, signal), 'initialize response')
    this.transport.notify('initialized')
    await this.transport.flush()
    this.initialized = true
    return response
  }

  /**
   * Send a product-selected request after initialization.
   * @param method - protocol method selected by the product adapter.
   * @param params - object payload for the method.
   * @param signal - optional cancellation while awaiting the response or write barrier.
   * @returns the raw response returned by the app-server.
   */
  request(method: string, params: object, signal?: AbortSignal): Promise<unknown> {
    if (!this.initialized) return Promise.reject(new Error('codex-app-server: connection is not initialized'))
    return this.transport.request(method, params, signal)
  }

  /**
   * Send a product-selected notification after initialization.
   * @param method - protocol method selected by the product adapter.
   * @param params - optional object payload for the method.
   */
  notify(method: string, params?: object): void {
    if (!this.initialized) throw new Error('codex-app-server: connection is not initialized')
    this.transport.notify(method, params)
  }

  /** Detach protocol listeners and reject pending requests. Idempotent. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.transport.close()
  }
}

/**
 * End stdin, terminate the managed process tree, and wait for whole-tree exit.
 * @param child - shared subprocess handle that owns the app-server tree.
 */
export async function disposeCodexAppServerChild(child: SubprocessHandle): Promise<void> {
  if (child.pid <= 0) {
    await child.done.catch(() => {})
    return
  }
  try {
    child.stdin?.end()
  } catch {
    // A concurrently closed stdin does not change process-tree ownership.
  }
  child.terminate()
  await child.waitForExit()
  await child.done
}
