import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

import { createControlledNpmEnvironment } from './npm-environment.ts'

const root = resolve('.')
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
const legacySchemaFiles = [
  'role-spec.schema.json',
  'task-packet.schema.json',
  'executor-descriptor.schema.json',
  'run-result.schema.json',
] as const
const versionedSchemaFiles = schemaSubpaths.map(
  (subpath) => `${subpath.slice('./schemas/'.length)}.schema.json`,
)

interface PackResult {
  readonly filename: string
  readonly files: readonly { readonly path: string }[]
}

function run(
  command: string,
  args: readonly string[],
  cwd = root,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: environment,
    shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
  })
  if (result.error !== undefined) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed (${result.status ?? 'signal'}): ${command} ${args.join(' ')}`,
        result.stdout,
        result.stderr,
      ]
        .filter((part) => part.length > 0)
        .join('\n'),
    )
  }
  return result.stdout
}

function npmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function packageSpecifier(subpath: string): string {
  return subpath === '.' ? packageName : `${packageName}/${subpath.slice(2)}`
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'rolekit-package-test-'))
try {
  const npmConfigDirectory = join(temporaryDirectory, 'npm-config')
  const npmUserConfig = join(npmConfigDirectory, 'user.npmrc')
  const npmGlobalConfig = join(npmConfigDirectory, 'global.npmrc')
  await mkdir(npmConfigDirectory)
  await Promise.all([
    writeFile(npmUserConfig, '# Isolated RoleKit package test npm config.\n', 'utf8'),
    writeFile(npmGlobalConfig, '# Isolated RoleKit package test npm config.\n', 'utf8'),
  ])
  const npmEnvironment = createControlledNpmEnvironment(process.env, {
    userConfig: npmUserConfig,
    globalConfig: npmGlobalConfig,
    cache: join(temporaryDirectory, 'npm-cache'),
  })

  run(npmCommand(), ['run', 'build'], root, npmEnvironment)

  const packOutput = run(
    npmCommand(),
    [
      'pack',
      '--json',
      '--ignore-scripts',
      '--dry-run=false',
      '--workspaces=false',
      '--include-workspace-root=false',
      '--pack-destination',
      temporaryDirectory,
    ],
    root,
    npmEnvironment,
  )
  const packResults = JSON.parse(packOutput) as readonly PackResult[]
  assert.equal(packResults.length, 1, 'npm pack must produce exactly one tarball')
  const packResult = packResults[0]
  assert.ok(packResult)
  const tarball = join(temporaryDirectory, basename(packResult.filename))
  await access(tarball)

  const consumerDirectory = join(temporaryDirectory, 'consumer')
  await mkdir(consumerDirectory)
  await writeFile(
    join(consumerDirectory, 'package.json'),
    `${JSON.stringify({ name: 'rolekit-package-test-consumer', private: true, type: 'module' }, null, 2)}\n`,
  )
  run(
    npmCommand(),
    [
      'install',
      '--ignore-scripts',
      '--dry-run=false',
      '--global=false',
      '--location=project',
      '--prefix',
      consumerDirectory,
      '--package-lock=false',
      '--package-lock-only=false',
      '--workspaces=false',
      '--include-workspace-root=false',
      '--install-links=true',
      '--no-audit',
      '--no-fund',
      tarball,
    ],
    consumerDirectory,
    npmEnvironment,
  )

  const consumerNodeModulesDirectory = join(consumerDirectory, 'node_modules')
  const installedPackageDirectory = join(consumerNodeModulesDirectory, ...packageName.split('/'))
  await Promise.all([access(consumerNodeModulesDirectory), access(installedPackageDirectory)])
  const [consumerRealPath, installedRealPath] = await Promise.all([
    realpath(consumerDirectory),
    realpath(installedPackageDirectory),
  ])
  const installedRelativePath = relative(consumerRealPath, installedRealPath)
  assert.ok(
    installedRelativePath.length > 0 &&
      installedRelativePath !== '..' &&
      !installedRelativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
      !isAbsolute(installedRelativePath),
    `installed package escaped temporary consumer: ${installedRealPath}`,
  )

  const consumerTest = `
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const codeSpecifiers = ${JSON.stringify(codeSubpaths.map(packageSpecifier))}
const schemaSpecifiers = ${JSON.stringify(schemaSubpaths.map(packageSpecifier))}
const failures = []
for (const specifier of codeSpecifiers) {
  try {
    await import(specifier)
  } catch (error) {
    failures.push(specifier + ': ' + (error instanceof Error ? error.message : String(error)))
  }
}
for (const specifier of schemaSpecifiers) {
  try {
    const resolved = import.meta.resolve(specifier)
    JSON.parse(await readFile(fileURLToPath(resolved), 'utf8'))
  } catch (error) {
    failures.push(specifier + ': ' + (error instanceof Error ? error.message : String(error)))
  }
}
if (failures.length > 0) {
  throw new Error('Public package entry failures:\\n' + failures.join('\\n'))
}
`
  const consumerTestPath = join(consumerDirectory, 'verify-package.mjs')
  await writeFile(consumerTestPath, consumerTest, 'utf8')
  run(process.execPath, [consumerTestPath], consumerDirectory)

  const installedSchemaDirectory = join(installedPackageDirectory, 'schemas')
  for (const schemaFile of await readdir(installedSchemaDirectory)) {
    assert.match(schemaFile, /\.schema\.json$/u)
    JSON.parse(await readFile(join(installedSchemaDirectory, schemaFile), 'utf8'))
  }

  for (const [alias, versioned] of [
    ['role-spec.schema.json', 'role-spec.v1.schema.json'],
    ['task-packet.schema.json', 'task-packet.v1.schema.json'],
    ['executor-descriptor.schema.json', 'executor-descriptor.v2.schema.json'],
    ['run-result.schema.json', 'run-result.v1.schema.json'],
    ['run-result.latest.schema.json', 'run-result.v2.schema.json'],
  ] as const) {
    assert.deepEqual(
      JSON.parse(await readFile(join(installedSchemaDirectory, alias), 'utf8')),
      JSON.parse(await readFile(join(installedSchemaDirectory, versioned), 'utf8')),
    )
  }

  const cliCommand = join(
    consumerDirectory,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'rolekit.cmd' : 'rolekit',
  )
  await access(cliCommand)
  const help = run(cliCommand, ['--help'], consumerDirectory)
  assert.match(help, /rolekit/u)
  const version = run(cliCommand, ['--version'], consumerDirectory).trim()
  const installedPackageJson = JSON.parse(
    await readFile(join(installedPackageDirectory, 'package.json'), 'utf8'),
  ) as { version: string }
  assert.equal(version, installedPackageJson.version)

  const packedPaths = new Set(packResult.files.map((file) => file.path))
  for (const requiredPath of [
    'package.json',
    'bin/rolekit.js',
    'dist/index.js',
    'dist/index.d.ts',
    'dist/core/index.js',
    'dist/config/index.js',
    'dist/adapters/cli/index.js',
    'dist/adapters/pi/index.js',
    'dist/adapters/pi-rpc/index.js',
    'dist/adapters/cursor/index.js',
    'dist/adapters/codex/index.js',
    'dist/testing/index.js',
    ...legacySchemaFiles.map((name) => `schemas/${name}`),
    ...versionedSchemaFiles.map((name) => `schemas/${name}`),
  ]) {
    assert.ok(packedPaths.has(requiredPath), `tarball is missing ${requiredPath}`)
  }
  console.log('Verified materialized local consumer inside package-test temporary state.')
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
