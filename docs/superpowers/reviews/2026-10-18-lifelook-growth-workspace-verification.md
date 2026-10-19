# Growth workspace verification

Execution dates: 2026-10-18–19 (America/Los_Angeles). Synthetic financial data only.

## Scope and commands

The new acceptance suites cover five viewport widths (320, 390, 768, 1180 and 1440 pixels), exact preview/Apply persistence, explicit inheritance and exceptions, owner changes, native dates/months/switches, both appearances, reduced motion and 200% text. Chromium retains the full application suite; `webkit-controls` is limited to `date-controls.spec.ts`.

The first focused Chromium command was `npm run test:e2e -- tests/e2e/growth-workspace.spec.ts tests/e2e/date-controls.spec.ts --project=chromium --workers=1`. It exited before running tests because the preview-server build found two optional RSU target accesses in the new rail. The owning task corrected these. Local preview/browser commands needed authorized escalation to use localhost.

After correcting synthetic fixture and existing disclosure selector errors, the focused run passed 11/12; the remaining ADU heading assertion was corrected to include its selected year and its isolated rerun passed 1/1. The responsive cases were then strengthened to catch the actual mobile issue below and rerun after the host fix.

| Check | Completed result |
| --- | --- |
| Five responsive widths, keyboard/touch chart selection, exact-input focus, Apply reachability | 5/5 pass after mobile fix |
| Native date/month/switch smoke in Chromium | 3/3 pass |
| Same scoped native-control smoke in WebKit | 3/3 pass |
| Existing forecast-overview, ui-revamp and child-planning regressions | 13/13 pass |
| Dark/light overview/property/paused snapshot update | 2/2 pass; six images inspected |

The responsive rerun command was `npm run test:e2e -- tests/e2e/growth-workspace.spec.ts --project=chromium --workers=1 -g 'usable at'`. Existing regressions ran with `npm run test:e2e -- tests/e2e/forecast-overview.spec.ts tests/e2e/ui-revamp.spec.ts tests/e2e/child-planning.spec.ts --project=chromium --workers=1`.

## Observations

Browsers: Playwright 1.58.2; Chromium 145.0.7632.6 (revision 1208); WebKit 26.0 (build 2248). All data is synthetic.

At 320/390 pixels the chart remained usable at its container width, keyboard and native touch taps selected the expected year, and both wheel and native touch vertical gestures scrolled the mobile workspace. Exact stock input retained its node, focused state and `8.10` text through completion. At 768/1180/1440 pixels chart/input/Apply fit, retained selected-year state and used the same financial results. Reduced-motion updates had no chart animation. At 390 pixels with 200% root text, both themes retained page containment and reachable table, cash-flow chart, tax explanation, applied ADU comparison and backup controls. Measured chart-source, exact-readout label and axis text contrast was at least 4.5 in both themes.

Screenshot review found a real mobile overlap: the focused field occupied viewport y40.16–84.16 while the sticky impact ribbon occupied y0–65.16. A new rectangle-intersection assertion reproduced it. The host moved the ribbon to its own row outside the scrollable workspace. All five responsive cases then passed, including focused-field and Apply nonintersection plus mobile wheel/touch scrolling. Representative local artifacts are `/tmp/lifelook-growth-workspace/light-390.png` and `/tmp/lifelook-growth-workspace/dark-1440.png`. Six committed appearance snapshots show the primary chart, final-year figure, theme colors, native date field, paused source labels and stable editor focus.

Exact comparison evidence uses a $10,000 stock account changing from its retained 5% to the reviewed 7.7% default: first-year net-worth change is +$270.00. Preview left saved JSON unchanged; Apply consumed one revision, saved category values/membership, and preserved the custom account, scheduled RSU account and property year override. Reload retained only applied inputs. Record/growth ownership changes, scenario return/resume and scenario replacement retained or invalidated the appropriate drafts/actions.

Native inputs round-tripped `1980-02-29`, `2028-02` and `2028-02-29` without a timezone conversion. Required empty dates paused preview and retained the earlier applied ISO value. Appearance updates and completed previews preserved the focused date/month node; Space activated the binary switch.

The synthetic 30-year salary/account/property/ADU observation verifies immediate raw input feedback, an honest Updating source, worker completion and unchanged persisted JSON. It records feedback/completion timing without a duration pass budget. The final UTC run measured input feedback at 25.5 ms and a completed preview 2218.0 ms after that feedback observation, with `pending` and `Updating · applied results` shown immediately. The run used Chromium 145.0.7632.6 alongside the full browser suite. These measurements are observations, not forecast-duration pass thresholds. The same run writes `/tmp/lifelook-growth-workspace/responsiveness.json` and attaches its JSON to the Playwright result.

## Local WebKit setup

Standard WebKit download succeeded. `playwright install-deps webkit` could not obtain sudo without a password. Missing libavif16/libwoff1 and their libgav1-1/libyuv0 dependencies were downloaded and extracted locally, then added only where absent to WebKit's private cache because its bundled launcher replaces `LD_LIBRARY_PATH`. No repository runtime dependency or system package changed.

A `DEBUG=pw:browser` probe traced the remaining navigation error to VS Code Snap's GIO module path loading an incompatible libpthread. The successful local smoke command was:

```sh
env -u GIO_MODULE_DIR -u GTK_PATH -u GTK_EXE_PREFIX -u GDK_PIXBUF_MODULE_FILE \
  LD_LIBRARY_PATH=/tmp/lifelook-webkit-libs/root/usr/lib/x86_64-linux-gnu \
  npm run test:e2e -- tests/e2e/date-controls.spec.ts --project=webkit-controls --workers=1
```

This passed all three WebKit tests. CI retains both timezone jobs and uses the standard `playwright install --with-deps chromium webkit` installation. No CI result is claimed before execution.

## Final checks

The final UTC check passed on source commit `cbefab0`: typechecking, all 120 unit files / 1,876 tests, the production build, and all 70 Chromium/WebKit acceptance tests. The local browser command used the clean GTK/GIO environment above. The Los Angeles engine run passed all 54 files / 1,145 tests; engine source did not change afterward. The Los Angeles browser run passed all 66 files / 731 tests on the same source commit. All eight implementation tasks are complete. Changes are committed locally on `main`; no push was performed. No runtime dependencies were added.

| Final command | Result |
| --- | --- |
| `TZ=UTC npm run check` | Pass: 1,876 unit tests and 70 acceptance tests, typecheck and build |
| `TZ=America/Los_Angeles npm run test:engine` | Pass: 1,145 tests |
| `TZ=America/Los_Angeles npm run test:browser` | Pass: 731 tests |

## Independent review and final corrections

A fresh `gpt-6-astra` reviewer inspected the whole change against the spec, all five required review-focus cases, and the decision ledger. There were no critical findings or declined-to-judge items. The comparison visibility finding was reproduced in real Chromium: switching Show applied plan off hid its curve but left its explicitly visible SVG child marker. The marker now follows the comparison preference, and the same browser test passes for both hiding and restoring it. Numeric comparisons and the shared chart domain are unchanged.

The first complete UTC unit run passed 1,869 of 1,872 tests. One assertion still expected the former first-year initial selection; it now expects the specified final-year ADU comparison and its focused suite passes. Two existing five-second form tests exceeded their deadlines. Profiling identified unrelated hidden report actions in global TestingLibrary accessibility queries: a button query took about 400–490 ms across the workspace versus 8 ms in its active editor. The property test helper now scopes editor-owned native targets locally while retaining TestingLibrary's role, accessible name, visibility and uniqueness checks, supplied subgroup scope, and global navigation fallback. All 41 affected tests pass at the original two-worker concurrency and unchanged time limits. No production behavior was changed to satisfy these test deadlines.

The second complete UTC run passed all 1,872 unit tests, typechecking and the build, then exposed three existing ADU browser failures (67/70 acceptance tests passed). A native-date blur microtask rebuilt the form before the next pointer activation completed, detaching the action or reverting the newly revealed editor section. Four interaction regressions reproduced held-pointer activation, keyboard activation, the next native date's unfinished segments, and disclosure state; each was observed red before the fix and all four pass. The structural refresh now waits for activation/default behavior to finish, retains focused native dates, and skips detached fields. Raw draft and preview updates remain immediate. The complete date/form pair passed 41/41, and all three affected ADU Chromium flows passed with retries disabled, unchanged financial assertions, unchanged helpers and unchanged timeouts. A fresh production build passed.

The independent review has no declined-to-judge items. Its comparison finding was regraded Important and fixed; no minor findings are deferred.

## Execution rulings

The following preserves the execution ledger's decisions in chronological order, including their costs if wrong:

- Ruling: Implement directly on main — repository CLAUDE.md explicitly requires it, overriding the skill worktree preference; attempted worktree creation was blocked before any branch was created — cost if wrong: changes share the current checkout.
- Ruling: Use parallel implementers with exclusive file ownership — the user explicitly requested multiple subagents, overriding executing-plans inline-only delegation guidance — cost if wrong: integration overhead, controlled by tests and a final independent review.
- Ruling: Treat the supplied plan and spec as the approved implementation scope — the user's direct execution request supersedes their draft-for-review status — cost if wrong: detailed proposed behavior may require adjustment after review.
- Ruling: Narrow record-opening and prerequisite test helpers to FocusedEditTarget alongside production routes — adding growth to EditTarget exposed pre-existing record-only assumptions in helper types — cost if wrong: tests needing to open growth must use the real rail.
- Task 1: Ruling: Increase the automatic-deposit comparison test budget from 15s to 45s — the new inherited-versus-explicit check performs two complete forecasts, with monetary assertions preserved — cost if wrong: a stalled test takes up to 30s longer to fail.
- Task 7: Ruling: Defer structural date-field refresh until blur while keeping raw draft and preview updates immediate — native browsers own unfinished date segments and rebuilding loses them — cost if wrong: linked-field help/classification can visually lag until blur.
- Ruling: Run one independent whole-change review alongside final verification — implementation and focused acceptance are complete and the user requested parallel accuracy/efficiency — cost if wrong: late verification fixes need explicit coverage; root will include them in the single test-verified fix pass.
- Task 8: Ruling: Scope property-test role queries to their active editor when the target is discovered there — TestingLibrary traversed hidden neighboring reports (400–490ms versus8ms locally), causing two existing5s checks to time out — cost if wrong: component tests would not detect duplicate labels outside their editor; all own-editor role/name/visibility/uniqueness assertions and global navigation fallbacks remain. Three affected suites41/41 pass at original2workers and unchanged timeouts.
- Final: Ruling: Grade the residual applied marker Important — disabling Show applied plan must remove the rendered comparison, and an unlabeled applied point still appears — cost if wrong: an extra focused regression and small visibility fix.
