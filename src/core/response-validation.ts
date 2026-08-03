import { freezeJsonSnapshot } from './json.ts'
import { ExecutorResponseSchema } from './schemas.ts'
import type { ExecutorResponse, JsonSchema, TokenUsage } from './types.ts'
import { validateStrictValue } from './validation.ts'

export interface ExecutorResponseValidation<TOutput = unknown> {
  readonly valid: boolean
  readonly response?: ExecutorResponse<TOutput>
  readonly errors: readonly string[]
}

const tokenUsageKeys = ['inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens'] as const

const measuredUsageKeys = ['durationMs', 'costUsd'] as const

function duplicateValues(values: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value)
    }
    seen.add(value)
  }
  return [...duplicates]
}

function usageErrors(usage: TokenUsage | undefined): readonly string[] {
  if (usage === undefined) {
    return []
  }
  const errors: string[] = []
  for (const key of tokenUsageKeys) {
    const value = usage[key]
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      errors.push(`usage.${key} must be a non-negative integer`)
    }
  }
  for (const key of measuredUsageKeys) {
    const value = usage[key]
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      errors.push(`usage.${key} must be a finite non-negative number`)
    }
  }
  return errors
}

export function validateExecutorResponse<TOutput>(
  response: unknown,
  outputSchema: JsonSchema<TOutput>,
): ExecutorResponseValidation<TOutput> {
  let snapshot: Readonly<unknown>
  try {
    snapshot = freezeJsonSnapshot(response, 'Executor response')
  } catch {
    return {
      valid: false,
      errors: ['Executor response could not be inspected as portable JSON.'],
    }
  }

  const record =
    typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot)
      ? (snapshot as Readonly<Record<string, unknown>>)
      : undefined
  const status = record?.status
  const hasOutput = record === undefined ? false : Object.hasOwn(record, 'output')
  const hasError = record === undefined ? false : Object.hasOwn(record, 'error')
  const semanticValid =
    status === 'completed'
      ? hasOutput && !hasError
      : status === 'failed' || status === 'blocked' || status === 'cancelled'
        ? hasError && !hasOutput
        : true
  if (!semanticValid) {
    return {
      valid: false,
      errors: [
        'completed responses require output and no error; all other responses require error and no output',
      ],
    }
  }

  const structural = validateStrictValue(ExecutorResponseSchema as JsonSchema, snapshot)
  if (!structural.valid) {
    return { valid: false, errors: structural.errors }
  }

  const trusted = snapshot as ExecutorResponse<TOutput>

  const errors: string[] = []
  if (trusted.status === 'completed') {
    const outputValidation = validateStrictValue(outputSchema, trusted.output)
    if (!outputValidation.valid) {
      errors.push(
        ...outputValidation.errors.map(
          (error) => `output does not match the role schema: ${error}`,
        ),
      )
    }
  }

  const duplicateArtifacts = duplicateValues(trusted.artifacts.map((artifact) => artifact.name))
  if (duplicateArtifacts.length > 0) {
    errors.push(`Duplicate artifact names: ${duplicateArtifacts.join(', ')}`)
  }
  for (const artifact of trusted.artifacts) {
    if (typeof artifact.content === 'string' && artifact.content.trim().length === 0) {
      errors.push(`Artifact "${artifact.name}" content must not be empty`)
    }
  }
  errors.push(...usageErrors(trusted.usage))

  return {
    valid: errors.length === 0,
    response: trusted,
    errors,
  }
}
