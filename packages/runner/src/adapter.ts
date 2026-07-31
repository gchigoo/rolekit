import type { ExecutorReport, TaskContract } from '@rolekit/core'
import type { ProbeResult, RunContext, RunHandle, RunStatus } from './types.ts'

export type {
  ExecutorIncompatibleError,
  ExecutorLostError,
  ExecutorStartError,
  ExecutorSteerRejectedError,
  ExecutorTimeoutError,
  ExecutorUnsupportedOperationError,
  UnknownAdapterError,
} from './errors.ts'

/**
 * ExecutorAdapter — roadmap 4.3 frozen seam.
 */
export interface ExecutorAdapter {
  probe(): Promise<ProbeResult>
  start(task: TaskContract, ctx: RunContext): Promise<RunHandle>
  status(runId: string): Promise<RunStatus>
  steer(runId: string, message: string, control: { requestId: string }): Promise<void>
  cancel(runId: string): Promise<void>
  collect(runId: string): Promise<ExecutorReport>
}

export type ExecutorAdapterFactory = (
  options: import('./types.ts').AdapterCreateOptions,
) => ExecutorAdapter
