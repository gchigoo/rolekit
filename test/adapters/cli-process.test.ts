import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { promisify } from 'node:util'

import {
  CliAbortedError,
  CliExitError,
  CliOutputLimitError,
  CliSpawnError,
  CliTimeoutError,
} from '../../src/adapters/cli/errors.ts'
import { isolatedUserEnvironment, prepareCliEnvironment } from '../../src/adapters/cli/options.ts'
import { runCliProcess } from '../../src/adapters/cli/process.ts'
import {
  redactCommand,
  redactionContextForArgs,
  redactText,
} from '../../src/adapters/cli/redaction.ts'

const execFileAsync = promisify(execFile)
const fixturePath = resolve('test', 'fixtures', 'long-running-cli.mjs')

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
    return undefined
  } catch (error: unknown) {
    return error
  }
}

function collectSurfaceText(value: unknown): string {
  const strings: string[] = []
  const visited = new WeakSet<object>()
  const visit = (candidate: unknown): void => {
    if (typeof candidate === 'string') {
      strings.push(candidate)
      return
    }
    if ((typeof candidate !== 'object' && typeof candidate !== 'function') || candidate === null) {
      return
    }
    if (visited.has(candidate)) {
      return
    }
    visited.add(candidate)
    for (const key of Reflect.ownKeys(candidate)) {
      try {
        visit(Reflect.get(candidate, key))
      } catch {
        // Hostile/native getters are not required to participate in the assertion.
      }
    }
  }
  visit(value)
  return strings.join('\n')
}

interface FakeWindowsHelperResult {
  readonly exitCode: number | null
  readonly pids?: readonly number[]
  readonly failures?: readonly string[]
}

interface FakeWindowsHelper {
  readonly completion: Promise<FakeWindowsHelperResult>
  readonly terminate: () => void
  readonly unref: () => void
}

interface FakeWindowsTerminationDependencies {
  readonly startSnapshot: (pid: number) => FakeWindowsHelper
  readonly startTaskkill: (pid: number) => FakeWindowsHelper
  readonly startFallback: (pids: readonly number[]) => FakeWindowsHelper
  readonly processExists: (pid: number) => boolean
  readonly forceKill: (pid: number) => void
}

type WindowsTerminationFunction = (
  child: { readonly pid?: number },
  graceMs: number,
  dependencies: FakeWindowsTerminationDependencies,
) => Promise<void>

type CopyRetainedOutputPrefixFunction = (chunk: Buffer, retainedBytes: number) => Buffer

async function loadCopyRetainedOutputPrefix(): Promise<CopyRetainedOutputPrefixFunction> {
  const module = (await import('../../src/adapters/cli/process.ts')) as unknown as {
    readonly copyRetainedOutputPrefix?: CopyRetainedOutputPrefixFunction
  }
  assert.equal(
    typeof module.copyRetainedOutputPrefix,
    'function',
    'Retained output copying must expose a focused allocation seam.',
  )
  return module.copyRetainedOutputPrefix as CopyRetainedOutputPrefixFunction
}

async function loadWindowsTerminationFunction(): Promise<WindowsTerminationFunction> {
  const module = (await import('../../src/adapters/cli/termination.ts')) as unknown as {
    readonly terminateWindowsProcessTree?: WindowsTerminationFunction
  }
  assert.equal(
    typeof module.terminateWindowsProcessTree,
    'function',
    'Windows termination orchestration must be directly testable with bounded fake helpers.',
  )
  return module.terminateWindowsProcessTree as WindowsTerminationFunction
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function waitForFile(path: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await pathExists(path)) {
      return
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  throw new Error(`Timed out waiting for fixture file: ${path}`)
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return !(
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ESRCH'
    )
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!processExists(pid)) {
      return true
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  return !processExists(pid)
}

async function forceKillTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F']).catch(() => undefined)
    return
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // The process already exited.
  }
}

describe('CLI process execution', () => {
  it('reports timeout separately from user cancellation', async () => {
    const error = await captureError(
      runCliProcess({
        command: process.execPath,
        args: [fixturePath, 'hang'],
        cwd: process.cwd(),
        environment: {},
        timeoutMs: 50,
      }),
    )

    assert.ok(error instanceof CliTimeoutError)
    assert.equal(error.code, 'timeout')
  })

  it('reports user cancellation with its own typed error', async () => {
    const controller = new AbortController()
    const promise = runCliProcess({
      command: process.execPath,
      args: [fixturePath, 'hang'],
      cwd: process.cwd(),
      environment: {},
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 50)

    const error = await captureError(promise)
    assert.ok(error instanceof CliAbortedError)
    assert.equal(error.code, 'cancelled')
  })

  it('does not spawn when the signal is already aborted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rolekit-pre-abort-'))
    const markerPath = join(directory, 'spawned.txt')
    const controller = new AbortController()
    controller.abort()
    try {
      const error = await captureError(
        runCliProcess({
          command: process.execPath,
          args: [fixturePath, 'touch', markerPath],
          cwd: process.cwd(),
          environment: {},
          signal: controller.signal,
        }),
      )

      assert.equal(await pathExists(markerPath), false)
      assert.ok(error instanceof CliAbortedError)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('does not spawn when cancellation happens during executable resolution', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rolekit-resolution-abort-'))
    const markerPath = join(directory, 'spawned.txt')
    const controller = new AbortController()
    try {
      const runPromise = runCliProcess({
        command: process.execPath,
        args: [fixturePath, 'touch', markerPath],
        cwd: process.cwd(),
        environment: {},
        signal: controller.signal,
      })
      controller.abort()

      await assert.rejects(runPromise, (error: unknown) => error instanceof CliAbortedError)
      assert.equal(await pathExists(markerPath), false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('uses a typed output-limit failure', async () => {
    const error = await captureError(
      runCliProcess({
        command: process.execPath,
        args: [fixturePath, 'output'],
        cwd: process.cwd(),
        environment: {},
        maxOutputBytes: 32,
      }),
    )

    assert.ok(error instanceof CliOutputLimitError)
    assert.equal(error.code, 'output_limit_exceeded')
  })

  it('retains no more than the configured output prefix before terminating', async () => {
    const maxOutputBytes = 64
    const error = await captureError(
      runCliProcess({
        command: process.execPath,
        args: [fixturePath, 'output'],
        cwd: process.cwd(),
        environment: {},
        maxOutputBytes,
      }),
    )

    assert.ok(error instanceof CliOutputLimitError)
    const retainedExcerpt = /Stdout: (x+)/u.exec(error.message)?.[1] ?? ''
    assert.ok(retainedExcerpt.length > 0)
    assert.ok(
      retainedExcerpt.length <= maxOutputBytes,
      `output-limit diagnostics retained more than ${maxOutputBytes} bytes`,
    )
  })

  it('copies retained output into a right-sized independent backing allocation', async () => {
    const copyRetainedOutputPrefix = await loadCopyRetainedOutputPrefix()
    const source = Buffer.alloc(1_048_576, 'x')
    const retained = copyRetainedOutputPrefix(source, 37)

    assert.equal(retained.byteLength, 37)
    assert.equal(retained.buffer.byteLength, 37)
    assert.notEqual(retained.buffer, source.buffer)
    source.fill('z')
    assert.equal(retained.toString('utf8'), 'x'.repeat(37))
  })

  it('shares one retained byte allowance across racing stdout and stderr chunks', async () => {
    const maxOutputBytes = 128
    const error = await captureError(
      runCliProcess({
        command: process.execPath,
        args: [fixturePath, 'mixed-output'],
        cwd: process.cwd(),
        environment: {},
        maxOutputBytes,
      }),
    )

    assert.ok(error instanceof CliOutputLimitError)
    const retainedCharacters = /(?:Stdout|Stderr): ([oe]+)/u.exec(error.message)?.[1] ?? ''
    assert.ok(retainedCharacters.length > 0)
    assert.ok(retainedCharacters.length <= maxOutputBytes)
  })

  it('uses typed spawn and nonzero-exit failures', async () => {
    const missingCwd = join(tmpdir(), `rolekit-missing-${Date.now()}`)
    const spawnError = await captureError(
      runCliProcess({
        command: process.execPath,
        args: ['--version'],
        cwd: missingCwd,
        environment: {},
      }),
    )
    const exitError = await captureError(
      runCliProcess({
        command: process.execPath,
        args: [fixturePath, 'fail', 'ordinary-failure'],
        cwd: process.cwd(),
        environment: {},
      }),
    )

    assert.ok(spawnError instanceof CliSpawnError)
    assert.ok(exitError instanceof CliExitError)
  })

  it('retains real signal termination separately from matching accepted or rejected bytes', {
    skip: process.platform === 'win32',
  }, async () => {
    const boundaries = [
      {
        label: 'accepted',
        stdout: '',
        stderr: 'Reading prompt from stdin...\nNo prompt provided via stdin.\n',
      },
      {
        label: 'rejected',
        stdout: '',
        stderr:
          'Error loading config.toml: invalid type: string "rolekit-invalid-value-canary", expected usize\nin `project_doc_max_bytes`\n\n',
      },
    ] as const

    for (const boundary of boundaries) {
      const error = await captureError(
        runCliProcess({
          command: process.execPath,
          args: [fixturePath, 'signal-after-output', boundary.stdout, boundary.stderr, 'SIGTERM'],
          cwd: process.cwd(),
          environment: {},
        }),
      )

      assert.ok(error instanceof CliExitError, boundary.label)
      assert.equal(error.exitCode, undefined, boundary.label)
      assert.equal(error.signal, 'SIGTERM', boundary.label)
      assert.equal(error.stdout, boundary.stdout, boundary.label)
      assert.equal(error.stderr, boundary.stderr, boundary.label)
      assert.match(error.message, /signal SIGTERM/iu, boundary.label)
    }
  })

  it('encodes isolated Windows home variables with drive and path semantics', () => {
    const directory = String.raw`C:\Users\rolekit\AppData\Local\Temp\canary`
    const environment = isolatedUserEnvironment(directory, 'win32')

    assert.equal(environment.HOME, directory)
    assert.equal(environment.USERPROFILE, directory)
    assert.equal(environment.APPDATA, directory)
    assert.equal(environment.LOCALAPPDATA, directory)
    assert.equal(environment.HOMEDRIVE, 'C:')
    assert.equal(environment.HOMEPATH, String.raw`\Users\rolekit\AppData\Local\Temp\canary`)
    assert.equal(`${environment.HOMEDRIVE}${environment.HOMEPATH}`, directory)
  })

  it('removes secrets from nested spawn-error properties and causes', async () => {
    const secret = 'nested-spawn-secret'
    const error = await captureError(
      runCliProcess({
        command: process.execPath,
        args: [fixturePath, 'fail', '--token', secret],
        cwd: join(tmpdir(), `rolekit-missing-spawn-cwd-${Date.now()}`),
        environment: {},
      }),
    )

    assert.ok(error instanceof CliSpawnError)
    const surface = collectSurfaceText(error)
    assert.doesNotMatch(surface, new RegExp(secret, 'u'))
    assert.match(surface, /\[REDACTED\]/u)
  })

  it('redacts missing-executable resolution error metadata', async () => {
    const secret = 'missing-command-secret'
    const error = await captureError(
      runCliProcess({
        command: join(tmpdir(), `rolekit-${secret}-missing`),
        args: [],
        cwd: process.cwd(),
        environment: {},
        redaction: { sensitiveFlags: [], sensitiveValues: [secret] },
      }),
    )

    assert.ok(error instanceof Error)
    const surface = collectSurfaceText(error)
    assert.doesNotMatch(surface, new RegExp(secret, 'u'))
    assert.match(surface, /\[REDACTED\]/u)
  })

  it('redacts successful executable metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rolekit-executable-metadata-'))
    const secret = 'successful-path-secret'
    const executablePath = join(directory, `node-${secret}`)
    try {
      await symlink(process.execPath, executablePath)
      const result = await runCliProcess({
        command: executablePath,
        args: ['--version'],
        cwd: process.cwd(),
        environment: {},
        redaction: { sensitiveFlags: [], sensitiveValues: [secret] },
      })

      const surface = collectSurfaceText(result)
      assert.doesNotMatch(surface, new RegExp(secret, 'u'))
      assert.match(result.executablePath, /\[REDACTED\]/u)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('redacts secret flags from command evidence', () => {
    assert.equal(
      redactCommand('agent', ['--api-key', 'secret', '--token=secret-2', '--model', 'x']),
      'agent --api-key [REDACTED] --token=[REDACTED] --model x',
    )
  })

  it('redacts sensitive flag forms embedded inside one command argument', () => {
    assert.equal(
      redactCommand('sh', [
        '-c',
        'agent --token=secret --header "Authorization: Bearer nested-secret" --model x',
      ]),
      'sh -c "agent --token=[REDACTED] --header \\"[REDACTED]\\" --model x"',
    )
  })

  it('does not consume empty or option argv elements as sensitive values', () => {
    for (const { args, expectedCommand, expectedValues } of [
      {
        args: ['--token', '--model', 'x'],
        expectedCommand: 'agent --token --model x',
        expectedValues: [],
      },
      {
        args: ['--token', ''],
        expectedCommand: 'agent --token ',
        expectedValues: [],
      },
      {
        args: ['--token', 'secret', '--model', 'x'],
        expectedCommand: 'agent --token [REDACTED] --model x',
        expectedValues: ['secret'],
      },
    ] as const) {
      assert.equal(redactCommand('agent', args), expectedCommand)
      assert.deepEqual(redactionContextForArgs(args).sensitiveValues, expectedValues)
    }
  })

  it('matches short quote and backslash secrets only in decoded JSON string content', () => {
    for (const { secret, source, expected } of [
      {
        secret: 'n',
        source: String.raw`{"e":"\n","s":"n","x":1}`,
        expected: String.raw`{"e":"\n","s":"[REDACTED]","x":1}`,
      },
      {
        secret: '"',
        source: String.raw`{"e":"\n","s":"\"","x":1}`,
        expected: String.raw`{"e":"\n","s":"[REDACTED]","x":1}`,
      },
      {
        secret: '\\',
        source: String.raw`{"e":"\/","s":"\\","x":1}`,
        expected: String.raw`{"e":"\/","s":"[REDACTED]","x":1}`,
      },
    ]) {
      assert.doesNotThrow(() => JSON.parse(source), secret)
      const redacted = redactText(source, { sensitiveFlags: [], sensitiveValues: [secret] })
      assert.equal(redacted, expected, secret)
      assert.doesNotThrow(() => JSON.parse(redacted), secret)
    }
  })

  it('leaves trailing and valueless sensitive flags byte-for-byte unchanged in JSONL', () => {
    const source = [
      '{"message":"use --token ","x":1}',
      '{"message":"--token=","x":2}',
      '{"message":"--token","x":3}',
      '',
    ].join('\r\n')

    for (const line of source.split(/\r?\n/u).filter((entry) => entry.length > 0)) {
      assert.doesNotThrow(() => JSON.parse(line))
    }
    const redacted = redactText(source)
    assert.equal(redacted, source)
    for (const line of redacted.split(/\r?\n/u).filter((entry) => entry.length > 0)) {
      assert.doesNotThrow(() => JSON.parse(line))
    }
  })

  it('scans valid JSONL records independently from diagnostic segments', () => {
    for (const secret of ['n', '"', '\\']) {
      const record = {
        type: 'result',
        e: 'a\nb',
        q: 'say "hi"',
        b: 'C:\\tmp',
        s: secret,
        f: '--api-key=flag-secret',
      }
      const expectedRecord = {
        ...record,
        e: record.e.split(secret).join('[REDACTED]'),
        q: record.q.split(secret).join('[REDACTED]'),
        b: record.b.split(secret).join('[REDACTED]'),
        s: '[REDACTED]',
        f: '--api-key=[REDACTED]',
      }
      const source = `log --api-key=diag-secret\r\n ${JSON.stringify(record)} \nstatus: ok\r\n`
      const expected = `log --api-key=[REDACTED]\r\n ${JSON.stringify(expectedRecord)} \nstatus: ok\r\n`

      const redacted = redactText(source, {
        sensitiveFlags: [],
        sensitiveValues: [secret],
      })

      assert.equal(redacted, expected, secret)
      const resultLine = redacted.split(/\r?\n/u)[1]
      assert.ok(resultLine !== undefined)
      assert.deepEqual(JSON.parse(resultLine), expectedRecord, secret)
    }
  })

  it('preserves JSON and JSONL syntax while redacting flag values', () => {
    const json = JSON.stringify({
      assignment: '--token=secret',
      separate: '--api-key "quoted secret"',
      escapedAssignment: '--header=\\"Authorization: Bearer secret\\"',
      punctuation: '--password=secret, next',
      untouched: 1,
    })
    const redactedJson = redactText(json)
    const parsedJson = JSON.parse(redactedJson) as Record<string, unknown>
    assert.equal(parsedJson.assignment, '--token=[REDACTED]')
    assert.equal(parsedJson.separate, '--api-key "[REDACTED]"')
    assert.equal(parsedJson.escapedAssignment, '--header=\\"[REDACTED]\\"')
    assert.equal(parsedJson.punctuation, '--password=[REDACTED], next')
    assert.equal(parsedJson.untouched, 1)

    const jsonLines = `${JSON.stringify({ value: '--token=first', index: 1 })}\n${JSON.stringify({ value: '--token "second value"', index: 2 })}\n`
    const redactedLines = redactText(jsonLines)
    const records = redactedLines
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line) as { readonly value: string; readonly index: number })
    assert.deepEqual(records, [
      { value: '--token=[REDACTED]', index: 1 },
      { value: '--token "[REDACTED]"', index: 2 },
    ])
  })

  it('preserves non-sensitive JSON and JSONL byte-for-byte', () => {
    const json = [
      '{',
      '  "duplicate": 1,',
      '  "huge": 1e400,',
      '  "tiny": -9.10938356e-999,',
      '  "escaped": "\\u0061\\/\\\\\\"\\n",',
      '  "modelText": "{\\"a\\": 1}",',
      '  "duplicate": 2',
      '}',
      '',
    ].join('\r\n')
    const jsonLines = [
      ' { "huge": 9e999, "duplicate": 1, "duplicate": 2 } ',
      '{"escaped":"\\u003c\\/tag\\u003e","modelText":"{\\"a\\": 1}"}',
      '',
      '',
    ].join('\n')

    assert.doesNotThrow(() => JSON.parse(json))
    assert.equal(redactText(json), json)
    assert.equal(redactText(json, { sensitiveFlags: [], sensitiveValues: ['absent-secret'] }), json)
    assert.equal(redactText(jsonLines), jsonLines)
  })

  it('changes only exact sensitive source spans in formatted JSON and nested JSON strings', () => {
    const secret = 'quote"slash\\comma,secret'
    const encodedSecret = JSON.stringify(secret).slice(1, -1)
    const nestedSecret = JSON.stringify(encodedSecret).slice(1, -1)
    const nestedJson = JSON.stringify({ value: secret })
    const source = [
      '{',
      `  "secret": "${encodedSecret}",`,
      '  "keepEscaped": "\\u0061\\/\\n",',
      '  "huge": 1e400,',
      `  "modelText": ${JSON.stringify(nestedJson)}`,
      '}',
      '',
    ].join('\n')
    const expected = source.replace(encodedSecret, '[REDACTED]').replace(nestedSecret, '[REDACTED]')

    assert.equal(redactText(source, { sensitiveFlags: [], sensitiveValues: [secret] }), expected)
  })

  it('changes only sensitive flag value spans in formatted JSONL', () => {
    const source =
      ' { "value": "--token=secret", "huge": 1e400, "duplicate": 1, "duplicate": 2 } \r\n' +
      '{"modelText":"{\\"a\\": 1}","value":"--header \\"Authorization: Bearer secret\\""}\n'
    const expected = source
      .replace('--token=secret', '--token=[REDACTED]')
      .replace('--header \\"Authorization: Bearer secret\\"', '--header \\"[REDACTED]\\"')

    assert.equal(redactText(source), expected)
  })

  it('redacts quoted flag values without consuming punctuation or escapes', () => {
    assert.equal(
      redactText('before --token="secret value", after'),
      'before --token="[REDACTED]", after',
    )
    assert.equal(
      redactText("before --header 'Authorization: secret'; after"),
      "before --header '[REDACTED]'; after",
    )
    assert.equal(
      redactText('before --client-secret=secret) after'),
      'before --client-secret=[REDACTED]) after',
    )
  })

  it('redacts exact JSON string values containing quotes, escapes, and punctuation', () => {
    const secret = 'quote"slash\\comma,secret'
    const source = JSON.stringify({ value: secret, nested: JSON.stringify({ value: secret }) })
    const redacted = redactText(source, { sensitiveFlags: [], sensitiveValues: [secret] })
    const parsed = JSON.parse(redacted) as { readonly value: string; readonly nested: string }
    assert.equal(parsed.value, '[REDACTED]')
    assert.equal((JSON.parse(parsed.nested) as { readonly value: string }).value, '[REDACTED]')
    assert.doesNotMatch(redacted, /quote|secret/u)
  })

  it('redacts exact sensitive values that contain the redaction marker', () => {
    const secret = 'prefix[REDACTED]suffix'
    assert.equal(
      redactText(`before ${secret} after`, {
        sensitiveFlags: [],
        sensitiveValues: [secret],
      }),
      'before [REDACTED] after',
    )
  })

  it('preserves the redaction marker when a sensitive value overlaps its text', () => {
    assert.equal(
      redactText('--token REDACTED', {
        sensitiveFlags: [],
        sensitiveValues: ['REDACTED'],
      }),
      '--token [REDACTED]',
    )
  })

  it('redacts echoed secret values from stderr-derived errors before truncation', async () => {
    const secret = 'sentinel-secret-that-must-not-leak'
    const error = await captureError(
      runCliProcess({
        command: process.execPath,
        args: [fixturePath, 'fail', `${'x'.repeat(300)}${secret}`],
        cwd: process.cwd(),
        environment: {},
        redaction: { sensitiveFlags: [], sensitiveValues: [secret] },
      }),
    )

    assert.ok(error instanceof Error)
    assert.doesNotMatch(error.message, new RegExp(secret, 'u'))
    assert.match(error.message, /\[REDACTED\]/u)
  })

  it('does not merge the parent process environment implicitly', async () => {
    const original = process.env.ROLEKIT_PARENT_SECRET
    process.env.ROLEKIT_PARENT_SECRET = 'must-not-be-inherited'
    try {
      const result = await runCliProcess({
        command: process.execPath,
        args: [fixturePath, 'environment'],
        cwd: process.cwd(),
        environment: { ROLEKIT_ALLOWED_ENV: 'explicit-value' },
      })
      const observed = JSON.parse(result.stdout) as {
        readonly allowed: string | null
        readonly inheritedSecret: string | null
      }

      assert.equal(observed.allowed, 'explicit-value')
      assert.equal(observed.inheritedSecret, null)
    } finally {
      if (original === undefined) {
        delete process.env.ROLEKIT_PARENT_SECRET
      } else {
        process.env.ROLEKIT_PARENT_SECRET = original
      }
    }
  })

  it('rejects cross-runtime process controls through direct environment preparation', () => {
    for (const key of [
      'BASH_ENV',
      'ENV',
      'PYTHONHOME',
      'PYTHONPATH',
      'RUBYOPT',
      'PERL5OPT',
      'SSLKEYLOGFILE',
      'NODE_EXTRA_CA_CERTS',
      'pYtHoNpAtH',
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'PSModulePath',
      'NPM_CONFIG_NODE_OPTIONS',
      'AWS_SHARED_CREDENTIALS_FILE',
      'AWS_CONFIG_FILE',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'AZURE_CONFIG_DIR',
      'KUBECONFIG',
      'DOCKER_CONFIG',
      'GNUPGHOME',
      'SSH_AUTH_SOCK',
    ]) {
      assert.throws(
        () => prepareCliEnvironment({ [key]: 'unsafe' }),
        /reserved|process control|isolation|unsafe/iu,
        key,
      )
    }
  })

  it('default-denies undeclared profile keys while allowing RoleKit-scoped data', () => {
    assert.throws(
      () => prepareCliEnvironment({ UNDECLARED_CUSTOM_SETTING: 'unsafe-by-default' }),
      /not allowed|allowlist|declared/iu,
    )
    assert.equal(
      prepareCliEnvironment({ ROLEKIT_ALLOWED_ENV: 'explicit-value' }).environment
        .ROLEKIT_ALLOWED_ENV,
      'explicit-value',
    )
  })

  it('uses only declared per-run authentication values unless ambient inheritance is explicit', () => {
    const key = 'OPENAI_API_KEY'
    const ambient = 'ambient-openai-secret'
    const explicit = 'explicit-openai-secret'
    const original = process.env[key]
    process.env[key] = ambient
    try {
      const safe = prepareCliEnvironment(undefined, {
        authenticationEnvironmentKeys: [key],
      })
      assert.equal(safe.environment[key], undefined)
      assert.ok(!safe.sensitiveValues.includes(ambient))

      const prepared = prepareCliEnvironment(
        { [key]: explicit },
        { authenticationEnvironmentKeys: [key] },
      )
      assert.equal(prepared.environment[key], explicit)
      assert.ok(prepared.sensitiveValues.includes(explicit))
      assert.ok(!prepared.sensitiveValues.includes(ambient))

      const inherited = prepareCliEnvironment(
        undefined,
        { authenticationEnvironmentKeys: [key] },
        { inheritAmbientEnvironment: true },
      )
      assert.equal(inherited.environment[key], ambient)
      assert.ok(inherited.sensitiveValues.includes(ambient))
    } finally {
      if (original === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = original
      }
    }
  })

  it('prevents profiles from overriding typed custom isolation keys', () => {
    const key = 'ROLEKIT_CUSTOM_CONFIG_HOME'
    const original = process.env[key]
    process.env[key] = 'typed-isolation-value'
    try {
      assert.throws(
        () =>
          prepareCliEnvironment(
            { rolekit_custom_config_home: 'profile-override' },
            { configHomeEnvironmentKeys: [key] },
          ),
        /reserved|isolation/iu,
      )
      const prepared = prepareCliEnvironment(undefined, {
        configHomeEnvironmentKeys: [key],
      })
      assert.equal(prepared.environment[key], undefined)
      const inherited = prepareCliEnvironment(
        undefined,
        { configHomeEnvironmentKeys: [key] },
        { inheritAmbientEnvironment: true },
      )
      assert.equal(inherited.environment[key], 'typed-isolation-value')
    } finally {
      if (original === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = original
      }
    }
  })

  it('inherits only explicit locale categories and the current platform baseline', () => {
    const inherited = {
      LC_ROLEKIT_SECRET: 'must-not-inherit-lc-wildcard',
      ...(process.platform === 'win32'
        ? {
            HOME: 'must-not-inherit-posix-home',
            TMPDIR: 'must-not-inherit-posix-temp',
          }
        : {
            SystemRoot: 'must-not-inherit-windows-root',
            ComSpec: 'must-not-inherit-windows-shell',
            PATHEXT: 'must-not-inherit-windows-path-extensions',
            USERPROFILE: 'must-not-inherit-windows-profile',
          }),
    } as const
    const originals = new Map<string, string | undefined>()
    for (const [key, value] of Object.entries(inherited)) {
      originals.set(key, process.env[key])
      process.env[key] = value
    }
    try {
      const prepared = prepareCliEnvironment(undefined)
      for (const key of Object.keys(inherited)) {
        assert.equal(prepared.environment[key], undefined, key)
      }
    } finally {
      for (const [key, value] of originals) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    }
  })

  it('terminates the spawned POSIX process group including grandchildren', {
    skip: process.platform === 'win32',
  }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rolekit-posix-tree-'))
    const pidPath = join(directory, 'grandchild.pid')
    const controller = new AbortController()
    let grandchildPid: number | undefined
    try {
      const runPromise = runCliProcess({
        command: process.execPath,
        args: [fixturePath, 'spawn-grandchild', pidPath],
        cwd: process.cwd(),
        environment: {},
        signal: controller.signal,
      })
      await waitForFile(pidPath)
      grandchildPid = Number.parseInt(await readFile(pidPath, 'utf8'), 10)
      assert.equal(processExists(grandchildPid), true)

      controller.abort()
      await assert.rejects(runPromise)
      assert.equal(await waitForProcessExit(grandchildPid), true)
    } finally {
      if (grandchildPid !== undefined && processExists(grandchildPid)) {
        await forceKillTree(grandchildPid)
      }
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('bounds POSIX grace and escalates stubborn process groups to SIGKILL', {
    skip: process.platform === 'win32',
  }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rolekit-posix-stubborn-tree-'))
    const pidPath = join(directory, 'grandchild.pid')
    const controller = new AbortController()
    let grandchildPid: number | undefined
    try {
      const runPromise = runCliProcess({
        command: process.execPath,
        args: [fixturePath, 'spawn-stubborn-grandchild', pidPath],
        cwd: process.cwd(),
        environment: {},
        signal: controller.signal,
      })
      await waitForFile(pidPath)
      grandchildPid = Number.parseInt(await readFile(pidPath, 'utf8'), 10)
      const startedAt = Date.now()
      controller.abort()

      await assert.rejects(runPromise, (error: unknown) => error instanceof CliAbortedError)
      const durationMs = Date.now() - startedAt
      assert.ok(durationMs >= 800, `termination grace was only ${durationMs} ms`)
      assert.ok(durationMs < 3_000, `termination was not bounded: ${durationMs} ms`)
      assert.equal(await waitForProcessExit(grandchildPid), true)
    } finally {
      if (grandchildPid !== undefined && processExists(grandchildPid)) {
        await forceKillTree(grandchildPid)
      }
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('snapshots and verifies the Windows parent and every descendant after taskkill', async () => {
    const terminateWindows = await loadWindowsTerminationFunction()
    const parentPid = 41
    const grandchildPid = 141
    const running = new Map([
      [parentPid, true],
      [grandchildPid, true],
    ])
    let fallbackCalls = 0
    await terminateWindows({ pid: parentPid }, 100, {
      startSnapshot: () => ({
        completion: Promise.resolve({ exitCode: 0, pids: [grandchildPid], failures: [] }),
        terminate: () => {},
        unref: () => {},
      }),
      startTaskkill: () => ({
        completion: Promise.resolve().then(() => {
          running.set(parentPid, false)
          running.set(grandchildPid, false)
          return { exitCode: 0 }
        }),
        terminate: () => {},
        unref: () => {},
      }),
      startFallback: () => {
        fallbackCalls += 1
        return {
          completion: Promise.resolve({ exitCode: 0, failures: [] }),
          terminate: () => {},
          unref: () => {},
        }
      },
      processExists: (pid) => running.get(pid) ?? false,
      forceKill: (pid) => running.set(pid, false),
    })
    assert.equal(running.get(parentPid), false)
    assert.equal(running.get(grandchildPid), false)
    assert.equal(fallbackCalls, 0)
  })

  it('cleans captured Windows descendants but reports unverified when taskkill fails', async () => {
    const terminateWindows = await loadWindowsTerminationFunction()
    for (const primary of ['nonzero', 'error'] as const) {
      const parentPid = 42
      const grandchildPid = 142
      const running = new Map([
        [parentPid, true],
        [grandchildPid, true],
      ])
      let fallbackCalls = 0
      await assert.rejects(
        terminateWindows({ pid: parentPid }, 100, {
          startSnapshot: () => ({
            completion: Promise.resolve({ exitCode: 0, pids: [grandchildPid], failures: [] }),
            terminate: () => {},
            unref: () => {},
          }),
          startTaskkill: () => ({
            completion:
              primary === 'nonzero'
                ? Promise.resolve({ exitCode: 5 })
                : Promise.reject(new Error('taskkill unavailable')),
            terminate: () => {},
            unref: () => {},
          }),
          startFallback: (pids) => {
            fallbackCalls += 1
            assert.deepEqual(new Set(pids), new Set([parentPid, grandchildPid]))
            return {
              completion: Promise.resolve().then(() => {
                for (const pid of pids) {
                  running.set(pid, false)
                }
                return { exitCode: 0, failures: [] }
              }),
              terminate: () => {},
              unref: () => {},
            }
          },
          processExists: (pid) => running.get(pid) ?? false,
          forceKill: (pid) => running.set(pid, false),
        }),
        /containment|tree-aware|unverified/iu,
        primary,
      )
      assert.equal(running.get(parentPid), false, primary)
      assert.equal(running.get(grandchildPid), false, primary)
      assert.equal(fallbackCalls, 1, primary)
    }
  })

  it('does not verify Windows fallback when a descendant appears after the initial snapshot', async () => {
    const terminateWindows = await loadWindowsTerminationFunction()
    const parentPid = 46
    const capturedGrandchildPid = 146
    const lateGrandchildPid = 246
    const running = new Map([
      [parentPid, true],
      [capturedGrandchildPid, true],
      [lateGrandchildPid, false],
    ])

    await assert.rejects(
      terminateWindows({ pid: parentPid }, 100, {
        startSnapshot: () => ({
          completion: Promise.resolve({
            exitCode: 0,
            pids: [capturedGrandchildPid],
            failures: [],
          }),
          terminate: () => {},
          unref: () => {},
        }),
        startTaskkill: () => ({
          completion: Promise.resolve().then(() => {
            running.set(lateGrandchildPid, true)
            return { exitCode: 5 }
          }),
          terminate: () => {},
          unref: () => {},
        }),
        startFallback: (pids) => ({
          completion: Promise.resolve().then(() => {
            for (const pid of pids) {
              running.set(pid, false)
            }
            return { exitCode: 0, failures: [] }
          }),
          terminate: () => {},
          unref: () => {},
        }),
        processExists: (pid) => running.get(pid) ?? false,
        forceKill: (pid) => running.set(pid, false),
      }),
      /containment|late|tree-aware|unverified/iu,
    )
    assert.equal(running.get(parentPid), false)
    assert.equal(running.get(capturedGrandchildPid), false)
    assert.equal(running.get(lateGrandchildPid), true)
  })

  it('does not treat parent exit as verified when a captured Windows descendant survives', async () => {
    const terminateWindows = await loadWindowsTerminationFunction()
    const parentPid = 43
    const grandchildPid = 143
    const running = new Map([
      [parentPid, true],
      [grandchildPid, true],
    ])
    const forceKilled: number[] = []
    await assert.rejects(
      terminateWindows({ pid: parentPid }, 100, {
        startSnapshot: () => ({
          completion: Promise.resolve({ exitCode: 0, pids: [grandchildPid], failures: [] }),
          terminate: () => {},
          unref: () => {},
        }),
        startTaskkill: () => ({
          completion: Promise.resolve({ exitCode: 1 }),
          terminate: () => {},
          unref: () => {},
        }),
        startFallback: () => ({
          completion: Promise.resolve().then(() => {
            running.set(parentPid, false)
            return { exitCode: 0, failures: [] }
          }),
          terminate: () => {},
          unref: () => {},
        }),
        processExists: (pid) => running.get(pid) ?? false,
        forceKill: (pid) => {
          forceKilled.push(pid)
          running.set(pid, false)
        },
      }),
      /143|descendant|verification/iu,
    )
    assert.ok(forceKilled.includes(grandchildPid))
    assert.equal(running.get(parentPid), false)
    assert.equal(running.get(grandchildPid), false)
  })

  it('reports Windows descendant enumeration and fallback kill failures', async () => {
    const terminateWindows = await loadWindowsTerminationFunction()
    for (const failure of ['enumeration failed for parent 44', 'kill denied for descendant 144']) {
      const parentPid = 44
      const grandchildPid = 144
      const enumerationFailure = failure.startsWith('enumeration')
      const running = new Map([
        [parentPid, true],
        [grandchildPid, true],
      ])
      await assert.rejects(
        terminateWindows({ pid: parentPid }, 100, {
          startSnapshot: () => ({
            completion: Promise.resolve({
              exitCode: enumerationFailure ? 1 : 0,
              pids: enumerationFailure ? [] : [grandchildPid],
              failures: enumerationFailure ? [failure] : [],
            }),
            terminate: () => {},
            unref: () => {},
          }),
          startTaskkill: () => ({
            completion: Promise.resolve({ exitCode: 1 }),
            terminate: () => {},
            unref: () => {},
          }),
          startFallback: (pids) => ({
            completion: Promise.resolve().then(() => {
              running.set(parentPid, false)
              return {
                exitCode: enumerationFailure ? 0 : 1,
                failures: enumerationFailure ? [] : [failure],
                pids,
              }
            }),
            terminate: () => {},
            unref: () => {},
          }),
          processExists: (pid) => running.get(pid) ?? false,
          forceKill: (pid) => running.set(pid, false),
        }),
        new RegExp(failure.replaceAll(' ', '.*'), 'iu'),
      )
    }
  })

  it('uses one total Windows deadline and terminates plus unreferences timed-out helpers', async () => {
    const terminateWindows = await loadWindowsTerminationFunction()
    const parentPid = 45
    const grandchildPid = 145
    const running = new Map([
      [parentPid, true],
      [grandchildPid, true],
    ])
    let taskkillTerminated = false
    let taskkillUnreferenced = false
    let fallbackTerminated = false
    let fallbackUnreferenced = false
    const graceMs = 120
    const startedAt = Date.now()
    await assert.rejects(
      terminateWindows({ pid: parentPid }, graceMs, {
        startSnapshot: () => ({
          completion: Promise.resolve({ exitCode: 0, pids: [grandchildPid], failures: [] }),
          terminate: () => {},
          unref: () => {},
        }),
        startTaskkill: () => ({
          completion: new Promise<FakeWindowsHelperResult>(() => {}),
          terminate: () => {
            taskkillTerminated = true
          },
          unref: () => {
            taskkillUnreferenced = true
          },
        }),
        startFallback: () => ({
          completion: new Promise<FakeWindowsHelperResult>(() => {}),
          terminate: () => {
            fallbackTerminated = true
          },
          unref: () => {
            fallbackUnreferenced = true
          },
        }),
        processExists: (pid) => running.get(pid) ?? false,
        forceKill: (pid) => running.set(pid, false),
      }),
      /deadline|timeout|verified/iu,
    )
    const durationMs = Date.now() - startedAt
    assert.equal(taskkillTerminated, true)
    assert.equal(taskkillUnreferenced, true)
    assert.equal(fallbackTerminated, true)
    assert.equal(fallbackUnreferenced, true)
    assert.ok(
      durationMs <= graceMs + 80,
      `Windows termination exceeded one deadline: ${durationMs}`,
    )
  })

  it('terminates the spawned Windows process tree including grandchildren', {
    skip: process.platform !== 'win32',
  }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rolekit-windows-tree-'))
    const pidPath = join(directory, 'grandchild.pid')
    const controller = new AbortController()
    let grandchildPid: number | undefined
    try {
      const runPromise = runCliProcess({
        command: process.execPath,
        args: [fixturePath, 'spawn-grandchild', pidPath],
        cwd: process.cwd(),
        environment: {},
        signal: controller.signal,
      })
      await waitForFile(pidPath)
      grandchildPid = Number.parseInt(await readFile(pidPath, 'utf8'), 10)
      assert.equal(processExists(grandchildPid), true)

      controller.abort()
      await assert.rejects(runPromise)
      assert.equal(await waitForProcessExit(grandchildPid), true)
    } finally {
      if (grandchildPid !== undefined && processExists(grandchildPid)) {
        await forceKillTree(grandchildPid)
      }
      await rm(directory, { recursive: true, force: true })
    }
  })
})
