/**
 * Shared validation result and issue types for RoleKit contracts.
 */
export type IssueLayer = 'structural' | 'semantic'

/** Field-level validation issue returned by validateArtifact. */
export interface ValidationIssue {
  layer: IssueLayer
  path: string
  message: string
}

/** Semantic-only issue produced by schema semanticRules. */
export interface SemanticIssue {
  path: string
  message: string
}

/** Unified validation outcome. */
export type ValidationResult =
  | { valid: true }
  | { valid: false; issues: ValidationIssue[]; code?: string }
