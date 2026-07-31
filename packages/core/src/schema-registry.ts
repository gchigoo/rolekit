import type { TSchema } from '@sinclair/typebox'
import {
  ExecutorProfileSchema,
  ExecutorReportSchema,
  executorProfileSemanticRules,
  executorReportSemanticRules,
  GatePolicySchema,
  GateRecordFileSchema,
  gatePolicySemanticRules,
  gateRecordSemanticRules,
  type KnowledgeEntryPayload,
  KnowledgeEntrySchema,
  knowledgeEntrySemanticRules,
  ResultEnvelopeSchema,
  RoleProfileSchema,
  RunEventSchema,
  resultEnvelopeSemanticRules,
  roleProfileSemanticRules,
  runEventSemanticRules,
  TaskContractSchema,
  taskContractSemanticRules,
  WorkItemSchema,
  workItemSemanticRules,
} from './schemas/index.ts'
import type { SemanticIssue } from './types.ts'

/** Registry entry for a frozen contract schema. */
export interface SchemaRegistryEntry {
  schema: TSchema
  /** When true, structural validation runs against data.frontmatter. */
  knowledgePayload?: boolean
  semanticRules: (data: unknown) => SemanticIssue[]
}

/**
 * kind → schema + semanticRules registry shared by validate and migrate.
 */
export const schemaRegistry: Map<string, SchemaRegistryEntry> = new Map([
  [
    'rolekit/task-contract@1',
    {
      schema: TaskContractSchema,
      semanticRules: (data) => taskContractSemanticRules(data as never),
    },
  ],
  [
    'rolekit/result-envelope@1',
    {
      schema: ResultEnvelopeSchema,
      semanticRules: (data) => resultEnvelopeSemanticRules(data as never),
    },
  ],
  [
    'rolekit/executor-report@1',
    {
      schema: ExecutorReportSchema,
      semanticRules: (data) => executorReportSemanticRules(data as never),
    },
  ],
  [
    'rolekit/run-event@1',
    {
      schema: RunEventSchema,
      semanticRules: (data) => runEventSemanticRules(data as never),
    },
  ],
  [
    'rolekit/gate-policy@1',
    {
      schema: GatePolicySchema,
      semanticRules: (data) => gatePolicySemanticRules(data as never),
    },
  ],
  [
    'rolekit/gate-record@1',
    {
      schema: GateRecordFileSchema,
      semanticRules: (data) => gateRecordSemanticRules(data as never),
    },
  ],
  [
    'rolekit/role-profile@1',
    {
      schema: RoleProfileSchema,
      semanticRules: (data) => roleProfileSemanticRules(data as never),
    },
  ],
  [
    'rolekit/executor-profile@1',
    {
      schema: ExecutorProfileSchema,
      semanticRules: (data) => executorProfileSemanticRules(data as never),
    },
  ],
  [
    'rolekit/work-item@1',
    {
      schema: WorkItemSchema,
      semanticRules: (data) => workItemSemanticRules(data as never),
    },
  ],
  [
    'rolekit/knowledge-entry@1',
    {
      schema: KnowledgeEntrySchema,
      knowledgePayload: true,
      semanticRules: (data) => knowledgeEntrySemanticRules(data as KnowledgeEntryPayload),
    },
  ],
])
