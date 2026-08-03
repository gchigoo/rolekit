import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { describe, it } from 'node:test'

import { loadRolekitConfig } from '../../src/config/index.ts'

const HOST_ISOLATION = {
  userConfig: 'isolated',
  projectInstructions: 'isolated',
  projectResources: 'isolated',
  environment: 'minimal',
  credentials: 'explicit',
} as const

async function withTemporaryDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'rolekit-config-loader-'))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function hostProfile(executorId: string, capabilities: readonly string[]) {
  return {
    mode: 'host',
    executorId,
    transport: 'in-process',
    capabilities,
    pathEnforcement: 'host',
    contextIsolation: HOST_ISOLATION,
  }
}

describe('loadRolekitConfig', () => {
  it('loads one explicit root and merges depth-first by whole map entry with provenance', async () => {
    await withTemporaryDirectory(async (directory) => {
      const basePath = join(directory, 'base.json')
      const childPath = join(directory, 'child.yaml')
      const rootPath = join(directory, 'root.yaml')

      await writeJson(basePath, {
        schema: 'rolekit/config@1',
        roles: {
          implementer: {
            spec: 'roles/base-role.json',
            promptFragments: ['prompts/base.md'],
            executor: 'shared',
          },
        },
        executors: {
          shared: hostProfile('base-host', ['repository.read', 'repository.write']),
        },
      })
      await writeFile(
        childPath,
        [
          'schema: rolekit/config@1',
          'extends:',
          '  - base.json',
          'roles:',
          '  implementer:',
          '    spec: roles/child-role.json',
          '    executor: child',
          'executors:',
          '  child:',
          '    mode: adapter',
          '    adapter: pi',
          '    options:',
          '      tools: [read]',
          '',
        ].join('\n'),
        'utf8',
      )
      await writeFile(
        rootPath,
        [
          'schema: rolekit/config@1',
          'extends: [child.yaml]',
          'roles: {}',
          'executors:',
          '  shared:',
          '    mode: host',
          '    executorId: root-host',
          '    transport: remote',
          '    capabilities: [repository.read]',
          '    pathEnforcement: advisory',
          '    contextIsolation:',
          '      userConfig: unknown',
          '      projectInstructions: unknown',
          '      projectResources: unknown',
          '      environment: unknown',
          '      credentials: unknown',
          '',
        ].join('\n'),
        'utf8',
      )

      const loaded = await loadRolekitConfig(rootPath)
      const canonicalChild = await realpath(childPath)
      const canonicalRoot = await realpath(rootPath)

      assert.equal(loaded.rootPath, canonicalRoot)
      assert.deepEqual(
        loaded.sourcePaths.map((path) => basename(path)),
        ['base.json', 'child.yaml', 'root.yaml'],
      )
      assert.deepEqual(loaded.config.roles.implementer, {
        spec: 'roles/child-role.json',
        executor: 'child',
      })
      assert.deepEqual(loaded.config.executors.shared, {
        mode: 'host',
        executorId: 'root-host',
        transport: 'remote',
        capabilities: ['repository.read'],
        pathEnforcement: 'advisory',
        contextIsolation: {
          userConfig: 'unknown',
          projectInstructions: 'unknown',
          projectResources: 'unknown',
          environment: 'unknown',
          credentials: 'unknown',
        },
      })
      const loadedRole = loaded.roles.implementer
      const loadedProfile = loaded.executors.shared
      assert.ok(loadedRole)
      assert.ok(loadedProfile)
      assert.equal(loadedRole.sourcePath, canonicalChild)
      assert.equal(loadedRole.pointer, '/roles/implementer')
      assert.equal(loadedRole.specPath, join(dirname(canonicalChild), 'roles', 'child-role.json'))
      assert.deepEqual(loadedRole.promptFragmentPaths, [])
      assert.equal(loadedProfile.sourcePath, canonicalRoot)
      assert.equal(loadedProfile.pointer, '/executors/shared')
      assert.equal(Object.isFrozen(loaded), true)
      assert.equal(Object.isFrozen(loaded.config.roles.implementer), true)
    })
  })

  it('detects extends cycles with the complete canonical path chain', async () => {
    await withTemporaryDirectory(async (directory) => {
      const aPath = join(directory, 'a.yaml')
      const bPath = join(directory, 'b.yaml')
      await writeFile(
        aPath,
        'schema: rolekit/config@1\nextends: [b.yaml]\nroles: {}\nexecutors: {}\n',
        'utf8',
      )
      await writeFile(
        bPath,
        'schema: rolekit/config@1\nextends: [a.yaml]\nroles: {}\nexecutors: {}\n',
        'utf8',
      )

      await assert.rejects(loadRolekitConfig(aPath), /a\.yaml -> .*b\.yaml -> .*a\.yaml/u)
    })
  })

  it('rejects a duplicate canonical extends target with both complete discovery chains', async () => {
    await withTemporaryDirectory(async (directory) => {
      const rootPath = join(directory, 'root.yaml')
      await writeFile(
        join(directory, 'shared.yaml'),
        'schema: rolekit/config@1\nroles: {}\nexecutors: {}\n',
        'utf8',
      )
      await writeFile(
        join(directory, 'child.yaml'),
        'schema: rolekit/config@1\nextends: [shared.yaml]\nroles: {}\nexecutors: {}\n',
        'utf8',
      )
      await writeFile(
        rootPath,
        [
          'schema: rolekit/config@1',
          'extends:',
          '  - shared.yaml',
          '  - child.yaml',
          'roles: {}',
          'executors: {}',
          '',
        ].join('\n'),
        'utf8',
      )

      await assert.rejects(loadRolekitConfig(rootPath), (error: unknown) => {
        assert.equal(error instanceof Error, true)
        const message = error instanceof Error ? error.message : ''
        assert.match(message, /root\.yaml -> .*shared\.yaml/u)
        assert.match(message, /root\.yaml -> .*child\.yaml -> .*shared\.yaml/u)
        return true
      })
    })
  })

  it('reports the declaring source path and JSON pointer for invalid config data', async () => {
    await withTemporaryDirectory(async (directory) => {
      const rootPath = join(directory, 'invalid.yaml')
      await writeFile(
        rootPath,
        ['schema: rolekit/config@1', 'roles: {}', 'executors: {}', 'unexpected: true', ''].join(
          '\n',
        ),
        'utf8',
      )

      await assert.rejects(loadRolekitConfig(rootPath), (error: unknown) => {
        assert.equal(error instanceof Error, true)
        const message = error instanceof Error ? error.message : ''
        assert.match(message, /invalid\.yaml/u)
        assert.match(message, /\/unexpected/u)
        return true
      })
    })
  })

  it('rejects role and profile map keys outside the identifier grammar', async () => {
    await withTemporaryDirectory(async (directory) => {
      const rootPath = join(directory, 'invalid-key.yaml')
      await writeFile(
        rootPath,
        [
          'schema: rolekit/config@1',
          'roles:',
          '  bad key:',
          '    spec: role.json',
          '    executor: host',
          'executors:',
          `  host: ${JSON.stringify(hostProfile('host', ['repository.read']))}`,
          '',
        ].join('\n'),
        'utf8',
      )
      await assert.rejects(loadRolekitConfig(rootPath), /\/roles\/bad key/u)
    })
  })

  it('never exposes literal adapter secrets on enumerable loaded-config surfaces', async () => {
    await withTemporaryDirectory(async (directory) => {
      const secret = 'loaded-literal-secret'
      const rootPath = join(directory, 'rolekit.yaml')
      await writeFile(
        rootPath,
        [
          'schema: rolekit/config@1',
          'roles: {}',
          'executors:',
          '  private-profile:',
          '    mode: adapter',
          '    adapter: pi',
          '    options:',
          '      environment:',
          `        XAI_API_KEY: ${secret}`,
          '',
        ].join('\n'),
        'utf8',
      )

      const loaded = await loadRolekitConfig(rootPath)
      assert.doesNotMatch(JSON.stringify(loaded), new RegExp(secret, 'u'))
      assert.doesNotMatch(JSON.stringify(Object.entries(loaded)), new RegExp(secret, 'u'))
      assert.deepEqual(loaded.config.executors['private-profile'], {
        mode: 'adapter',
        adapter: 'pi',
      })
      assert.deepEqual(loaded.executors['private-profile']?.config, {
        mode: 'adapter',
        adapter: 'pi',
      })
    })
  })

  it('reports source-safe YAML and JSON parse locations without source excerpts or token text', async () => {
    await withTemporaryDirectory(async (directory) => {
      const secret = 'parse-error-secret'
      const sources = [
        {
          path: join(directory, 'broken.yaml'),
          text: `schema: rolekit/config@1\nsecret: "${secret}\nroles: {}\nexecutors: {}\n`,
          format: /YAML parse failed/u,
        },
        {
          path: join(directory, 'broken.json'),
          text: `{"schema":"rolekit/config@1","secret":${secret}}`,
          format: /JSON parse failed/u,
        },
      ]
      for (const source of sources) {
        await writeFile(source.path, source.text, 'utf8')
        await assert.rejects(loadRolekitConfig(source.path), (error: unknown) => {
          assert.equal(error instanceof Error, true)
          const message = error instanceof Error ? error.message : ''
          assert.match(message, source.format)
          assert.doesNotMatch(message, new RegExp(secret, 'u'))
          assert.doesNotMatch(message, /secret:/u)
          assert.match(message, /(?:line \d+ column \d+|offset \d+)/u)
          return true
        })
      }
    })
  })

  it('rejects unsupported root file extensions without scanning for alternatives', async () => {
    await withTemporaryDirectory(async (directory) => {
      const rootPath = join(directory, 'rolekit.toml')
      await writeFile(rootPath, 'schema = "rolekit/config@1"\n', 'utf8')
      await assert.rejects(loadRolekitConfig(rootPath), /rolekit\.toml.*unsupported/u)
    })
  })
})
