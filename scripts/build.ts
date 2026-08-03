import { spawnSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  createGeneratedSchemaDirectory,
  replaceDirectoryTransactionally,
} from './export-schemas.ts'

const schemasDirectory = resolve('schemas')
const generatedSchemasDirectory = await createGeneratedSchemaDirectory(schemasDirectory)
try {
  await rm(resolve('dist'), { recursive: true, force: true })
  const tscPath = resolve('node_modules', 'typescript', 'bin', 'tsc')
  const result = spawnSync(process.execPath, [tscPath, '-p', 'tsconfig.build.json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'inherit',
  })
  if (result.error !== undefined) {
    throw result.error
  }
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1
  } else {
    await replaceDirectoryTransactionally(generatedSchemasDirectory, schemasDirectory)
  }
} finally {
  await rm(generatedSchemasDirectory, { recursive: true, force: true })
}
