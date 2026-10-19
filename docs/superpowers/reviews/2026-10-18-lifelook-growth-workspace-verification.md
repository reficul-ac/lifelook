# Growth workspace verification

Execution date: 2026-10-18. Synthetic financial data only.

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

The synthetic 30-year salary/account/property/ADU observation verifies immediate raw input feedback, an honest Updating source, worker completion and unchanged persisted JSON. It records feedback/completion timing without a duration pass budget. The final run writes actual measurements to `/tmp/lifelook-growth-workspace/responsiveness.json`; numeric timings remain pending the root full run.

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

Root is running `TZ=UTC npm run check` with the clean local GTK/GIO environment above, then coordinates `TZ=America/Los_Angeles npm run test:engine` and `TZ=America/Los_Angeles npm run test:browser` sequentially. Final complete-suite outcomes remain pending; the focused results above are completed evidence.
