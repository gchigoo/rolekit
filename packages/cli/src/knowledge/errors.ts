import type { ValidationIssue } from '@rolekit/core'

/**
 * Business / usage error for knowledge CLI commands.
 */
export class KnowledgeCliError extends Error {
  readonly code: string
  readonly exitCode: number
  readonly detail?: string
  readonly id?: string
  readonly issues?: ValidationIssue[]

  constructor(
    code: string,
    options: {
      message?: string
      exitCode?: number
      detail?: string
      id?: string
      issues?: ValidationIssue[]
    } = {},
  ) {
    super(options.message ?? code)
    this.name = 'KnowledgeCliError'
    this.code = code
    this.exitCode = options.exitCode ?? 1
    this.detail = options.detail
    this.id = options.id
    this.issues = options.issues
  }
}
