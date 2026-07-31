import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { compileTask } from '../src/compile-task.ts'
import { SchemaValidationError } from '../src/errors.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('compileTask', () => {
  it('returns TaskContract deep-equal to parsed valid fixture', () => {
    const yamlText = readFileSync(
      join(root, 'fixtures/task-contract/valid-implement-auth.yaml'),
      'utf8',
    )
    const expected = parseYaml(yamlText)
    const actual = compileTask(yamlText)
    assert.deepEqual(actual, expected)
    assert.ok(Object.isFrozen(actual))
    assert.ok(Object.isFrozen(actual.acceptance))
  })

  it('throws SchemaValidationError with field-level issues on bad YAML object', () => {
    const yamlText = readFileSync(
      join(root, 'fixtures/task-contract/invalid-empty-commands.yaml'),
      'utf8',
    )
    assert.throws(
      () => compileTask(yamlText),
      (error: unknown) => {
        assert.ok(error instanceof SchemaValidationError)
        assert.equal(error.code, 'validation_error')
        assert.ok(error.issues.length > 0)
        assert.equal(error.issues[0]?.layer, 'semantic')
        return true
      },
    )
  })

  it('throws on invalid YAML syntax', () => {
    assert.throws(
      () => compileTask('schema: [\n  - broken'),
      (error: unknown) => {
        assert.ok(error instanceof SchemaValidationError)
        return true
      },
    )
  })
})
