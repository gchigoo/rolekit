---
doc_type: feature-impl-report
feature: 2026-07-24-workitem-lifecycle-core
status: implemented
---

# workitem-lifecycle-core 实现报告

## 交付

- `packages/core/src/workitem/`：状态机、selectLane、gate/done reducers、错误类型
- `packages/cli/src/workitem/`：store（D6 锁/CAS/原子写）、六子命令、start saga
- CLI `gate` WI- 前缀路由；host-adapter 三份 Skill 命令表跟进
- roadmap 4.5/4.9 patch + items notes；compound `workitem-lifecycle-core.md`

## 验证

- `node --test` workitem 单测 + store 单测
- `test/e2e/workitem-cli.test.ts`：direct 全路径、delegated mock 双 gate、非法转移、前缀隔离
- `test/e2e/gate-cli.test.ts`：WI missing → workitem_not_found；run- 回归

## 已知边界

- coordinated 执行面等价 delegated
- question / blocked 恢复 / dropped CLI 延后 hardening
- direct 无 class-(1) 机械 gate
