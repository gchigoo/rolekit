import { randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { RolekitConfigSchema } from '../src/config/schemas.ts'
import {
  ExecutionContractSchema,
  ExecutionPlanContentSchema,
  ExecutionPlanSchema,
  ExecutionReceiptSchema,
  ExecutorDescriptorSchema,
  ExecutorDescriptorV1Schema,
  ExecutorDescriptorV2Schema,
  LatestRunResultSchema,
  RoleSpecSchema,
  RunResultSchema,
  RunResultV1Schema,
  RunResultV2Schema,
  TaskPacketSchema,
} from '../src/core/schemas.ts'

export const SCHEMAS: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  ['config.v1.schema.json', RolekitConfigSchema],
  ['role-spec.schema.json', RoleSpecSchema],
  ['role-spec.v1.schema.json', RoleSpecSchema],
  ['task-packet.schema.json', TaskPacketSchema],
  ['task-packet.v1.schema.json', TaskPacketSchema],
  ['run-result.schema.json', RunResultSchema],
  ['run-result.v1.schema.json', RunResultV1Schema],
  ['run-result.v2.schema.json', RunResultV2Schema],
  ['run-result.latest.schema.json', LatestRunResultSchema],
  ['execution-contract.v1.schema.json', ExecutionContractSchema],
  ['execution-plan-content.v1.schema.json', ExecutionPlanContentSchema],
  ['execution-plan.v1.schema.json', ExecutionPlanSchema],
  ['execution-receipt.v1.schema.json', ExecutionReceiptSchema],
  ['executor-descriptor.schema.json', ExecutorDescriptorSchema],
  ['executor-descriptor.v1.schema.json', ExecutorDescriptorV1Schema],
  ['executor-descriptor.v2.schema.json', ExecutorDescriptorV2Schema],
])

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function collectRelativeFiles(
  directory: string,
  rootDirectory = directory,
): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectRelativeFiles(path, rootDirectory)))
    } else if (entry.isFile()) {
      files.push(relative(rootDirectory, path))
    }
  }
  return files.sort()
}

export async function writeSchemaTree(
  outputDirectory: string,
  schemas: ReadonlyMap<string, unknown> = SCHEMAS,
): Promise<void> {
  await mkdir(outputDirectory, { recursive: true })
  for (const [name, schema] of schemas) {
    const path = resolve(outputDirectory, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(schema, null, 2)}\n`, 'utf8')
  }
}

export async function createGeneratedSchemaDirectory(
  targetDirectory: string,
  schemas: ReadonlyMap<string, unknown> = SCHEMAS,
): Promise<string> {
  const parentDirectory = dirname(resolve(targetDirectory))
  await mkdir(parentDirectory, { recursive: true })
  const generatedDirectory = await mkdtemp(
    join(parentDirectory, `.${basename(targetDirectory)}.generated-`),
  )
  try {
    await writeSchemaTree(generatedDirectory, schemas)
    return generatedDirectory
  } catch (error: unknown) {
    await rm(generatedDirectory, { recursive: true, force: true })
    throw error
  }
}

export async function replaceDirectoryTransactionally(
  generatedDirectory: string,
  targetDirectory: string,
): Promise<void> {
  const absoluteTarget = resolve(targetDirectory)
  const backupDirectory = join(
    dirname(absoluteTarget),
    `.${basename(absoluteTarget)}.backup-${randomUUID()}`,
  )
  const hadExistingTarget = await pathExists(absoluteTarget)
  let movedExistingTarget = false
  let installedGeneratedTree = false

  try {
    if (hadExistingTarget) {
      await rename(absoluteTarget, backupDirectory)
      movedExistingTarget = true
    }
    try {
      await rename(generatedDirectory, absoluteTarget)
      installedGeneratedTree = true
    } catch (installError: unknown) {
      if (movedExistingTarget) {
        try {
          await rename(backupDirectory, absoluteTarget)
          movedExistingTarget = false
        } catch (rollbackError: unknown) {
          throw new AggregateError(
            [installError, rollbackError],
            'Schema installation failed and the previous tree could not be restored.',
          )
        }
      }
      throw installError
    }
  } finally {
    if (installedGeneratedTree && movedExistingTarget) {
      await rm(backupDirectory, { recursive: true, force: true })
    }
  }
}

export async function generateSchemasAtomically(
  targetDirectory: string,
  schemas: ReadonlyMap<string, unknown> = SCHEMAS,
): Promise<void> {
  const generatedDirectory = await createGeneratedSchemaDirectory(targetDirectory, schemas)
  try {
    await replaceDirectoryTransactionally(generatedDirectory, targetDirectory)
  } finally {
    await rm(generatedDirectory, { recursive: true, force: true })
  }
}

export async function compareSchemaDirectories(
  generatedDirectory: string,
  checkedDirectory: string,
): Promise<readonly string[]> {
  if (!(await pathExists(checkedDirectory))) {
    return ['missing schema directory']
  }
  const [generatedFiles, checkedFiles] = await Promise.all([
    collectRelativeFiles(generatedDirectory),
    collectRelativeFiles(checkedDirectory),
  ])
  const generatedSet = new Set(generatedFiles)
  const checkedSet = new Set(checkedFiles)
  const differences: string[] = []

  for (const file of generatedFiles) {
    if (!checkedSet.has(file)) {
      differences.push(`missing: ${file}`)
      continue
    }
    const [generated, checked] = await Promise.all([
      readFile(join(generatedDirectory, file)),
      readFile(join(checkedDirectory, file)),
    ])
    if (!generated.equals(checked)) {
      differences.push(`changed: ${file}`)
    }
  }
  for (const file of checkedFiles) {
    if (!generatedSet.has(file)) {
      differences.push(`unexpected: ${file}`)
    }
  }
  return differences
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1])
if (invokedPath === fileURLToPath(import.meta.url)) {
  await generateSchemasAtomically(resolve('schemas'))
}
