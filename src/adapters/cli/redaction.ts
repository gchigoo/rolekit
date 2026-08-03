const REDACTED = '[REDACTED]'

const DEFAULT_SENSITIVE_FLAGS = [
  '--api-key',
  '--token',
  '--access-token',
  '--secret',
  '--password',
  '--client-secret',
  '--header',
] as const

/**
 * Values in this context are kept in memory only and must never be serialized.
 * RoleKit redacts known process credentials from its own command and diagnostic
 * surfaces. It cannot sanitize arbitrary model-authored output or files after
 * an executor has been granted access to a secret.
 */
export interface RedactionContext {
  readonly sensitiveFlags: readonly string[]
  readonly sensitiveValues: readonly string[]
}

interface ValueSpan {
  readonly contentStart: number
  readonly contentEnd: number
  readonly end: number
}

function normalizeFlag(flag: string): string | undefined {
  const trimmed = flag.trim()
  if (trimmed.length === 0) {
    return undefined
  }
  return (trimmed.startsWith('--') ? trimmed : `--${trimmed}`).toLowerCase()
}

function normalizedFlags(context?: RedactionContext): readonly string[] {
  const flags = new Set<string>(DEFAULT_SENSITIVE_FLAGS)
  for (const flag of context?.sensitiveFlags ?? []) {
    const normalized = normalizeFlag(flag)
    if (normalized !== undefined) {
      flags.add(normalized)
    }
  }
  return [...flags].sort((left, right) => right.length - left.length)
}

function normalizedValues(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort(
    (left, right) => right.length - left.length,
  )
}

function jsonEscapedValue(value: string): string {
  return JSON.stringify(value).slice(1, -1)
}

function sensitiveRepresentations(values: readonly string[]): readonly string[] {
  const representations = new Set<string>()
  for (const value of normalizedValues(values)) {
    let representation = value
    for (let depth = 0; depth < 8; depth += 1) {
      representations.add(representation)
      const escaped = jsonEscapedValue(representation)
      if (escaped === representation) {
        break
      }
      representation = escaped
    }
  }
  return normalizedValues([...representations])
}

function flagAssignment(
  argument: string,
): { readonly flag: string; readonly value: string } | undefined {
  const equalsIndex = argument.indexOf('=')
  if (equalsIndex <= 0) {
    return undefined
  }
  return {
    flag: argument.slice(0, equalsIndex).toLowerCase(),
    value: argument.slice(equalsIndex + 1),
  }
}

function isOptionOrControlArgument(argument: string): boolean {
  return argument.startsWith('-') || /^(?:&&|\|\||[|;&()<>])$/u.test(argument)
}

function separateFlagValue(args: readonly string[], flagIndex: number): string | undefined {
  const next = args[flagIndex + 1]
  return next !== undefined && next.length > 0 && !isOptionOrControlArgument(next)
    ? next
    : undefined
}

export function redactionContextForArgs(
  args: readonly string[],
  context?: RedactionContext,
): RedactionContext {
  const flags = normalizedFlags(context)
  const flagSet = new Set(flags)
  const values = [...(context?.sensitiveValues ?? [])]

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === undefined) {
      continue
    }
    const assignment = flagAssignment(argument)
    if (assignment !== undefined && flagSet.has(assignment.flag)) {
      values.push(assignment.value)
      continue
    }
    if (flagSet.has(argument.toLowerCase())) {
      const next = separateFlagValue(args, index)
      if (next !== undefined) {
        values.push(next)
        index += 1
      }
    }
  }

  return {
    sensitiveFlags: flags,
    sensitiveValues: normalizedValues(values),
  }
}

interface SourceSpan {
  readonly start: number
  readonly end: number
}

interface DecodedJsonString {
  readonly value: string
  readonly sourceStarts: readonly number[]
  readonly sourceEnds: readonly number[]
  readonly end: number
}

const JSON_ESCAPE_VALUES: Readonly<Record<string, string>> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}

function decodedJsonString(text: string, start: number): DecodedJsonString | undefined {
  let value = ''
  const sourceStarts: number[] = []
  const sourceEnds: number[] = []
  let index = start + 1

  while (index < text.length) {
    const character = text[index]
    if (character === '"') {
      return { value, sourceStarts, sourceEnds, end: index + 1 }
    }
    if (character !== '\\') {
      value += character
      sourceStarts.push(index)
      sourceEnds.push(index + 1)
      index += 1
      continue
    }

    const escapeCode = text[index + 1]
    if (escapeCode === 'u' && /^[0-9A-Fa-f]{4}$/u.test(text.slice(index + 2, index + 6))) {
      value += String.fromCharCode(Number.parseInt(text.slice(index + 2, index + 6), 16))
      sourceStarts.push(index)
      sourceEnds.push(index + 6)
      index += 6
      continue
    }
    const decoded = escapeCode === undefined ? undefined : JSON_ESCAPE_VALUES[escapeCode]
    if (decoded !== undefined) {
      value += decoded
      sourceStarts.push(index)
      sourceEnds.push(index + 2)
      index += 2
      continue
    }

    value += '\\'
    sourceStarts.push(index)
    sourceEnds.push(index + 1)
    index += 1
  }

  return undefined
}

function addMatches(
  spans: SourceSpan[],
  text: string,
  candidates: readonly string[],
  sourceStarts?: readonly number[],
  sourceEnds?: readonly number[],
): void {
  for (const candidate of candidates) {
    let index = text.indexOf(candidate)
    while (index !== -1) {
      const end = index + candidate.length
      if (sourceStarts === undefined || sourceEnds === undefined) {
        spans.push({ start: index, end })
      } else if (candidate.length > 0) {
        const sourceStart = sourceStarts[index]
        const sourceEnd = sourceEnds[end - 1]
        if (sourceStart !== undefined && sourceEnd !== undefined) {
          spans.push({ start: sourceStart, end: sourceEnd })
        }
      }
      index = text.indexOf(candidate, index + 1)
    }
  }
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

function mergeSourceSpans(spans: readonly SourceSpan[]): readonly SourceSpan[] {
  return [...spans]
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .reduce<SourceSpan[]>((merged, span) => {
      const previous = merged.at(-1)
      if (previous === undefined || span.start > previous.end) {
        merged.push(span)
      } else if (span.end > previous.end) {
        merged[merged.length - 1] = { start: previous.start, end: span.end }
      }
      return merged
    }, [])
}

/** Replaces identified source spans in one pass so generated markers are never reprocessed. */
function replaceSourceSpans(text: string, spans: readonly SourceSpan[]): string {
  const merged = mergeSourceSpans(spans)
  if (merged.length === 0) {
    return text
  }

  let redacted = ''
  let copiedThrough = 0
  for (const span of merged) {
    redacted += text.slice(copiedThrough, span.start)
    redacted += REDACTED
    copiedThrough = span.end
  }
  return `${redacted}${text.slice(copiedThrough)}`
}

function plainSensitiveValueSpans(text: string, values: readonly string[]): readonly SourceSpan[] {
  const spans: SourceSpan[] = []
  addMatches(spans, text, sensitiveRepresentations(values))
  return spans
}

function isFlagBoundary(character: string | undefined): boolean {
  return character === undefined || /[\s"'([{,:]/u.test(character)
}

function findSensitiveFlag(
  text: string,
  lowerText: string,
  index: number,
  flags: readonly string[],
): string | undefined {
  if (!isFlagBoundary(text[index - 1])) {
    return undefined
  }
  for (const flag of flags) {
    if (!lowerText.startsWith(flag, index)) {
      continue
    }
    const following = text[index + flag.length]
    if (following === '=' || (following !== undefined && /\s/u.test(following))) {
      return flag
    }
  }
  return undefined
}

function rawQuotedValueSpan(text: string, start: number, quote: string): ValueSpan {
  let index = start + 1
  while (index < text.length) {
    const character = text[index]
    if (character === '\\') {
      index += 2
      continue
    }
    if (character === quote) {
      return { contentStart: start + 1, contentEnd: index, end: index + 1 }
    }
    index += 1
  }
  return { contentStart: start + 1, contentEnd: text.length, end: text.length }
}

function escapedQuotedValueSpan(text: string, start: number): ValueSpan | undefined {
  let quoteIndex = start
  while (text[quoteIndex] === '\\') {
    quoteIndex += 1
  }
  const quote = text[quoteIndex]
  if (quote !== '"' && quote !== "'") {
    return undefined
  }

  const delimiter = text.slice(start, quoteIndex + 1)
  const closingStart = text.indexOf(delimiter, quoteIndex + 1)
  if (closingStart === -1) {
    return {
      contentStart: quoteIndex + 1,
      contentEnd: text.length,
      end: text.length,
    }
  }
  return {
    contentStart: quoteIndex + 1,
    contentEnd: closingStart,
    end: closingStart + delimiter.length,
  }
}

function unquotedValueSpan(text: string, start: number): ValueSpan {
  let end = start
  while (end < text.length && !/[\s"',;\])}]/u.test(text[end] ?? '')) {
    end += 1
  }
  return { contentStart: start, contentEnd: end, end }
}

function valueSpan(text: string, start: number): ValueSpan {
  const first = text[start]
  if (first === '"' || first === "'") {
    return rawQuotedValueSpan(text, start, first)
  }
  if (first === '\\') {
    const escaped = escapedQuotedValueSpan(text, start)
    if (escaped !== undefined) {
      return escaped
    }
  }
  return unquotedValueSpan(text, start)
}

function flagValueSpans(text: string, flags: readonly string[]): readonly SourceSpan[] {
  if (flags.length === 0 || text.length === 0) {
    return []
  }

  const spans: SourceSpan[] = []
  const lowerText = text.toLowerCase()
  let index = 0
  while (index < text.length) {
    const flag = findSensitiveFlag(text, lowerText, index, flags)
    if (flag === undefined) {
      index += 1
      continue
    }

    let valueStart = index + flag.length
    if (text[valueStart] === '=') {
      valueStart += 1
    } else {
      while (valueStart < text.length && /\s/u.test(text[valueStart] ?? '')) {
        valueStart += 1
      }
    }
    if (valueStart >= text.length) {
      index += flag.length
      continue
    }

    const span = valueSpan(text, valueStart)
    if (
      span.contentStart >= span.contentEnd ||
      text.slice(span.contentStart, span.contentEnd) === REDACTED
    ) {
      index = Math.max(index + flag.length, span.end)
      continue
    }
    spans.push({ start: span.contentStart, end: span.contentEnd })
    index = Math.max(index + flag.length, span.end)
  }
  return spans
}

function mapDecodedSpan(decoded: DecodedJsonString, span: SourceSpan): SourceSpan | undefined {
  if (span.start >= span.end) {
    return undefined
  }
  const start = decoded.sourceStarts[span.start]
  const end = decoded.sourceEnds[span.end - 1]
  return start === undefined || end === undefined ? undefined : { start, end }
}

function decodedStringSpans(
  decoded: DecodedJsonString,
  context: RedactionContext,
  depth: number,
): readonly SourceSpan[] {
  const wholeMatches = sensitiveRepresentations(context.sensitiveValues).some(
    (candidate) => candidate === decoded.value,
  )
  if (wholeMatches && decoded.value.length > 0) {
    return [{ start: 0, end: decoded.value.length }]
  }
  return textSourceSpans(decoded.value, context, depth + 1, depth < 16)
}

function structuredSourceSpans(
  text: string,
  context: RedactionContext,
  depth = 0,
): readonly SourceSpan[] {
  const spans: SourceSpan[] = []
  let index = 0
  while (index < text.length) {
    if (text[index] !== '"') {
      index += 1
      continue
    }
    const decoded = decodedJsonString(text, index)
    if (decoded === undefined) {
      index += 1
      continue
    }
    for (const localSpan of decodedStringSpans(decoded, context, depth)) {
      const mapped = mapDecodedSpan(decoded, localSpan)
      if (mapped !== undefined) {
        spans.push(mapped)
      }
    }
    index = decoded.end
  }
  return spans
}

function lineContentSegments(text: string): readonly SourceSpan[] {
  const segments: SourceSpan[] = []
  let start = 0
  let index = 0
  while (index < text.length) {
    const character = text[index]
    if (character !== '\r' && character !== '\n') {
      index += 1
      continue
    }
    segments.push({ start, end: index })
    index += character === '\r' && text[index + 1] === '\n' ? 2 : 1
    start = index
  }
  segments.push({ start, end: text.length })
  return segments
}

function textSourceSpans(
  text: string,
  context: RedactionContext,
  depth = 0,
  scanStructured = true,
): readonly SourceSpan[] {
  if (isValidJson(text)) {
    return scanStructured ? structuredSourceSpans(text, context, depth) : []
  }

  const spans: SourceSpan[] = []
  for (const segment of lineContentSegments(text)) {
    const line = text.slice(segment.start, segment.end)
    const localSpans = isValidJson(line)
      ? scanStructured
        ? structuredSourceSpans(line, context, depth)
        : []
      : [
          ...plainSensitiveValueSpans(line, context.sensitiveValues),
          ...flagValueSpans(line, context.sensitiveFlags),
        ]
    for (const span of localSpans) {
      spans.push({ start: segment.start + span.start, end: segment.start + span.end })
    }
  }
  return spans
}

export function redactText(text: string, context?: RedactionContext): string {
  const normalized = {
    sensitiveFlags: normalizedFlags(context),
    sensitiveValues: normalizedValues(context?.sensitiveValues ?? []),
  }
  return replaceSourceSpans(text, textSourceSpans(text, normalized))
}

function quoteForDisplay(value: string): string {
  return /[\s"]/u.test(value) ? JSON.stringify(value) : value
}

export function redactCommand(
  executable: string,
  args: readonly string[],
  context?: RedactionContext,
): string {
  const normalized = redactionContextForArgs(args, context)
  const flagSet = new Set(normalized.sensitiveFlags)
  const redactedArgs: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === undefined) {
      continue
    }
    const assignment = flagAssignment(argument)
    if (assignment !== undefined && flagSet.has(assignment.flag)) {
      redactedArgs.push(`${argument.slice(0, argument.indexOf('='))}=${REDACTED}`)
      continue
    }
    if (flagSet.has(argument.toLowerCase())) {
      redactedArgs.push(argument)
      const next = separateFlagValue(args, index)
      if (next !== undefined) {
        redactedArgs.push(REDACTED)
        index += 1
      }
      continue
    }
    redactedArgs.push(redactText(argument, normalized))
  }

  const redactedExecutable = redactText(executable, normalized)
  return [redactedExecutable, ...redactedArgs].map(quoteForDisplay).join(' ')
}
