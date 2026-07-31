import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { validateSuperpowersGate } from '../../src/adapters/superpowers/gate.ts'
import { MigrationError } from '../../src/types.ts'

const fixtureRoot = join(
  fileURLToPath(new URL('../..', import.meta.url)),
  'fixtures/superpowers-5.1.3',
)

describe('superpowers gate', () => {
  it('passes on fixtures/superpowers-5.1.3 with 14 slugs', async () => {
    const result = await validateSuperpowersGate(fixtureRoot)
    assert.equal(result.pluginVersion, '5.1.3')
    assert.equal(result.skillSlugs.length, 14)
    assert.ok(result.licenseText.includes('MIT License'))
  })

  it('fails on version mismatch', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'superpowers-gate-'))
    await mkdir(join(tempRoot, '.codex-plugin'), { recursive: true })
    await mkdir(join(tempRoot, 'skills', 'brainstorming'), { recursive: true })
    await writeFile(
      join(tempRoot, '.codex-plugin', 'plugin.json'),
      JSON.stringify({ name: 'superpowers', version: '9.9.9' }),
    )
    await writeFile(
      join(tempRoot, 'LICENSE'),
      'MIT License\nPermission is hereby granted, free of charge\nTHE SOFTWARE IS PROVIDED "AS IS"',
    )
    await writeFile(join(tempRoot, 'skills', 'brainstorming', 'SKILL.md'), '# test\n')

    await assert.rejects(
      () => validateSuperpowersGate(tempRoot),
      (error: unknown) => {
        assert.ok(error instanceof MigrationError)
        assert.equal(error.code, 'migration_source_version_unsupported')
        return true
      },
    )
  })

  it('fails on invalid license', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'superpowers-gate-'))
    await mkdir(join(tempRoot, '.codex-plugin'), { recursive: true })
    await writeFile(
      join(tempRoot, '.codex-plugin', 'plugin.json'),
      JSON.stringify({ name: 'superpowers', version: '5.1.3' }),
    )
    await writeFile(join(tempRoot, 'LICENSE'), 'All Rights Reserved')

    await assert.rejects(
      () => validateSuperpowersGate(tempRoot),
      (error: unknown) => {
        assert.ok(error instanceof MigrationError)
        assert.equal(error.code, 'migration_license_invalid')
        return true
      },
    )
  })
})
