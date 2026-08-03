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

  it('keeps hardcoded built-in adapter imports and legacy routing in composition only', async () => {
    const configFiles = await collectFiles(resolve('src', 'config'))
    const configSource = (
      await Promise.all(configFiles.map((file) => readFile(file, 'utf8')))
    ).join('\n')
    assert.doesNotMatch(configSource, /from\s+["'][^"']*adapters\/(?:pi|cursor|codex)/u)

    const composition = await readFile(resolve('src', 'composition.ts'), 'utf8')
    assert.match(composition, /adapters\/pi/u)
    assert.match(composition, /adapters\/cursor/u)
    assert.match(composition, /adapters\/codex/u)
    assert.match(composition, /UnknownBuiltInAdapterError/u)

    const cli = await readFile(resolve('src', 'cli.ts'), 'utf8')
    assert.doesNotMatch(cli, /\[['"]pi['"],\s*['"]cursor['"],\s*['"]codex['"]\]/u)
    assert.doesNotMatch(cli, /<pi\|cursor\|codex>/u)
  })

  it('documents plan sensitivity and extracting compile envelope data in both languages', async () => {
    const english = await readFile(resolve('README.md'), 'utf8')
    assert.match(english, /exclude resolved credentials/iu)
    assert.match(
      english,
      /complete normalized\s+role, task, input, context, constraints, and acceptance-criteria snapshots/iu,
    )
    assert.match(english, /potentially sensitive/iu)
    assert.match(english, /extract\s+and\s+persist\s+only\s+`data`/iu)
    assert.match(english, /not the whole CLI envelope/iu)

    const chinese = await readFile(resolve('README.zh-CN.md'), 'utf8')
    assert.match(chinese, /不包含已解析的凭据/u)
    assert.match(
      chinese,
      /完整的规范化 role、task、input、context、constraints 和 acceptance criteria 快照/u,
    )
    assert.match(chinese, /潜在敏感数据/u)
    assert.match(chinese, /只提取并持久化 `data`/u)
    assert.match(chinese, /不要保存整个 CLI envelope/u)
  })

  it('exports core, config, adapter, and testing entry points independently', async () => {
    const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
    assert.ok(packageJson.exports['./core'])
    assert.ok(packageJson.exports['./config'])
    assert.ok(packageJson.exports['./adapter-cli'])
    assert.ok(packageJson.exports['./pi'])
    assert.ok(packageJson.exports['./pi-rpc'])
    assert.ok(packageJson.exports['./cursor'])
    assert.ok(packageJson.exports['./codex'])
    assert.ok(packageJson.exports['./testing'])
  })

  it('keeps portable configuration contracts runtime-neutral', async () => {
    const contractSource = (
      await Promise.all(
        ['src/config/schemas.ts', 'src/config/types.ts'].map((file) =>
          readFile(resolve(file), 'utf8'),
        ),
      )
    ).join('\n')
    assert.doesNotMatch(contractSource, /from\s+["']node:/u)
    assert.doesNotMatch(contractSource, /from\s+["'][^"']*adapters/u)
  })

  it('documents the host-owned execution boundary and security limitations', async () => {
    const architecture = await readFile(resolve('docs/architecture.md'), 'utf8')
    assert.match(architecture, /Host harness \(outside RoleKit\)/u)
    assert.match(architecture, /host-native executor OR bundled adapter/u)
    assert.match(architecture, /compile → receipt → finalize/u)
    assert.match(architecture, /do not need host adapters merely to call RoleKit/u)

    const security = await readFile(resolve('docs/security-model.md'), 'utf8')
    assert.match(security, /not proof of sandboxing/u)
    assert.match(security, /not signatures/u)
    assert.match(security, /unsigned host attestations/u)
    assert.match(security, /unknown.*remains `unknown`/u)
    assert.match(security, /Ambient environment inheritance is an explicit insecure opt-in/u)
    assert.match(security, /potentially sensitive/u)
    assert.match(security, /transformed or encoded secret values/u)
    assert.match(security, /Raw untrusted repository instructions/u)
    assert.match(security, /Strong isolation remains the host's responsibility/u)
  })

  it('keeps publication behind explicit owner approval', async () => {
    const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
    assert.equal(packageJson.private, true)
    assert.equal(packageJson.packageManager, 'npm@11.16.0')
    assert.equal(packageJson.license, undefined)

    const readme = await readFile(resolve('README.md'), 'utf8')
    assert.match(readme, /Apache-2\.0 is the recommended default/u)
    assert.match(readme, /product\/legal decision/u)
    assert.match(readme, /Only then remove `private` and publish/u)
    assert.match(readme, /explicit owner approval/u)
  })
})
