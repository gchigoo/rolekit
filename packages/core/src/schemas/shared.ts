import { Type } from '@sinclair/typebox'
import type { SemanticIssue } from '../types.ts'

/** Escalation action shared by TaskContract and RunEvent. */
export const EscalationActionSchema = Type.Union([
  Type.Literal('return_blocked'),
  Type.Literal('require_approval'),
  Type.Literal('return_question'),
])

/** Result / executor status enum. */
export const ResultStatusSchema = Type.Union([
  Type.Literal('completed'),
  Type.Literal('blocked'),
  Type.Literal('question'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
])

/** Gate action levels (ADR 003). */
export const GateActionSchema = Type.Union([
  Type.Literal('ignore'),
  Type.Literal('observe'),
  Type.Literal('confirm'),
  Type.Literal('block'),
])

/** Gate action union type shared by PolicyEngine and GatePolicy. */
export type GateAction = 'ignore' | 'observe' | 'confirm' | 'block'

/** Empty semantic rules helper for schemas without D7 rules. */
export function noSemanticRules(_data: unknown): SemanticIssue[] {
  return []
}

/**
 * Basic glob-ish syntax check for scope patterns.
 * Rejects empty strings, control characters, and unbalanced brackets.
 */
export function isValidGlobish(pattern: string): boolean {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    return false
  }
  if (pattern.trim().length === 0) {
    return false
  }
  for (let i = 0; i < pattern.length; i += 1) {
    const code = pattern.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) {
      return false
    }
  }
  let square = 0
  let curly = 0
  for (const ch of pattern) {
    if (ch === '[') square += 1
    else if (ch === ']') square -= 1
    else if (ch === '{') curly += 1
    else if (ch === '}') curly -= 1
    if (square < 0 || curly < 0) {
      return false
    }
  }
  return square === 0 && curly === 0
}
