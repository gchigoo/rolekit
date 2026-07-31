import type { Capability } from '../../core/types.ts'
import { CAPABILITIES } from '../../core/types.ts'

export interface CliAdapterOptions {
  readonly command?: string
  readonly commandArgs?: readonly string[]
  readonly model?: string
  readonly provider?: string
  readonly timeoutMs?: number
  readonly environment?: Readonly<Record<string, string>>
  readonly extraArgs?: readonly string[]
  readonly capabilities?: readonly Capability[]
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const candidate = value[key]
  if (candidate === undefined) {
    return undefined
  }
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    throw new TypeError(`Adapter option "${key}" must be a non-empty string.`)
  }
  return candidate
}

function optionalStringArray(
  value: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] | undefined {
  const candidate = value[key]
  if (candidate === undefined) {
    return undefined
  }
  if (
    !Array.isArray(candidate) ||
    candidate.some((entry) => typeof entry !== 'string' || entry.length === 0)
  ) {
    throw new TypeError(`Adapter option "${key}" must be an array of non-empty strings.`)
  }
  return candidate
}

export function parseCliAdapterOptions(value: unknown): CliAdapterOptions {
  if (value === undefined || value === null) {
    return {}
  }
  if (!isRecord(value)) {
    throw new TypeError('Adapter options must be an object.')
  }

  const supportedKeys = new Set([
    'command',
    'commandArgs',
    'model',
    'provider',
    'timeoutMs',
    'environment',
    'extraArgs',
    'capabilities',
  ])
  const unsupportedKeys = Object.keys(value).filter((key) => !supportedKeys.has(key))
  if (unsupportedKeys.length > 0) {
    throw new TypeError(`Unsupported adapter options: ${unsupportedKeys.sort().join(', ')}.`)
  }

  const timeoutCandidate = value.timeoutMs
  if (
    timeoutCandidate !== undefined &&
    (typeof timeoutCandidate !== 'number' ||
      !Number.isSafeInteger(timeoutCandidate) ||
      timeoutCandidate <= 0)
  ) {
    throw new TypeError('Adapter option "timeoutMs" must be a positive safe integer.')
  }

  const environmentCandidate = value.environment
  if (
    environmentCandidate !== undefined &&
    (!isRecord(environmentCandidate) ||
      Object.values(environmentCandidate).some((entry) => typeof entry !== 'string'))
  ) {
    throw new TypeError('Adapter option "environment" must map names to strings.')
  }

  const capabilitiesCandidate = value.capabilities
  if (
    capabilitiesCandidate !== undefined &&
    (!Array.isArray(capabilitiesCandidate) ||
      capabilitiesCandidate.some(
        (entry) => typeof entry !== 'string' || !CAPABILITIES.includes(entry as Capability),
      ) ||
      new Set(capabilitiesCandidate).size !== capabilitiesCandidate.length)
  ) {
    throw new TypeError('Adapter option "capabilities" contains an invalid or duplicate value.')
  }

  const command = optionalString(value, 'command')
  const commandArgs = optionalStringArray(value, 'commandArgs')
  const model = optionalString(value, 'model')
  const provider = optionalString(value, 'provider')
  const extraArgs = optionalStringArray(value, 'extraArgs')

  return {
    ...(command === undefined ? {} : { command }),
    ...(commandArgs === undefined ? {} : { commandArgs }),
    ...(model === undefined ? {} : { model }),
    ...(provider === undefined ? {} : { provider }),
    ...(timeoutCandidate === undefined ? {} : { timeoutMs: timeoutCandidate }),
    ...(environmentCandidate === undefined
      ? {}
      : { environment: environmentCandidate as Readonly<Record<string, string>> }),
    ...(extraArgs === undefined ? {} : { extraArgs }),
    ...(capabilitiesCandidate === undefined
      ? {}
      : { capabilities: capabilitiesCandidate as readonly Capability[] }),
  }
}
