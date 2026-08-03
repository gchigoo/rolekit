import type { ExecutorResponse, JsonObject, JsonValue, TokenUsage } from '../../core/types.ts'

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseJsonLines(text: string): readonly Readonly<Record<string, unknown>>[] {
  const records: Readonly<Record<string, unknown>>[] = []
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      continue
    }
    try {
      const value: unknown = JSON.parse(trimmed)
      if (isRecord(value)) {
        records.push(value)
      }
    } catch {
      // Streaming CLIs may include diagnostics. Only well-formed JSONL records
      // participate in protocol parsing.
    }
  }
  return records
}

export function parseExecutorPayload(text: string): ExecutorResponse {
  let candidate = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(candidate)
  if (fenced?.[1] !== undefined) {
    candidate = fenced[1].trim()
  }
  const parsed: unknown = JSON.parse(candidate)
  if (!isRecord(parsed)) {
    throw new Error('Executor final output must be a JSON object.')
  }
  return parsed as unknown as ExecutorResponse
}

export function withoutExecutorIdentity(response: ExecutorResponse): ExecutorResponse {
  const sanitized: Record<string, unknown> = { ...response }
  delete sanitized.provider
  delete sanitized.model
  delete sanitized.version
  return sanitized as unknown as ExecutorResponse
}

export function firstString(
  record: Readonly<Record<string, unknown>>,
  ...keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }
  return undefined
}

export function firstNumber(
  record: Readonly<Record<string, unknown>>,
  ...keys: readonly string[]
): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return value
    }
  }
  return undefined
}

export function readUsage(value: unknown): TokenUsage | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const cost = isRecord(value.cost)
    ? firstNumber(value.cost, 'total', 'totalUsd', 'usd')
    : undefined
  const inputTokens = firstNumber(value, 'inputTokens', 'input_tokens', 'input')
  const outputTokens = firstNumber(value, 'outputTokens', 'output_tokens', 'output')
  const totalTokens = firstNumber(value, 'totalTokens', 'total_tokens', 'total')
  const cachedInputTokens = firstNumber(
    value,
    'cachedInputTokens',
    'cached_input_tokens',
    'cacheRead',
  )
  const costUsd = firstNumber(value, 'costUsd', 'cost_usd') ?? cost

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    cachedInputTokens === undefined &&
    costUsd === undefined
  ) {
    return undefined
  }
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(costUsd === undefined ? {} : { costUsd }),
  }
}

export function textFromContent(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (!Array.isArray(value)) {
    return undefined
  }
  const parts: string[] = []
  for (const part of value) {
    if (typeof part === 'string') {
      parts.push(part)
    } else if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
      parts.push(part.text)
    }
  }
  return parts.length === 0 ? undefined : parts.join('')
}

export function toJsonObject(value: Readonly<Record<string, unknown>>): JsonObject {
  return value as unknown as JsonObject
}

export function toJsonValue(value: unknown): JsonValue {
  return value as JsonValue
}
