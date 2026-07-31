import type { Readable } from 'node:stream'

/**
 * Strict JSONL reader: splits ONLY on LF (U+000A).
 * Must NOT use Node readline (which also splits on U+2028/U+2029).
 */
export function createStrictJsonlReader(
  stream: Readable,
  onLine: (line: string) => void,
  onError?: (error: Error) => void,
): { close: () => void } {
  let buffer = ''
  const onData = (chunk: Buffer | string) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    for (;;) {
      const idx = buffer.indexOf('\n')
      if (idx < 0) {
        break
      }
      let line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      if (line.endsWith('\r')) {
        line = line.slice(0, -1)
      }
      if (line.length > 0) {
        onLine(line)
      }
    }
  }
  const onEnd = () => {
    if (buffer.length > 0) {
      const line = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer
      buffer = ''
      if (line.length > 0) {
        onLine(line)
      }
    }
  }
  const onErr = (error: Error) => {
    onError?.(error)
  }
  stream.on('data', onData)
  stream.on('end', onEnd)
  stream.on('error', onErr)
  return {
    close() {
      stream.off('data', onData)
      stream.off('end', onEnd)
      stream.off('error', onErr)
    },
  }
}

/**
 * Serializes one JSONL record with trailing LF.
 */
export function serializeJsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}
