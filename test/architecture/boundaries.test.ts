import assert from 'node:assert/strict'
import { access, readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { describe, it } from 'node:test'

const root = resolve('.')
const excludedDirectories = new Set(['.git', 'node_modules', 'dist'])

async function collectFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) {
      continue
    }
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)))
    } else if (entry.isFile()) {
      files.push(path)
    }
  }
  return files
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

describe('architecture boundaries', () => {
  it('keeps core independent from Node, adapters, and optional consumers', async () => {
    const files = await collectFiles(resolve('src', 'core'))
    const source = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n')
    assert.doesNotMatch(source, /from\s+["']node:/u)
    assert.doesNotMatch(source, /from\s+["'][^"']*adapters/u)
    assert.doesNotMatch(source, /veritack/iu)
  })

  it('contains no retired brand spelling anywhere in the working repository', async () => {
    const retiredBrand = String.fromCharCode(115, 107, 101, 103)
    const violations: string[] = []
    for (const file of await collectFiles(root)) {
      const content = await readFile(file)
      if (content.toString('utf8').toLowerCase().includes(retiredBrand)) {
        violations.push(relative(root, file))
      }
    }
    assert.deepEqual(violations, [])
  })

  it('does not retain legacy control-plane directories', async () => {
    const removedDirectories = [
      '.rolekit',
      'adapters',
      'dogfood',
      'evals',
      'evidence',
      'packages',
      'profiles',
    ]
    for (const directory of removedDirectories) {
      assert.equal(await exists(resolve(directory)), false, directory)
    }
  })

  it('exports adapters as independent package entry points', async () => {
    const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
    assert.ok(packageJson.exports['./core'])
    assert.ok(packageJson.exports['./pi'])
    assert.ok(packageJson.exports['./cursor'])
    assert.ok(packageJson.exports['./codex'])
    assert.ok(packageJson.exports['./testing'])
  })
})
