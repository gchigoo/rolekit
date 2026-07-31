/**
 * Thrown when a WorkItem status transition is illegal per roadmap 4.9.
 */
export class InvalidTransition extends Error {
  readonly code = 'invalid_transition'

  constructor(message: string) {
    super(message)
    this.name = 'InvalidTransition'
  }
}
