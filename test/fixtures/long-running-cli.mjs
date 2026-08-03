import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const fixtureFilePath = fileURLToPath(import.meta.url)
const mode = process.argv[2]
const args = process.argv.slice(3)

if (args.includes('--version')) {
  process.stdout.write('rolekit-long-running-fixture 1.0.0\n')
  process.exit(0)
}

switch (mode) {
  case 'hang': {
    const markerPath = args[0]
    if (markerPath) {
      await writeFile(markerPath, String(process.pid), 'utf8')
    }
    setInterval(() => {}, 1_000)
    break
  }
  case 'touch': {
    const markerPath = args[0]
    if (!markerPath) {
      throw new Error('touch mode requires a marker path')
    }
    await writeFile(markerPath, 'spawned', 'utf8')
    break
  }
  case 'fail': {
    process.stderr.write(`fixture failure: ${args.join(' ')}\n`)
    process.exitCode = 17
    break
  }
  case 'fail-environment': {
    const key = args[0]
    process.stderr.write(`fixture environment failure: ${key ? process.env[key] ?? '' : ''}\n`)
    process.exitCode = 18
    break
  }
  case 'signal-after-output': {
    const stdout = args[0] ?? ''
    const stderr = args[1] ?? ''
    const signal = args[2] ?? 'SIGTERM'
    await new Promise((resolvePromise) => process.stdout.write(stdout, resolvePromise))
    await new Promise((resolvePromise) => process.stderr.write(stderr, resolvePromise))
    process.kill(process.pid, signal)
    setInterval(() => {}, 1_000)
    break
  }
  case 'output': {
    process.stdout.write('x'.repeat(4_096))
    setInterval(() => {}, 1_000)
    break
  }
  case 'mixed-output': {
    process.stdout.write('o'.repeat(1_048_576))
    process.stderr.write('e'.repeat(1_048_576))
    setInterval(() => {}, 1_000)
    break
  }
  case 'environment': {
    process.stdout.write(
      JSON.stringify({
        allowed: process.env.ROLEKIT_ALLOWED_ENV ?? null,
        inheritedSecret: process.env.ROLEKIT_PARENT_SECRET ?? null,
      }),
    )
    break
  }
  case 'malformed-cursor':
    process.stdout.write(`${JSON.stringify({ type: 'result', result: 'not-json' })}\n`)
    break
  case 'spawn-grandchild':
  case 'spawn-stubborn-grandchild': {
    const pidPath = args[0]
    if (!pidPath) {
      throw new Error(`${mode} mode requires a PID file path`)
    }
    const stubborn = mode === 'spawn-stubborn-grandchild'
    const grandchild = spawn(
      process.execPath,
      [fixtureFilePath, stubborn ? 'stubborn-grandchild' : 'grandchild'],
      {
        stdio: 'ignore',
        windowsHide: true,
      },
    )
    if (grandchild.pid === undefined) {
      throw new Error('grandchild did not receive a PID')
    }
    grandchild.unref()
    await writeFile(pidPath, String(grandchild.pid), 'utf8')
    if (stubborn) {
      process.on('SIGTERM', () => {})
    }
    setInterval(() => {}, 1_000)
    break
  }
  case 'stubborn-grandchild':
    process.on('SIGTERM', () => {})
    setInterval(() => {}, 1_000)
    break
  case 'grandchild':
    setInterval(() => {}, 1_000)
    break
  default:
    throw new Error(`Unknown fixture mode: ${mode}`)
}
