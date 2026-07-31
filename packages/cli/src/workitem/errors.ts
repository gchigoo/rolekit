/**
 * Business / usage error for workitem CLI commands.
 */
export class WorkItemCliError extends Error {
  readonly code: string
  readonly exitCode: number
  readonly detail?: string
  readonly id?: string
  readonly run_id?: string
  readonly next_action?: string

  constructor(
    code: string,
    options: {
      message?: string
      exitCode?: number
      detail?: string
      id?: string
      run_id?: string
      next_action?: string
    } = {},
  ) {
    super(options.message ?? code)
    this.name = 'WorkItemCliError'
    this.code = code
    this.exitCode = options.exitCode ?? 1
    this.detail = options.detail
    this.id = options.id
    this.run_id = options.run_id
    this.next_action = options.next_action
  }
}
