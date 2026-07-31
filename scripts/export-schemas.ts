/**
 * Export TypeBox schemas as JSON Schema draft 2020-12 into schemas/json/.
 * Re-running must be zero-diff.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TSchema } from '@sinclair/typebox'
import {
  ExecutorProfileSchema,
  ExecutorReportSchema,
  GatePolicySchema,
  KnowledgeEntrySchema,
  ResultEnvelopeSchema,
  RoleProfileSchema,
  RunEventSchema,
  TaskContractSchema,
  WorkItemSchema,
} from '../packages/core/src/schemas/index.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'schemas', 'json')

const exports: Array<{ filename: string; schema: TSchema }> = [
  { filename: 'task-contract.json', schema: TaskContractSchema },
  { filename: 'result-envelope.json', schema: ResultEnvelopeSchema },
  { filename: 'executor-report.json', schema: ExecutorReportSchema },
  { filename: 'run-event.json', schema: RunEventSchema },
  { filename: 'gate-policy.json', schema: GatePolicySchema },
  { filename: 'role-profile.json', schema: RoleProfileSchema },
  { filename: 'executor-profile.json', schema: ExecutorProfileSchema },
  { filename: 'work-item.json', schema: WorkItemSchema },
  { filename: 'knowledge-entry.json', schema: KnowledgeEntrySchema },
]

/**
 * Builds a stable JSON Schema document from a TypeBox schema.
 */
function toJsonSchemaDocument(schema: TSchema): Record<string, unknown> {
  const clone = structuredClone(schema) as Record<string, unknown>
  // Strip TypeBox internal symbols / non-enumerable keys via JSON round-trip
  const plain = JSON.parse(JSON.stringify(clone)) as Record<string, unknown>
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    ...plain,
  }
}

mkdirSync(outDir, { recursive: true })

for (const item of exports) {
  const document = toJsonSchemaDocument(item.schema)
  const text = `${JSON.stringify(document, null, 2)}\n`
  writeFileSync(join(outDir, item.filename), text, 'utf8')
}
