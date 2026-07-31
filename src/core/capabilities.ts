import type { Capability } from './types.ts'

export function mergeCapabilities(
  ...sets: readonly (readonly Capability[] | undefined)[]
): readonly Capability[] {
  return [...new Set(sets.flatMap((set) => set ?? []))].sort()
}

export function missingCapabilities(
  required: readonly Capability[],
  available: readonly Capability[],
): readonly Capability[] {
  const availableSet = new Set(available)
  return required.filter((capability) => !availableSet.has(capability))
}
