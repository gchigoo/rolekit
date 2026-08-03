import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const packageName = '@gchigoo/rolekit'
const codeSubpaths = [
  '.',
  './core',
  './config',
  './adapter-cli',
  './pi',
  './pi-rpc',
  './cursor',
  './codex',
  './testing',
] as const
const schemaSubpaths = [
  './schemas/role-spec.v1',
  './schemas/task-packet.v1',
  './schemas/executor-descriptor.v1',
  './schemas/executor-descriptor.v2',
  './schemas/config.v1',
  './schemas/execution-contract.v1',
  './schemas/execution-plan-content.v1',
  './schemas/execution-plan.v1',
  './schemas/execution-receipt.v1',
  './schemas/run-result.v1',
  './schemas/run-result.v2',
  './schemas/run-result.latest',
] as const
const expectedExports = [...codeSubpaths, ...schemaSubpaths]

function packageSpecifier(subpath: (typeof expectedExports)[number]): string {
  return subpath === '.' ? packageName : `${packageName}/${subpath.slice(2)}`
}

async function loadJsonExport(subpath: (typeof schemaSubpaths)[number]): Promise<unknown> {
  const resolved = import.meta.resolve(packageSpecifier(subpath))
  return JSON.parse(await readFile(fileURLToPath(resolved), 'utf8'))
}

async function loadRepositorySchema(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`../../schemas/${name}`, import.meta.url), 'utf8'))
}

describe('stable public package exports', () => {
  it('exports exactly the documented stable entry points', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { exports: Readonly<Record<string, unknown>> }
    assert.deepEqual(Object.keys(packageJson.exports), expectedExports)
  })

  for (const subpath of codeSubpaths) {
    it(`imports ${subpath}`, async () => {
      const imported = await import(packageSpecifier(subpath))
      assert.equal(typeof imported, 'object')
    })
  }

  for (const subpath of schemaSubpaths) {
    it(`loads ${subpath}`, async () => {
      const schema = await loadJsonExport(subpath)
      assert.equal(typeof schema, 'object')
      assert.notEqual(schema, null)
    })
  }

  it('keeps every historical schema alias on its established version', async () => {
    for (const [alias, versioned] of [
      ['role-spec.schema.json', 'role-spec.v1.schema.json'],
      ['task-packet.schema.json', 'task-packet.v1.schema.json'],
      ['executor-descriptor.schema.json', 'executor-descriptor.v2.schema.json'],
      ['run-result.schema.json', 'run-result.v1.schema.json'],
      ['run-result.latest.schema.json', 'run-result.v2.schema.json'],
    ] as const) {
      assert.deepEqual(await loadRepositorySchema(alias), await loadRepositorySchema(versioned))
    }
  })
})
