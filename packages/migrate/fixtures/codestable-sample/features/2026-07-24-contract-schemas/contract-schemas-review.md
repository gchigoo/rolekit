---
doc_type: feature-review
feature: 2026-07-24-contract-schemas
status: passed
reviewer: subagent
reviewed: 2026-07-28
round: 1
lane_a_state: completed
lane_a_ref: ""
lane_a_reason: ""
lane_b_state: unavailable
lane_b_ref: ""
lane_b_reason: "OCR CLI not invoked in this independent subagent lane; parent pin requested reviewer=subagent"
---

# contract-schemas 代码审查报告

## 1. Scope

- Design: `.codestable/features/2026-07-24-contract-schemas/contract-schemas-design.md`（`status: approved`）
- Checklist: `.codestable/features/2026-07-24-contract-schemas/contract-schemas-checklist.yaml`（steps 全 `done`；checks 仍 `pending`）
- Field matrix: `.codestable/features/2026-07-24-contract-schemas/contract-schemas-field-matrix.md`
- Evidence pack: `.codestable/features/2026-07-24-contract-schemas/contract-schemas-evidence-pack.md`
- Gate / DoD / evidence results: `contract-schemas-gate-results.json`、`contract-schemas-dod-results.json`、`contract-schemas-evidence-pack-results.json`、`contract-schemas-scope-gate-results.json`（均为 `passed`，blocking 空）
- Roadmap: `.codestable/roadmap/rolekit-v2/rolekit-v2-roadmap.md` §4.1–4.10
- Diff basis: greenfield，无 git commit；可归因改动为未跟踪的 `packages/`、`fixtures/`、`schemas/`、`scripts/`、`test/`、根配置与 CI；baseline dirty：`讨论.md`、`deepsearch讨论.md`（范围外）
- Review mode: focused-closure（post-review delta 仅 `compile-task.ts` + `compile-task.test.ts`，test/docs/type 级冻结补全，不改变公开契约形状）
- Independent Review: `independent-agent` 本 lane 已完成；OCR 未跑（`lane_b=unavailable`）；merge 以仓库事实逐条核验；`reviewer: subagent`（focused closure 保留原锚点与 round）

审查范围：`packages/core/**`、`packages/cli/**`、`fixtures/**`、`schemas/json/**`、`scripts/**`、`test/e2e/**`、根 `package.json` / `tsconfig.json` / `biome.json` / `.github/workflows/ci.yml`。

## 2. Spec Compliance

| 契约点 | 结论 |
|---|---|
| 9 类 schema 字段 vs roadmap 4.1–4.10 / field-matrix | 对齐：字面量、枚举、可选 `model`/`settings`、RunEvent 7 变体、WorkItem 含 `goal`、ExecutorReport 去掉 verification/scope_violations |
| D7.1 WorkItem `awaiting-gate` ⇔ `gate` 非空 | 已实现于 `work-item.ts` semanticRules；fixture + 单测覆盖双向 |
| D7.2 ResultEnvelope unresolved / scope_violations | 已实现；CLI 语义负例 `invalid-completed-with-violations.json`；unresolved 规则有单测 |
| D7.3 TaskContract commands≥1 + glob-ish | 已实现；`invalid-empty-commands.yaml` 为 semantic |
| D7.4 goal→done 不变量不在 schema 层 | 遵守（无该语义规则）；防误纳说明仅在 design，无独立「仍 valid」fixture |
| D7.5 KnowledgeEntry `{frontmatter,body}` + adr 四节 / rule 单段 | CLI 切分 + core 结构/语义分层正确；正负例齐全 |
| D7.6 ExecutorProfile.adapter 非枚举、minLength:1 | 正例 `openai-responses` valid；空串 structural |
| D8 负例分层 | 4 类含 ≥1 语义负例；其余结构负例；ExecutorReport 未复制 Envelope 语义 |
| 两层校验短路 | `validate.ts` 结构失败直接返回；单测断言 issues 全为 structural |
| `unknown_schema` | 注册表未命中与缺 `schema` 字段均 exit 1 + code |
| CLI exit 0/1/2、`--json` 仅 JSON、薄壳 | `cli.ts` 无校验逻辑；e2e 覆盖用法错误 / parse_error / BOM |
| compileTask 冻结 TaskContract | focused closure 后：`deepFreeze` 返回深冻结对象；单测 `Object.isFrozen`（REV-001 闭合） |
| 范围守护 | 无 ajv/zod/joi/eslint/prettier；`packages/` 仅 core+cli；无 publishConfig；`private: true` |
| 挂载点 | workspaces / bin.rolekit / CI / schemas/json 已齐；`rolekit-v2-items.yaml` 仍 `in-progress`（scope-gate 未允许改 roadmap，预期 acceptance 回写） |

## 3. Code Quality

- 分层清晰：IO/解析在 CLI（`parse-input.ts`），校验/语义在 core；`schemaRegistry` 单注册表。
- TypeCompiler 按 kind 缓存；无第三方校验引擎。
- 清洁度：无 `console.log` / TODO/FIXME / 注释废码；fixture 有业务语义。
- JSON Schema 导出为 TypeBox→JSON 幂等写法，产物 9 份且 RunEvent `anyOf` 形状合理。
- 残余 important：CMD-004 可移植性（REV-002）、导出幂等无自动锁（REV-003）——交 QA residual。

## 4. Gate And Provider Warnings

- scope-gate / dod-runner / evidence-pack：`status=passed`，`blocking=[]`，`warnings=[]`。
- Provider：`archguard` unavailable（binary not on PATH）；`meta_cc` unavailable（summary not found）。二者均为工具缺失，非实现缺陷；不构成 blocking，QA 不必等待。
- Evidence pack Residual Risks 写 `none`；本审查补充见第 6 节。
- DoD 四命令 exit 0（62/37 tests）；与当前实现一致，未发现证据造假迹象。
- Closure 定向验证：`node --test packages/core/test/compile-task.test.ts` → 3 pass / 0 fail。

## 5. Findings

### blocking

none

### important

- [x] REV-001 `packages/core/src/compile-task.ts:53` `compileTask` 成功路径直接 `return parsed as TaskContract`，未 `Object.freeze`（亦无深冻结）。
  - Evidence: design 名词层写「冻结对象」；checklist check「compileTask 正例返回冻结 TaskContract」；全仓无 `Object.freeze`。
  - Impact: 名词契约字面未落实；调用方仍可就地篡改已校验契约；若 acceptance 用 `Object.isFrozen` 断言会失败。
  - Expected fix scope: 成功返回前冻结（或深冻结）并补单测；若「冻结」仅指版本锁定语义，须改 design/checklist 措辞消除歧义。
  - Closure: 已用 `deepFreeze` + 单测 `Object.isFrozen(actual)` / `Object.isFrozen(actual.acceptance)` 闭合；见第 8 节。

- [ ] REV-002 `contract-schemas-checklist.yaml` CMD-004 / `.github/workflows/ci.yml:21` e2e 调用形式不一致。
  - Evidence: checklist/DoD 为 `node --test test/e2e/`；CI 为 `node --test "test/e2e/**/*.test.ts"`；engines 为 `node >=22.18`（含 Node 24）；已知 Node 24 对目录参数存在回归风险。
  - Impact: 本机 DoD 绿不代表 engines 上界可复现；QA/CI 矩阵可能分叉。
  - Expected fix scope: 统一 CMD-004、文档与 CI 为同一可移植调用（优先显式 glob 或 `scripts/run-tests.ts` 子集）。
  - Residual for QA: 保持 important，不升 blocking。

- [ ] REV-003 `scripts/export-schemas.ts` / checklist「导出幂等零 diff」无自动化锁定。
  - Evidence: S5 标 done，但无测试/CI 步骤执行 `npm run export:schemas` 后 diff；DoD 四命令不含导出。
  - Impact: 导出漂移或非幂等只能靠人工发现，验收可信度弱于其它核心命令。
  - Expected fix scope: 增加重导出零 diff 检查（测试或 CI step），不改 schema 语义。
  - Residual for QA: 保持 important，不升 blocking。

### nit

- [ ] REV-004 `packages/cli/src/parse-input.ts:13` `splitFrontmatter` 仍 `replace(/^\uFEFF/, '')`，但同文件 46–48 行已对 BOM 统一 `parse_error`，BOM 剥离为死路径。
- [ ] REV-005 `packages/core/src/validate.ts:50-63` 在 `schemaRegistry.has(kind)` 之后的 `!entry` 分支不可达。
- [ ] REV-006 D7.4「写入负例说明防误纳」：design 已有说明，但缺少「kind=goal + status=done + depends_on 未齐仍 schema-valid」的显式正例/注释，后续易误加语义规则。

### suggestion

- [ ] REV-007 ISO8601 字段（RunEvent.ts、WorkItem.created/updated 等）仅 `minLength:1`，与 roadmap 注解一致但无格式校验；若要在 contract 层收紧，单独立项，勿 silently 塞进本条。

### learning

- 「错版本字面量」经 CLI 会变成注册表未命中 → `unknown_schema`（如 `role-profile@2`），不会进入 `@1` schema 的 Literal structural 路径；与 design 2.2 / 场景 5 一致，勿在 QA 中误期望 `layer: structural`。

### praise

- RunEvent 7 变体 union、WorkItem 条件 gate、KnowledgeEntry 载荷边界、ExecutorProfile 非枚举 adapter、真实 CLI 遍历 fixtures——与 approved design 贴合度高，短路与 exit code 测得扎实。

## 6. Test And QA Focus

QA 必须重跑：

1. `npm test`、`npx tsc --noEmit`、`npx biome check .`
2. CLI e2e：与 CI 相同的可移植命令（推荐 `node --test "test/e2e/**/*.test.ts"`），勿只信目录形式（REV-002）
3. 全量 fixture：每类 valid→exit 0；结构负例→exit 1 + `layer: structural`；四类语义负例→`layer: semantic`
4. 用法：缺参/未知 flag/未知命令→exit 2；空文件与 BOM→`parse_error`；缺 schema→`unknown_schema`
5. `compileTask`：正例深等 + `Object.isFrozen`（REV-001 已在 closure 定向验证；QA 回归即可）
6. `npm run export:schemas` 后 `schemas/json/` 零 diff（REV-003）
7. 回归钉扎：ExecutorProfile `adapter: openai-responses` valid；adapter `""` structural；WorkItem `kind: goal` valid；`status=awaiting-gate` 且 `gate: null` semantic fail
8. 反向范围：依赖树无 ajv/zod/joi；`packages/` 无 runner/migrate/adapters/profiles/evals；`rolekit --help` 仅 validate

不能靠 review 完全确认：

- Node 22.18 vs Node 24 上 CMD-004 行为（REV-002）
- 导出在其它 Node 小版本 key 序是否仍零 diff（REV-003）
- `items.yaml` 回写时机（acceptance）
- goal 完成不变量未误入 schema（建议 QA 抽一条 goal+done+未齐依赖，期望 validate 仍 0）

## 7. Verdict

- Status: **passed**
- Blocking: 0；Important open: 2（REV-002、REV-003，交 QA residual）；REV-001 closed
- Next: Goal lane → `cs-feat` QA 阶段；未闭合 important 写入 QA residual risk
- Focused Closure: 见第 8 节（REV-001）

## 8. Focused Closure / Closure Evidence

- Closed findings: REV-001
- Attributed delta:
  - `packages/core/src/compile-task.ts` — 新增 `deepFreeze`（`compile-task.ts:9-17`），成功路径 `return deepFreeze(parsed as TaskContract)`（`compile-task.ts:53`）
  - `packages/core/test/compile-task.test.ts` — 正例断言 `Object.isFrozen(actual)` 与 `Object.isFrozen(actual.acceptance)`（`compile-task.test.ts:21-22`）
- Targeted verification: `node --test packages/core/test/compile-task.test.ts` → 3 pass / 0 fail
- Classification: test + 返回值不可变加固；校验路径、schema 字段、CLI 契约、exit code 未变；无新 blocking；REV-002/REV-003 不升格，留 QA residual
- New blocking introduced: none
