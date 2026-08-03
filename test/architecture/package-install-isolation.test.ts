import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, rm } from 'node:fs/promises'
import { describe, it } from 'node:test'

import { createIsolatedPackageProject } from './package-fixture.ts'

describe('temporary package consumer npm isolation', () => {
  it('materializes a local consumer and creates no inherited global/prefix state', async () => {
    const project = await createIsolatedPackageProject('rolekit-hostile-npm-')
    const externalPrefix = `${project.directory}-external-prefix`
    try {
      const result = spawnSync(process.execPath, ['scripts/test-package.ts'], {
        cwd: project.directory,
        encoding: 'utf8',
        env: {
          ...process.env,
          npm_config_global: 'true',
          NPM_CONFIG_PACKAGE_LOCK_ONLY: 'true',
          npm_config_prefix: externalPrefix,
          Npm_Config_Location: 'global',
          npm_config_workspaces: 'true',
          NPM_CONFIG_DRY_RUN: 'true',
          npm_config_workspace: 'hostile-workspace',
        },
      })
      assert.equal(
        result.status,
        0,
        `package test escaped or failed to materialize locally:\n${result.stdout}\n${result.stderr}`,
      )
      assert.match(result.stdout, /Verified materialized local consumer/u)
      await assert.rejects(access(externalPrefix), { code: 'ENOENT' })
    } finally {
      await project.cleanup()
      await rm(externalPrefix, { recursive: true, force: true })
    }
  })

  it('preserves only explicit package-retrieval npm configuration', async () => {
    const module = await import('../../scripts/npm-environment.ts')
    const controlled = module.createControlledNpmEnvironment(
      {
        PATH: process.env.PATH,
        npm_config_global: 'true',
        NPM_CONFIG_PACKAGE_LOCK_ONLY: 'true',
        Npm_Config_Location: 'global',
        npm_config_prefix: '/hostile-prefix',
        npm_config_registry: 'https://registry.example.test/',
        NPM_CONFIG_HTTPS_PROXY: 'https://proxy.example.test/',
        npm_config_cafile: '/safe/ca.pem',
        npm_config_always_auth: 'true',
        NODE_AUTH_TOKEN: 'token-from-supported-channel',
      },
      {
        userConfig: '/controlled/user.npmrc',
        globalConfig: '/controlled/global.npmrc',
      },
    )

    assert.equal(controlled.npm_config_global, undefined)
    assert.equal(controlled.NPM_CONFIG_PACKAGE_LOCK_ONLY, undefined)
    assert.equal(controlled.Npm_Config_Location, undefined)
    assert.equal(controlled.npm_config_prefix, undefined)
    assert.equal(controlled.npm_config_registry, 'https://registry.example.test/')
    assert.equal(controlled.NPM_CONFIG_HTTPS_PROXY, 'https://proxy.example.test/')
    assert.equal(controlled.npm_config_cafile, '/safe/ca.pem')
    assert.equal(controlled.npm_config_always_auth, 'true')
    assert.equal(controlled.NODE_AUTH_TOKEN, 'token-from-supported-channel')
    assert.equal(controlled.NPM_CONFIG_USERCONFIG, '/controlled/user.npmrc')
    assert.equal(controlled.NPM_CONFIG_GLOBALCONFIG, '/controlled/global.npmrc')
  })
})
