#!/usr/bin/env node
/**
 * Product validation entry for the non-destructive Web/Host copy-recovery
 * gate. The optional source arguments are read-only inputs; the launched
 * process always receives the filtered, rebased copy created by the support
 * module.
 * @module dsh/product-web-recovery
 */

import { resolve } from 'node:path'
import {
  compactRecoveryReport, inspectRecoveryDataset, runRecoveryGate,
} from './product-web-recovery-support.ts'

interface CliOptions {
  sourceHome?: string
  sourceWorkspace?: string
  timeoutMs?: number
}

function usage(): string {
  return [
    'Usage: pnpm run product:web-recovery [--source-home <path> --source-workspace <path>] [--timeout-ms <ms>]',
    '',
    'With no source arguments, the gate creates a test-owned fixture. When supplied,',
    'the source home and Workspace are read-only inputs and are never passed to dsh web.',
  ].join('\n')
}

function nextValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('-')) throw new Error(`${flag} needs a value\n\n${usage()}`)
  return value
}

function parseCli(argv: readonly string[]): CliOptions {
  const options: CliOptions = {}
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === undefined) throw new Error('CLI argument disappeared while parsing')
    if (argument === '--help' || argument === '-h') {
      console.log(usage())
      process.exit(0)
    }
    if (argument === '--source-home') {
      options.sourceHome = resolve(nextValue(argv, index, argument))
      index++
      continue
    }
    if (argument === '--source-workspace') {
      options.sourceWorkspace = resolve(nextValue(argv, index, argument))
      index++
      continue
    }
    if (argument === '--timeout-ms') {
      const value = nextValue(argv, index, argument)
      const timeoutMs = Number(value)
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error(`--timeout-ms must be a positive integer, got ${value}`)
      options.timeoutMs = timeoutMs
      index++
      continue
    }
    throw new Error(`unknown argument ${argument}\n\n${usage()}`)
  }
  if ((options.sourceHome === undefined) !== (options.sourceWorkspace === undefined)) {
    throw new Error('--source-home and --source-workspace must be supplied together')
  }
  return options
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2))
  const dataset = options.sourceHome === undefined || options.sourceWorkspace === undefined
    ? undefined
    : await inspectRecoveryDataset(options.sourceHome, options.sourceWorkspace)
  const report = await runRecoveryGate({
    ...(dataset === undefined ? {} : { dataset }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  })
  console.log(JSON.stringify(compactRecoveryReport(report), null, 2))
}

if (import.meta.main) {
  await main()
}
