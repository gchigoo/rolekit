import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import {
  compareSchemaDirectories,
  generateSchemasAtomically,
  replaceDirectoryTransactionally,
  writeSchemaTree,
} from '../../scripts/export-schemas.ts'

describe('schema generation transactions', () => {
  it('leaves the existing schema tree intact when generation fails', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'rolekit-schema-failure-'))
    const schemasDirectory = join(temporaryDirectory, 'schemas')
    try {
      await mkdir(schemasDirectory)
      await writeFile(join(schemasDirectory, 'sentinel.json'), '{"stable":true}\n', 'utf8')
      await assert.rejects(
        generateSchemasAtomically(
          schemasDirectory,
          new Map<string, unknown>([['broken.schema.json', { unsupported: 1n }]]),
        ),
        /BigInt/u,
      )
      assert.equal(
        await readFile(join(schemasDirectory, 'sentinel.json'), 'utf8'),
        '{"stable":true}\n',
      )
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true })
    }
  })

  it('rolls back the prior tree if installing the generated directory fails', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'rolekit-schema-rollback-'))
    const schemasDirectory = join(temporaryDirectory, 'schemas')
    try {
      await mkdir(schemasDirectory)
      await writeFile(join(schemasDirectory, 'sentinel.json'), '{"stable":true}\n', 'utf8')
      await assert.rejects(
        replaceDirectoryTransactionally(
          join(temporaryDirectory, 'missing-generated-tree'),
          schemasDirectory,
        ),
      )
      assert.equal(
        await readFile(join(schemasDirectory, 'sentinel.json'), 'utf8'),
        '{"stable":true}\n',
      )
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true })
    }
  })

  it('reports drift by comparing fresh output without changing the checked tree', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'rolekit-schema-drift-'))
    const generatedDirectory = join(temporaryDirectory, 'generated')
    const checkedDirectory = join(temporaryDirectory, 'checked')
    try {
      const entries = new Map<string, unknown>([['example.schema.json', { type: 'string' }]])
      await writeSchemaTree(generatedDirectory, entries)
      await writeSchemaTree(checkedDirectory, entries)
      assert.deepEqual(await compareSchemaDirectories(generatedDirectory, checkedDirectory), [])

      await writeFile(join(checkedDirectory, 'example.schema.json'), '{"type":"number"}\n', 'utf8')
      const before = await readFile(join(checkedDirectory, 'example.schema.json'), 'utf8')
      assert.deepEqual(await compareSchemaDirectories(generatedDirectory, checkedDirectory), [
        'changed: example.schema.json',
      ])
      assert.equal(await readFile(join(checkedDirectory, 'example.schema.json'), 'utf8'), before)
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true })
    }
  })
})
