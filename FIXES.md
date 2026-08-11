# LifeLook AppImage control audit

This audit is anchored to application commit `18be03ecfb760e91e41c8daa5f2dd6336a41b883` and AppImage SHA-256 `80d932bc237aff1a33bcdbe5ab0886f9a4edca677763f53aa88b9d6094d539dd`. Evidence is under [`audit-artifacts/18be03ec…`](audit-artifacts/18be03ecfb760e91e41c8daa5f2dd6336a41b883/).

## Package and automated baseline

- Audit date: 2026-08-10 America/Los_Angeles.
- Package identity: [`package/identity.md`](audit-artifacts/18be03ecfb760e91e41c8daa5f2dd6336a41b883/package/identity.md).
- Automated baseline: 78 frontend tests, production TypeScript/Vite build, 27 Rust tests, Rust formatting, clippy with warnings denied, zero npm advisories, and RustSec audit with 17 policy-allowed unmaintained/unsound transitive warnings.
- AppImage baseline: content validation, Xvfb visible-window smoke, nine isolated scenario families, strict offline, corrupt recovery, and unwritable repair passed.
- Inventory: 246 unique source control declarations; 193 conditional/repeated; 57 disabled expressions. See [`interaction-manifest.md`](audit-artifacts/18be03ecfb760e91e41c8daa5f2dd6336a41b883/interaction-manifest.md) and the one-row-per-control [`source-control-inventory.json`](audit-artifacts/18be03ecfb760e91e41c8daa5f2dd6336a41b883/source-control-inventory.json).
- Matrix: 32/32 persistent-shell appearance/layout executions passed with structured records and screenshots.

`Verified` means the repaired behavior was observed in this exact AppImage. Automated-only results are not promoted to `Verified`.

## Findings

### FIN-TAX-001 — Retirement contributions incorrectly reduced FICA wages

- Status: Ready for re-test
- Severity: Critical
- Reproduction: project $100,000 wage income with a $10,000 traditional workplace retirement contribution.
- Expected: federal and California taxable wages decrease; Social Security and Medicare wages do not.
- Actual before repair: all four tax bases decreased.
- Root cause: one ambiguous `pretaxCents` parameter was applied to every tax base.
- Repair: separate gross wages, federal deduction, California deduction, and FICA-exempt wage inputs; the supported UI preset maps to zero FICA exemption and requires a retirement destination account.
- Automated evidence: `src/domain/tax.test.ts`, `src/domain/projection.test.ts`, and `src/App.test.tsx` pass.
- Exact-AppImage evidence: the repaired input control and persistence path are present in the audited package, but an independently displayed golden tax result was not captured.
- Challenger disposition: original arithmetic counterexample passes; third-party golden-output reconciliation remains open.

### FIN-TAX-002 — 2025 federal standard deductions were stale

- Status: Ready for re-test
- Severity: Critical
- Reproduction: inspect the prior 2025 single/separate $15,000, joint $30,000, and head-of-household $22,500 values.
- Expected: $15,750, $31,500, and $23,625 respectively.
- Actual before repair: pre-revision values.
- Root cause: the 2025 rule pack predated the statutory revision.
- Repair: updated all filing statuses and added one-cent-below/at/above deduction and bracket tests.
- Automated evidence: all 78 frontend tests pass.
- Exact-AppImage evidence: package built from the repair commit; no displayed golden case captured.
- Challenger disposition: parameter reconciliation complete; independent service comparison remains open.

### FIN-TAX-003 — Independent tax truth dataset is absent

- Status: Open
- Severity: High
- Reproduction: search the repository for provenance-stamped PolicyEngine/TAXSIM fixtures.
- Expected: reviewed offline fixtures with citations, retrieval dates, years, statuses, and boundary outputs.
- Actual: comprehensive local boundary arithmetic exists; third-party reconciliation artifacts do not.
- Root cause: prior work tested local production rules without importing an independent golden dataset.
- Repair: none in this control-focused pass.
- Automated evidence: local rule boundaries pass.
- Exact-AppImage evidence: not applicable.
- Challenger disposition: unresolved.

### PROD-001 — Literal all-controls × 32 completion gate remains unmet

- Status: Open
- Severity: High
- Reproduction: compare the 246-row source inventory, state-specific package scenarios, and the 32-row matrix.
- Expected: every runtime instance of every applicable declaration has pointer/keyboard evidence in every required appearance/layout combination.
- Actual: persistent shell controls passed all 32 combinations; state-specific onboarding, mutation, failure, import/export, planning, and recovery controls passed in the exact package at their scenario viewport, not each at all 32 combinations.
- Root cause: the existing native suite was state-oriented, while the new cross-product runner covers persistent shell controls and responsive observation.
- Repair: replaced the grouped manifest with 246 unique declaration rows; added a 32-combination exact-AppImage matrix and structured evidence.
- Automated evidence: `e2e/specs/control-matrix.e2e.js` passed 32/32.
- Exact-AppImage evidence: `package/control-matrix/results.json`, 32 screenshots, and `package/final-full-suite/`.
- Challenger disposition: source/runtime reconciliation found stale onboarding route assumptions and corrected them; a literal full cross-product challenger pass is still required.

### AUDIT-HARNESS-001 — Packaged scenario teardown did not exit

- Status: Verified
- Severity: Medium
- Reproduction: run the first AppImage acceptance scenario without forcing Node's test-runner exit; assertions pass but the process retains a handle and the wrapper does not advance.
- Expected: teardown terminates so every isolated scenario runs.
- Actual before repair: the wrapper stalled after the first passed scenario.
- Root cause: a packaged WebDriver/AppImage handle survived test teardown.
- Repair: run scenarios with Node's `--test-force-exit` after registered teardown hooks complete.
- Automated evidence: the final uninterrupted wrapper ran all nine scenario families and exited 0.
- Exact-AppImage evidence: final full-suite screenshots and successful aggregate exit.
- Challenger disposition: independently reproduced before repair; not reproduced after repair.

### AUDIT-HARNESS-002 — Onboarding variant skipped conditional Tax step

- Status: Verified
- Severity: Medium
- Reproduction: the scenario selected Filing Status and immediately searched for Credit card, then assumed one Back returned from Accounts to Household.
- Expected: activate Tax `Save & Continue`; Accounts Back returns to Tax; relaunch resumes the committed Accounts step while rolling back unsaved account drafts.
- Actual before repair: the test failed on a missing control and later on the stale Back/relaunch assumptions.
- Root cause: the scenario predated the eight-step onboarding route.
- Repair: explicitly traverse Tax in both paths, assert the two-step Back route, committed household persistence, unsaved draft rollback, and remaining conditional steps.
- Automated evidence: independent rerun and final full packaged suite pass.
- Exact-AppImage evidence: exact package `80d932…` in isolated profiles.
- Challenger disposition: independently reproduced three stale assumptions; all are corrected and verified.

### PROD-002 — Startup and recovery behavior

- Status: Verified
- Severity: High
- Reproduction: fresh launch, corrupt database bytes, and an unwritable profile directory repaired before Retry.
- Expected: visible onboarding; unchanged corrupt bytes; no premature write to unwritable storage; Retry reopens the same repaired path.
- Actual: matches expected behavior.
- Root cause: not a defect.
- Repair: not applicable.
- Automated evidence: validation, smoke, corrupt, and unwritable scenarios pass.
- Exact-AppImage evidence: `package/visible-window.png` and `package/final-full-suite/07`–`08`.
- Challenger disposition: no reproducible defect in these states.

## Completion gate

The evidence/documentation pass is internally consistent with application commit `18be03e…` and package `80d932…`, but the exhaustive audit is not complete. `FIN-TAX-003` and `PROD-001` remain Open. In particular, this file does not claim that state-specific controls were repeated through all 32 combinations, and no control is marked Verified solely from source or component evidence.
