import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ErrorCatalog, errorCatalogEntry } from '../src/index.ts'

describe('ErrorCatalog', () => {
  it('registers steering failures and redacts executor loss', () => {
    for (const code of [
      'run_not_steerable',
      'executor_lost',
      'steer_rejected',
      'steer_response_timeout',
    ]) {
      assert.equal(ErrorCatalog[code as keyof typeof ErrorCatalog].exit, 1)
    }
    assert.deepEqual(errorCatalogEntry('executor_lost'), {
      exit: 1,
      retryable: true,
      publicDetail: 'none',
    })
    assert.equal(errorCatalogEntry('not_registered'), ErrorCatalog.internal_error)
  })
})
