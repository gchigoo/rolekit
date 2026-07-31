import { ExecutorDescriptorSchema, ExecutorResponseSchema } from '../core/schemas.ts'
import type {
  ExecutionContext,
  ExecutorAdapter,
  ExecutorDescriptor,
  ExecutorResponse,
  JsonSchema,
  RoleSpec,
  TaskPacket,
} from '../core/types.ts'
import { validateValue } from '../core/validation.ts'

export interface AdapterConformanceInput {
  readonly adapter: ExecutorAdapter
  readonly role: RoleSpec
  readonly task: TaskPacket
  readonly context: ExecutionContext
}

export interface AdapterConformanceReport {
  readonly valid: boolean
  readonly descriptor?: ExecutorDescriptor
  readonly response?: ExecutorResponse
  readonly errors: readonly string[]
}

export async function checkAdapterConformance(
  input: AdapterConformanceInput,
): Promise<AdapterConformanceReport> {
  const errors: string[] = []
  let descriptor: ExecutorDescriptor | undefined
  let response: ExecutorResponse | undefined

  try {
    descriptor = await input.adapter.describe(input.context.options)
    const validation = validateValue(ExecutorDescriptorSchema as JsonSchema, descriptor)
    errors.push(...validation.errors.map((error) => `descriptor: ${error}`))
    if (descriptor.id !== input.adapter.id) {
      errors.push(
        `descriptor: id "${descriptor.id}" does not match adapter id "${input.adapter.id}"`,
      )
    }
  } catch (error: unknown) {
    errors.push(`descriptor: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (descriptor?.available === true) {
    try {
      response = await input.adapter.execute(input.role, input.task, input.context)
      const validation = validateValue(ExecutorResponseSchema as JsonSchema, response)
      errors.push(...validation.errors.map((error) => `response: ${error}`))
    } catch (error: unknown) {
      errors.push(`response: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    valid: errors.length === 0,
    ...(descriptor === undefined ? {} : { descriptor }),
    ...(response === undefined ? {} : { response }),
    errors,
  }
}
