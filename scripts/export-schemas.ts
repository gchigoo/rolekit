import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  ExecutorDescriptorSchema,
  RoleSpecSchema,
  RunResultSchema,
  TaskPacketSchema,
} from '../src/core/schemas.ts'

const outputDirectory = resolve('schemas')
const schemas = new Map<string, unknown>([
  ['role-spec.schema.json', RoleSpecSchema],
  ['task-packet.schema.json', TaskPacketSchema],
  ['run-result.schema.json', RunResultSchema],
  ['executor-descriptor.schema.json', ExecutorDescriptorSchema],
])

await rm(outputDirectory, { recursive: true, force: true })
await mkdir(outputDirectory, { recursive: true })
for (const [name, schema] of schemas) {
  await writeFile(resolve(outputDirectory, name), `${JSON.stringify(schema, null, 2)}\n`, 'utf8')
}
