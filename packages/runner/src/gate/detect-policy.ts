import { join } from 'node:path'
import { isValidGlobish, RolekitError } from '@rolekit/core'
import { parse as parseYaml } from 'yaml'
import { readTextIfExists } from '../fs-util.ts'

/** Detect path sets snapshotted at run prepare (enhanced mode). */
export interface DetectPolicy {
  dependency_files: string[]
  migration_paths: string[]
  api_paths: string[]
}

export const DEFAULT_DETECT_POLICY: DetectPolicy = {
  dependency_files: [
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'requirements.txt',
    'pyproject.toml',
    'go.mod',
    'Cargo.toml',
  ],
  migration_paths: ['**/migrations/**', '**/migrate/**'],
  api_paths: [],
}

const ALLOWED_KEYS = new Set(['dependency_files', 'migration_paths', 'api_paths'])

/**
 * Loads `.rolekit/policies/detect.yaml`; missing file → defaults.
 * Unknown keys or invalid globs → detect_policy_invalid.
 */
export async function loadDetectPolicy(projectRoot: string): Promise<DetectPolicy> {
  const path = join(projectRoot, '.rolekit', 'policies', 'detect.yaml')
  const text = await readTextIfExists(path)
  if (text === null) {
    return structuredClone(DEFAULT_DETECT_POLICY)
  }
  let parsed: unknown
  try {
    parsed = parseYaml(text)
  } catch (error) {
    throw new RolekitError(
      error instanceof Error ? error.message : 'detect policy parse failed',
      'detect_policy_invalid',
    )
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RolekitError('detect.yaml root must be a mapping', 'detect_policy_invalid')
  }
  const record = parsed as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new RolekitError(`unknown detect.yaml key: ${key}`, 'detect_policy_invalid')
    }
  }
  const result: DetectPolicy = structuredClone(DEFAULT_DETECT_POLICY)
  for (const key of ALLOWED_KEYS) {
    if (!(key in record)) continue
    const value = record[key]
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
      throw new RolekitError(`${key} must be a string array`, 'detect_policy_invalid')
    }
    for (const pattern of value) {
      if (!isValidGlobish(pattern)) {
        throw new RolekitError(`invalid detect glob: ${pattern}`, 'detect_policy_invalid')
      }
    }
    result[key as keyof DetectPolicy] = value as string[]
  }
  return result
}
