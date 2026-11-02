# Scenario Dropdown Implementation Plan

> **For agentic workers:** Use the development skills to implement each task and verify the complete change.

**Goal:** Add creation and deletion to the header scenario dropdown, with two confirmations before deletion.

**Architecture:** A small accessible menu component renders scenario rows and delegates actions to the existing scenario controls and manager. Dialogs retain scenario targets and cancelable queued operations.

**Tech Stack:** TypeScript, native DOM, CSS, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-01-scenario-dropdown-design.md`

**Constraints:** Work directly on main as required by CLAUDE.md. Preserve baseline protection, source drafts, local persistence, stale-target rejection, and queued-action cancellation. Do not push.

- [x] Add failing browser regressions for creation through the menu, two confirmations, cancellation, inactive deletion, baseline protection, and keyboard dismissal.
- [x] Implement the scenario menu, wire add/switch/delete, and add the second confirmation with safe focus defaults.
- [x] Update existing browser and acceptance flows for the custom menu and final confirmation; test persistence after reload and mobile layouts.
- [x] Run typechecking, the full test suite, production build and browser acceptance checks; inspect screenshots, obtain independent code review, address findings, and commit locally.

**Review focus:** No writes after the first confirmation or cancellation; delete controls never switch scenarios; stale dialogs cannot delete replacements; focus never returns to a hidden menu item; long names and menus fit mobile screens.

**Review resolutions:** Expose the selected scenario as the trigger description. Keep the scrollable menu out of the native tab sequence so Shift+Tab returns to the trigger; cover this with 30 scenarios at 375×600.

**Native browser correction:** Use `FocusEvent.relatedTarget` to keep the menu open during pointer focus changes between its controls; Chromium temporarily reports BODY as active before the next control receives focus. Close after native Tab navigation completes.

**Validation:** Typechecking and production build passed. The full Vitest suite passed 1,882 tests in 121 files with `--maxWorkers=1 --testTimeout=15000`; the default five-second limit had timed out two existing property/ADU form tests. All 33 scenario browser tests passed again after the final focus correction. The full acceptance run passed 66 cases; a rebuilt, focused run passed all 13 scenario/keyboard/appearance cases and refreshed six screenshot baselines. Pixel comparison confirmed those changes are confined to the header. Three WebKit date/month checks passed with temporary environment cleanup (`env -u GTK_PATH -u GIO_MODULE_DIR -u GIO_EXTRA_MODULES -u LD_LIBRARY_PATH -u LD_PRELOAD -u SNAP_LIBRARY_PATH`); inherited `GIO_MODULE_DIR` otherwise loads an incompatible Snap library before app navigation. No persistent environment or test configuration changes were needed.
