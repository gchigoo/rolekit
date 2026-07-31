#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'

const args = process.argv.slice(2)
if (args.length !== 2) process.exit(2)
const [relativeFile, expectedHash] = args
if (!relativeFile || !/^[0-9a-f]{64}$/.test(expectedHash)) process.exit(2)
if (
  isAbsolute(relativeFile) ||
  /^[A-Za-z]:[\\/]/.test(relativeFile) ||
  relativeFile.split(/[\\/]/).includes('..')
)
  process.exit(2)

const root = realpathSync(process.cwd())
const target = resolve(root, relativeFile)
if (!target.startsWith(`${root}${sep}`)) process.exit(2)
let cursor = root
for (const segment of relativeFile.split(/[\\/]/)) {
  if (!segment || segment === '.') process.exit(2)
  cursor = resolve(cursor, segment)
  const stat = lstatSync(cursor)
  if (stat.isSymbolicLink()) process.exit(2)
}
if (!lstatSync(target).isFile() || realpathSync(target) !== target) process.exit(2)

const raw = readFileSync(target)
let text
try {
  text = new TextDecoder('utf-8', { fatal: true }).decode(raw)
} catch {
  process.exit(1)
}
const lines = text.split('\n')
if (
  lines.length !== 3 ||
  lines[2] !== '' ||
  lines[0] !== 'rolekit-steer/v1' ||
  !lines[1].startsWith('nonce=')
)
  process.exit(1)
const nonce = lines[1].slice(6)
if (!/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) process.exit(1)
const expected = Buffer.from(`rolekit-steer/v1\nnonce=${nonce}\n`, 'utf8')
if (!raw.equals(expected)) process.exit(1)
const actualHash = createHash('sha256').update(nonce, 'utf8').digest('hex')
process.exit(actualHash === expectedHash ? 0 : 1)
