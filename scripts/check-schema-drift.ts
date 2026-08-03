import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { compareSchemaDirectories, writeSchemaTree } from './export-schemas.ts'

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'rolekit-schema-drift-'))
try {
  const generatedDirectory = join(temporaryDirectory, 'schemas')
  await writeSchemaTree(generatedDirectory)
  const differences = await compareSchemaDirectories(generatedDirectory, resolve('schemas'))
  if (differences.length > 0) {
    throw new Error(`Generated schemas are out of date:\n${differences.join('\n')}`)
  }
  console.log('Generated schemas match schemas/.')
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
