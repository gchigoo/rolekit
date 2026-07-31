/**
 * Frozen D12a Superpowers profile/note mapping tables.
 */

export const SUPERPOWERS_ADAPTER_ID = 'codex-superpowers-5.1.3@1'
export const SUPERPOWERS_VERSION = '5.1.3'
export const SUPERPOWERS_LICENSE = 'MIT'
export const SUPERPOWERS_ADAPTER_EPOCH = '2026-07-27T00:00:00.000Z'

export const REQUIRED_SKILL_SLUGS = [
  'brainstorming',
  'dispatching-parallel-agents',
  'executing-plans',
  'finishing-a-development-branch',
  'receiving-code-review',
  'requesting-code-review',
  'subagent-driven-development',
  'systematic-debugging',
  'test-driven-development',
  'using-git-worktrees',
  'using-superpowers',
  'verification-before-completion',
  'writing-plans',
  'writing-skills',
] as const

export type SuperpowersSkillSlug = (typeof REQUIRED_SKILL_SLUGS)[number]

export type HeadingRef = { kind: 'preamble' } | { kind: 'h2'; text: string }

export interface FragmentSpec {
  file: string
  headings: HeadingRef[]
  fragment: string
}

export interface ProfileTemplate {
  slug: SuperpowersSkillSlug
  profileName: string
  fragments: FragmentSpec[]
  capabilities: string[]
  boundaries: string[]
  deliverables: string[]
  verification: string[]
  /** Whole-file discards keyed by relative file path within the skill bundle. */
  discardWholeFiles: string[]
  /** H2 section titles to discard from SKILL.md (evidence-only). */
  discardSkillSections: string[]
}

export interface NoteTemplate {
  slug: SuperpowersSkillSlug
  migrationSentence: string
}

/** Splits D12a fixed-field cell on ` / ` then `、`. */
export function splitFixedFields(raw: string): [string[], string[], string[], string[]] {
  const groups = raw.split(' / ').map((part) => part.trim())
  if (groups.length !== 4) {
    throw new Error(`expected four fixed-field groups, got ${groups.length}`)
  }
  return groups.map((group) =>
    group
      .split('、')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  ) as [string[], string[], string[], string[]]
}

const brainstormingFields = splitFixedFields(
  '澄清目标/约束/成功标准、比较方案、可审设计 / 不实现、不因简单跳过、不调Skill / design-spec / checklist可证伪+owner过目证据',
)
const writingPlansFields = splitFixedFields(
  'design转原子计划、路径/验证明确 / 不实现、无占位 / implementation-plan / step独立+命令可执行',
)
const tddFields = splitFixedFields(
  'RED-GREEN-REFACTOR、测试设计 / 未见RED不写prod、禁test-only hook / code+tests / RED证据+GREEN+全回归',
)
const debuggingFields = splitFixedFields(
  '复现/根因/单假设/修复 / 不猜、不并投多修 / diagnosis+fix evidence / reproduction+hypothesis+regression',
)
const verifierFields = splitFixedFields(
  'fresh evidence / 不凭旧结果宣称 / verification-summary / 命令+exit+artifact',
)
const reviewRequesterFields = splitFixedFields(
  '组装requirements/diff/范围、严重级别 / 不dispatch、不替review结论 / review-brief / 输入完整+范围可定位',
)
const reviewResponderFields = splitFixedFields(
  '核实finding/按风险响应 / 不盲从、不表演同意 / response-plan或fix evidence / finding逐条证据',
)
const skillAuthorFields = splitFixedFields(
  'skill结构/触发描述/pressure eval / 未测试不发布、不含宿主调度 / skill bundle+eval / baseline fail+green+refactor',
)

export const PROFILE_TEMPLATES: ProfileTemplate[] = [
  {
    slug: 'brainstorming',
    profileName: 'superpowers-brainstormer',
    fragments: [
      {
        file: 'SKILL.md',
        headings: [
          { kind: 'preamble' },
          { kind: 'h2', text: 'Anti-Pattern: "This Is Too Simple To Need A Design"' },
          { kind: 'h2', text: 'Checklist' },
          { kind: 'h2', text: 'Key Principles' },
        ],
        fragment: 'core.md',
      },
    ],
    capabilities: brainstormingFields[0],
    boundaries: brainstormingFields[1],
    deliverables: brainstormingFields[2],
    verification: brainstormingFields[3],
    discardWholeFiles: ['visual-companion.md'],
    discardSkillSections: ['Process Flow', 'The Process', 'After the Design', 'Visual Companion'],
  },
  {
    slug: 'writing-plans',
    profileName: 'superpowers-planner',
    fragments: [
      {
        file: 'SKILL.md',
        headings: [
          { kind: 'h2', text: 'Overview' },
          { kind: 'h2', text: 'Scope Check' },
          { kind: 'h2', text: 'Bite-Sized Task Granularity' },
          { kind: 'h2', text: 'Task Structure' },
          { kind: 'h2', text: 'No Placeholders' },
          { kind: 'h2', text: 'Remember' },
          { kind: 'h2', text: 'Self-Review' },
        ],
        fragment: 'core.md',
      },
    ],
    capabilities: writingPlansFields[0],
    boundaries: writingPlansFields[1],
    deliverables: writingPlansFields[2],
    verification: writingPlansFields[3],
    discardWholeFiles: ['plan-document-reviewer-prompt.md'],
    discardSkillSections: ['File Structure', 'Plan Document Header', 'Execution Handoff'],
  },
  {
    slug: 'test-driven-development',
    profileName: 'superpowers-tdd-implementer',
    fragments: [
      {
        file: 'SKILL.md',
        headings: [
          { kind: 'h2', text: 'Overview' },
          { kind: 'h2', text: 'The Iron Law' },
          { kind: 'h2', text: 'Red-Green-Refactor' },
          { kind: 'h2', text: 'Good Tests' },
          { kind: 'h2', text: 'Why Order Matters' },
          { kind: 'h2', text: 'Common Rationalizations' },
          { kind: 'h2', text: 'Red Flags - STOP and Start Over' },
          { kind: 'h2', text: 'Verification Checklist' },
          { kind: 'h2', text: 'When Stuck' },
          { kind: 'h2', text: 'Testing Anti-Patterns' },
          { kind: 'h2', text: 'Final Rule' },
        ],
        fragment: 'core.md',
      },
      {
        file: 'testing-anti-patterns.md',
        headings: [
          { kind: 'h2', text: 'Overview' },
          { kind: 'h2', text: 'The Iron Laws' },
          { kind: 'h2', text: 'Anti-Pattern 1: Testing Mock Behavior' },
          { kind: 'h2', text: 'Anti-Pattern 2: Test-Only Methods in Production' },
          { kind: 'h2', text: 'Anti-Pattern 3: Mocking Without Understanding' },
          { kind: 'h2', text: 'Anti-Pattern 4: Incomplete Mocks' },
          { kind: 'h2', text: 'Anti-Pattern 5: Integration Tests as Afterthought' },
          { kind: 'h2', text: 'Quick Reference' },
          { kind: 'h2', text: 'Red Flags' },
          { kind: 'h2', text: 'The Bottom Line' },
        ],
        fragment: 'anti-patterns.md',
      },
    ],
    capabilities: tddFields[0],
    boundaries: tddFields[1],
    deliverables: tddFields[2],
    verification: tddFields[3],
    discardWholeFiles: [],
    discardSkillSections: [],
  },
  {
    slug: 'systematic-debugging',
    profileName: 'superpowers-debugger',
    fragments: [
      {
        file: 'SKILL.md',
        headings: [
          { kind: 'h2', text: 'Overview' },
          { kind: 'h2', text: 'The Iron Law' },
          { kind: 'h2', text: 'When to Use' },
          { kind: 'h2', text: 'The Four Phases' },
          { kind: 'h2', text: 'Red Flags - STOP and Follow Process' },
          { kind: 'h2', text: 'Common Rationalizations' },
          { kind: 'h2', text: 'Quick Reference' },
          { kind: 'h2', text: 'When Process Reveals "No Root Cause"' },
          { kind: 'h2', text: 'Supporting Techniques' },
        ],
        fragment: 'core.md',
      },
      {
        file: 'root-cause-tracing.md',
        headings: [
          { kind: 'h2', text: 'Overview' },
          { kind: 'h2', text: 'When to Use' },
          { kind: 'h2', text: 'The Tracing Process' },
          { kind: 'h2', text: 'Key Principle' },
          { kind: 'h2', text: 'Stack Trace Tips' },
        ],
        fragment: 'root-cause.md',
      },
      {
        file: 'defense-in-depth.md',
        headings: [
          { kind: 'h2', text: 'Overview' },
          { kind: 'h2', text: 'Why Multiple Layers' },
          { kind: 'h2', text: 'The Four Layers' },
          { kind: 'h2', text: 'Applying the Pattern' },
          { kind: 'h2', text: 'Key Insight' },
        ],
        fragment: 'defense.md',
      },
      {
        file: 'condition-based-waiting.md',
        headings: [
          { kind: 'h2', text: 'Overview' },
          { kind: 'h2', text: 'When to Use' },
          { kind: 'h2', text: 'Core Pattern' },
          { kind: 'h2', text: 'Quick Patterns' },
          { kind: 'h2', text: 'Common Mistakes' },
          { kind: 'h2', text: 'When Arbitrary Timeout IS Correct' },
        ],
        fragment: 'waiting.md',
      },
    ],
    capabilities: debuggingFields[0],
    boundaries: debuggingFields[1],
    deliverables: debuggingFields[2],
    verification: debuggingFields[3],
    discardWholeFiles: [
      'CREATION-LOG.md',
      'test-pressure-1.md',
      'test-pressure-2.md',
      'test-pressure-3.md',
      'test-academic.md',
      'find-polluter.sh',
      'condition-based-waiting-example.ts',
    ],
    discardSkillSections: [],
  },
  {
    slug: 'verification-before-completion',
    profileName: 'superpowers-verifier',
    fragments: [
      {
        file: 'SKILL.md',
        headings: [
          { kind: 'h2', text: 'Overview' },
          { kind: 'h2', text: 'The Iron Law' },
          { kind: 'h2', text: 'The Gate Function' },
          { kind: 'h2', text: 'Common Failures' },
          { kind: 'h2', text: 'Red Flags - STOP' },
          { kind: 'h2', text: 'Rationalization Prevention' },
          { kind: 'h2', text: 'Key Patterns' },
          { kind: 'h2', text: 'When To Apply' },
          { kind: 'h2', text: 'The Bottom Line' },
        ],
        fragment: 'core.md',
      },
    ],
    capabilities: verifierFields[0],
    boundaries: verifierFields[1],
    deliverables: verifierFields[2],
    verification: verifierFields[3],
    discardWholeFiles: [],
    discardSkillSections: [],
  },
  {
    slug: 'requesting-code-review',
    profileName: 'superpowers-review-requester',
    fragments: [
      {
        file: 'SKILL.md',
        headings: [
          { kind: 'h2', text: 'When to Request Review' },
          { kind: 'h2', text: 'Red Flags' },
        ],
        fragment: 'core.md',
      },
    ],
    capabilities: reviewRequesterFields[0],
    boundaries: reviewRequesterFields[1],
    deliverables: reviewRequesterFields[2],
    verification: reviewRequesterFields[3],
    discardWholeFiles: ['code-reviewer.md'],
    discardSkillSections: ['How to Request', 'Example', 'Integration with Workflows'],
  },
  {
    slug: 'receiving-code-review',
    profileName: 'superpowers-review-responder',
    fragments: [
      {
        file: 'SKILL.md',
        headings: [
          { kind: 'h2', text: 'Overview' },
          { kind: 'h2', text: 'The Response Pattern' },
          { kind: 'h2', text: 'Forbidden Responses' },
          { kind: 'h2', text: 'Handling Unclear Feedback' },
          { kind: 'h2', text: 'Source-Specific Handling' },
          { kind: 'h2', text: 'YAGNI Check for "Professional" Features' },
          { kind: 'h2', text: 'Implementation Order' },
          { kind: 'h2', text: 'When To Push Back' },
          { kind: 'h2', text: 'Acknowledging Correct Feedback' },
          { kind: 'h2', text: 'Gracefully Correcting Your Pushback' },
          { kind: 'h2', text: 'Common Mistakes' },
          { kind: 'h2', text: 'The Bottom Line' },
        ],
        fragment: 'core.md',
      },
    ],
    capabilities: reviewResponderFields[0],
    boundaries: reviewResponderFields[1],
    deliverables: reviewResponderFields[2],
    verification: reviewResponderFields[3],
    discardWholeFiles: [],
    discardSkillSections: ['GitHub Thread Replies', 'Real Examples'],
  },
  {
    slug: 'writing-skills',
    profileName: 'superpowers-skill-author',
    fragments: [
      {
        file: 'SKILL.md',
        headings: [
          { kind: 'h2', text: 'Overview' },
          { kind: 'h2', text: 'What is a Skill?' },
          { kind: 'h2', text: 'TDD Mapping for Skills' },
          { kind: 'h2', text: 'When to Create a Skill' },
          { kind: 'h2', text: 'Skill Types' },
          { kind: 'h2', text: 'Directory Structure' },
          { kind: 'h2', text: 'SKILL.md Structure' },
          { kind: 'h2', text: 'Claude Search Optimization (CSO)' },
          { kind: 'h2', text: 'File Organization' },
          { kind: 'h2', text: 'The Iron Law (Same as TDD)' },
          { kind: 'h2', text: 'Testing All Skill Types' },
          { kind: 'h2', text: 'Common Rationalizations for Skipping Testing' },
          { kind: 'h2', text: 'RED-GREEN-REFACTOR for Skills' },
          { kind: 'h2', text: 'Anti-Patterns' },
          { kind: 'h2', text: 'Skill Creation Checklist (TDD Adapted)' },
          { kind: 'h2', text: 'Discovery Workflow' },
          { kind: 'h2', text: 'The Bottom Line' },
        ],
        fragment: 'core.md',
      },
      {
        file: 'anthropic-best-practices.md',
        headings: [
          { kind: 'h2', text: 'Core principles' },
          { kind: 'h2', text: 'Skill structure' },
          { kind: 'h2', text: 'Workflows and feedback loops' },
          { kind: 'h2', text: 'Content guidelines' },
          { kind: 'h2', text: 'Evaluation and iteration' },
          { kind: 'h2', text: 'Anti-patterns to avoid' },
        ],
        fragment: 'best-practices.md',
      },
    ],
    capabilities: skillAuthorFields[0],
    boundaries: skillAuthorFields[1],
    deliverables: skillAuthorFields[2],
    verification: skillAuthorFields[3],
    discardWholeFiles: [
      'testing-skills-with-subagents.md',
      'persuasion-principles.md',
      'render-graphs.js',
      'graphviz-conventions.dot',
    ],
    discardSkillSections: [],
  },
]

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    slug: 'using-superpowers',
    migrationSentence: '宿主薄 adapter 只调用 RoleKit CLI，不激活源 Skill 调度。',
  },
  {
    slug: 'dispatching-parallel-agents',
    migrationSentence: 'RoleKit v1 不支持并行多 writer，本条仅保留证据。',
  },
  {
    slug: 'executing-plans',
    migrationSentence: '源计划执行语义映射到 WorkItem 与 run，不激活源调度器。',
  },
  {
    slug: 'finishing-a-development-branch',
    migrationSentence: '收尾语义映射到 IntegrationManager 与 final gate，不自动操作远端。',
  },
  {
    slug: 'subagent-driven-development',
    migrationSentence: 'RoleKit v1 不激活子代理 dispatch/reviewer prompt 链。',
  },
  {
    slug: 'using-git-worktrees',
    migrationSentence: '隔离语义映射到 runner WorktreeManager，不复制源脚本。',
  },
]

export const PROFILE_SLUGS = new Set(PROFILE_TEMPLATES.map((t) => t.slug))
export const NOTE_SLUGS = new Set(NOTE_TEMPLATES.map((t) => t.slug))

export function attributionComment(slug: string): string {
  return `<!-- source: superpowers@${SUPERPOWERS_VERSION}; license: ${SUPERPOWERS_LICENSE}; skill: ${slug} -->`
}

export function noteTags(slug: string): string[] {
  return [
    'superpowers',
    'source:superpowers',
    `version:${SUPERPOWERS_VERSION}`,
    `license:${SUPERPOWERS_LICENSE}`,
    `skill:${slug}`,
  ]
}

export function fragmentRelPath(slug: string, fragmentFile: string): string {
  return `fragments/superpowers/${slug}/${fragmentFile}`
}
