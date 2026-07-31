import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  type DogfoodPlan,
  buildSwitchDecision,
  evaluateCampaign,
  writeSwitchDecisionFiles,
} from '@rolekit/evals'
import { parse as parseYaml } from 'yaml'

const mode = process.argv[2]
const args = process.argv.slice(3)
const option = (name: string): string | null => {
  const index = args.indexOf(name)
  return index >= 0 && index + 1 < args.length ? (args[index + 1] ?? null) : null
}
const campaignRoot = option('--campaign-root')
const campaignId = option('--campaign')
const canonicalOpt = option('--canonical-root')
if ((mode !== 'audit' && mode !== 'switch') || !campaignRoot || !campaignId) {
  process.stderr.write(
    'usage: campaign-command <audit|switch> --campaign-root <path> --campaign <id> [--canonical-root <path>]\n',
  )
  process.exit(2)
}

try {
  const root = resolve(campaignRoot)
  const plan = parseYaml(readFileSync(join(root, 'plan.yaml'), 'utf8')) as DogfoodPlan
  const evaluation = await evaluateCampaign({ campaignRoot: root, campaignId, plan })
  if (mode === 'audit') {
    if (evaluation.audit.status === 'pass') {
      process.stdout.write(`${JSON.stringify(evaluation)}\n`)
      process.exit(0)
    }
    process.stdout.write(`${JSON.stringify({ code: 'dogfood_audit_failed', evaluation })}\n`)
    process.exit(1)
  }

  const canonicalRoot =
    canonicalOpt ??
    (existsSync(join(process.cwd(), 'dogfood', 'reports')) ? process.cwd() : null)
  const decision = buildSwitchDecision(evaluation, { campaignRoot: root, canonicalRoot })
  const written = writeSwitchDecisionFiles(decision, { campaignRoot: root, canonicalRoot })
  const payload = {
    ...decision,
    paths: written,
  }
  process.stdout.write(
    `${JSON.stringify(decision.verdict === 'go' ? payload : { code: 'switch_hold', decision: payload })}\n`,
  )
  process.exit(decision.verdict === 'go' ? 0 : 1)
} catch {
  process.stdout.write(`${JSON.stringify({ code: 'internal_error' })}\n`)
  process.exit(1)
}
