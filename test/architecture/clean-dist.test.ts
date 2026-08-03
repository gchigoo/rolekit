import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'

import { createIsolatedPackageProject } from './package-fixture.ts'

function npmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function runNpmTest(directory: string): ReturnType<typeof spawnSync> {
  const command = npmCommand()
  return spawnSync(command, ['test'], {
    cwd: directory,
    encoding: 'utf8',
    env: process.env,
    shell: process.platform === 'win32',
  })
}

async function copyPublicExportTest(directory: string): Promise<void> {
  const testDirectory = join(directory, 'test', 'architecture')
  await mkdir(testDirectory, { recursive: true })
  await writeFile(
    join(testDirectory, 'public-exports.test.ts'),
    await readFile('test/architecture/public-exports.test.ts', 'utf8'),
    'utf8',
  )
}

async function writeStaleDist(directory: string): Promise<string> {
  const packageJson = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
    readonly exports: Readonly<Record<string, string | { readonly import: string }>>
  }
  for (const target of Object.values(packageJson.exports)) {
    if (typeof target === 'string') {
      continue
    }
    const path = join(directory, target.import)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, 'export const staleBuild = true\n', 'utf8')
  }
  const marker = join(directory, 'dist', '.stale-output')
  await writeFile(marker, 'stale\n', 'utf8')
  return marker
}

describe('test lifecycle build ordering', () => {
  it('builds current output before self-reference tests when dist is absent', async () => {
    const project = await createIsolatedPackageProject('rolekit-clean-dist-')
    try {
      await copyPublicExportTest(project.directory)
      const result = runNpmTest(project.directory)
      assert.equal(
        result.status,
        0,
        `npm test failed without dist:\n${result.stdout}\n${result.stderr}`,
      )
      await access(join(project.directory, 'dist', 'index.js'))
    } finally {
      await project.cleanup()
    }
  })

  it('cleans stale output before self-reference tests', async () => {
    const project = await createIsolatedPackageProject('rolekit-stale-dist-')
    try {
      await copyPublicExportTest(project.directory)
      const marker = await writeStaleDist(project.directory)
      const result = runNpmTest(project.directory)
      assert.equal(
        result.status,
        0,
        `npm test failed with stale dist:\n${result.stdout}\n${result.stderr}`,
      )
      await assert.rejects(access(marker), { code: 'ENOENT' })
    } finally {
      await project.cleanup()
    }
  })
})
