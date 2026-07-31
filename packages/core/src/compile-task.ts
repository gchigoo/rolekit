import { parse as parseYaml } from 'yaml'
import { SchemaValidationError } from './errors.ts'
import type { TaskContract } from './schemas/task-contract.ts'
import { validateArtifact } from './validate.ts'

/**
 * Recursively freezes a plain object / array graph (design: 冻结 TaskContract).
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child)
  }
  return Object.freeze(value)
}

/**
 * Parses YAML text into a validated TaskContract.
 * Throws SchemaValidationError with field-level issues on failure.
 */
export function compileTask(yamlText: string): TaskContract {
  let parsed: unknown
  try {
    parsed = parseYaml(yamlText)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'YAML parse failed'
    throw new SchemaValidationError(
      [{ layer: 'structural', path: '/', message }],
      'Failed to parse TaskContract YAML',
    )
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SchemaValidationError(
      [
        {
          layer: 'structural',
          path: '/',
          message: 'TaskContract YAML must be a mapping object',
        },
      ],
      'Failed to parse TaskContract YAML',
    )
  }

  const result = validateArtifact('rolekit/task-contract@1', parsed)
  if (!result.valid) {
    throw new SchemaValidationError(result.issues)
  }

  return deepFreeze(parsed as TaskContract)
}
