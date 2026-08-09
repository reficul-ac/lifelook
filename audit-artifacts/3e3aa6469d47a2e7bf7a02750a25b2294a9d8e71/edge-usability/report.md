# Edge/usability audit

Commit: `3e3aa6469d47a2e7bf7a02750a25b2294a9d8e71`

## Limitation

Native pointer/keyboard, focus rendering, screen-reader exposure, and screenshots at 920×650, 1024×768, 1280×820, and large desktop are **Blocked** by the already-captured WebKit loader failure in `../onboarding-persistence/app.log` and `../onboarding-persistence/01-fresh-onboarding.png`. Source/component evidence is explicitly not equivalent to native interaction. The focused component suite passes 6/6, but only one test clicks the theme button and none tests keyboard traversal, accessibility, reduced motion, or viewport layout.

## Explicit dispositions

| Area/control | Disposition | Evidence/rationale |
|---|---|---|
| Keyboard Tab order through onboarding | Blocked native; implementation-supported | Native inputs/buttons are in DOM order (`App.tsx:348-513`), but calendar input and actual focus order unverified. |
| Enter submits onboarding form | Blocked native; implementation-supported | Native form submit (`App.tsx:269,348`) and submit button (`505-511`). |
| Space/Enter activate ordinary buttons | Blocked native; implementation-supported | Native `button` elements; no packaged test. |
| Account radio pointer selection | Blocked native; component pass for savings/credit | `App.test.tsx:76-109`. |
| Account radio arrow-key behavior | Defect | Five `role=radio` buttons are all ordinary tabbable buttons; no roving tabindex or arrow handler (`App.tsx:411-430`). |
| Visible focus on ordinary buttons/inputs | Blocked native | No global focus override; UA rendering must be checked in WebKit. |
| Visible focus on Activity search | Defect | Input explicitly removes outline and wrapper has no `:focus-within` style (`styles.css:422-439`). |
| Accessible names: onboarding inputs | Implementation-supported | Explicit labels/aria-labels (`App.tsx:351-378,432-459,585-606`). |
| Accessible names: header search/theme | Implementation-supported | `aria-label` at `App.tsx:200-206`. |
| Accessible names: Settings switches | Defect | Switch buttons contain only an empty span and are not associated with adjacent text (`App.tsx:1079-1100`). |
| Loading/error announcements | Implementation-supported | `role=status` and `role=alert` (`App.tsx:80-91`). |
| Onboarding validation announcement | Implementation-supported; native blocked | `role=alert` (`App.tsx:490-493`). |
| Settings save/error announcement | Partial/Defect | `role=status` exists (`1075`), but rejected async save is uncaught (`1007-1029`) and yields no announced actionable error. |
| Landmarks | Implementation-supported | `nav aria-label`, `aside`, and `main` (`App.tsx:160-193`). |
| Current navigation state | Defect | Visual `.active` only; no `aria-current` (`App.tsx:167-177`). |
| Plan row expansion state | Defect | Buttons lack `aria-expanded` and `aria-controls`; monthly detail has no associated region (`App.tsx:875-913`). |
| Chart accessible name/data alternative | Defect | Label sits on generic div with no image role; SVG is unlabeled and the fixed plotted series has no textual data alternative (`App.tsx:630-654`). |
| Dark theme immediate toggle | Passed component only | `App.test.tsx:14-20`. |
| Dark theme relaunch/system preference | Defect | State always initializes false and bootstrap has no settings (`App.tsx:120`; `repository.ts:3-5`). |
| Dark theme contrast | Defect | Positive `#58745b` and negative `#a45e57` on dark `#20231f` calculate to 3.08:1 and 3.27:1; used for small text (`styles.css:46-54,257-270,321-323`). |
| Reduced-motion OS preference | Implementation-supported; native blocked | CSS media query removes animation/transitions (`styles.css:555-562`). |
| Reduced-motion Settings switch | Defect | Always false; no handler/state/class or persistence (`App.tsx:1093-1100`). |
| Minimum 920×650 layout | Blocked native; risk | Window/body minimum is 920; only breakpoint is 1050 (`tauri.conf.json`; `styles.css:18,544-554`). No automated viewport check. |
| 1024×768 / 1280×820 / large desktop | Blocked native | No screenshot/interaction possible. |
| Long household/profile/member/account names | Blocked native; defect risk | Fixed 224px sidebar/profile has no `min-width:0`, overflow, truncation, or wrapping policy (`styles.css:56-65,120-153`); account rows likewise have no content constraints (`353-389`). |
| Large/negative currency in metrics/accounts | Blocked native; defect risk | Grid cells and flex content have no `min-width:0`/overflow-wrap; exact values can exceed cards (`styles.css:296-323,353-389`). |
| Empty account list | Defect | Net Worth renders a blank `Accounts & assets` section with enabled no-op Add account, no empty-state instruction (`App.tsx:949-983`). |
| Expanded 12-month table at minimum window | Blocked native; implementation-supported vertically | Normal document flow creates content height; exact clipping/scroll/focus visibility unverified (`App.tsx:896-911`). |
| Horizontal overflow at supported minimum | Blocked | Body enforces 920 minimum and no horizontal handling; must be measured in native window (`styles.css:16-20`). |

## Defects

### EDGE-D1 — Reduced-motion switch is an enabled no-op

- Severity P1; accessibility/dead control.
- Reproduce: Settings → focus “Reduced motion” switch → activate with pointer, Space, or Enter. Expected checked state changes, motion is disabled, and choice survives relaunch. Actual: button has no handler; `aria-checked` is permanently false. Only OS `prefers-reduced-motion` is honored.
- Source: `App.tsx:1093-1100`; `styles.css:555-562`; PLAN promises reduced-motion support and checks (`PLAN.md:19,65`).
- Native/relaunch: Blocked by WebKit failure; source outcome deterministic.
- Fix/acceptance: real labeled switch, state and persisted setting, root reduced-motion class plus OS preference; all transitions disabled immediately and after relaunch, with pointer/Space/Enter tests.

### EDGE-D2 — Appearance switches have no accessible names

- Severity P1; accessibility.
- Reproduce with screen reader or accessibility tree in Settings. Expected “Dark theme, switch” and “Reduced motion, switch.” Actual switch buttons contain only an empty span and adjacent visible labels are not programmatically associated.
- Source: `App.tsx:1079-1100`.
- Fix/acceptance: add `aria-labelledby`/`aria-label` and descriptions; role queries by each visible name succeed and state announcement follows activation.

### EDGE-D3 — Dark theme is not persisted and ignores system preference

- Severity P2; persistence/appearance.
- Reproduce: enable dark theme, quit/relaunch. Expected persisted dark/system selection. Actual Workspace always starts `dark=false`; Bootstrap excludes settings despite a backend settings table.
- Source: `App.tsx:120`; `repository.ts:3-5`; schema at `src-tauri/src/lib.rs:127`.
- Relaunch: Blocked natively; deterministic initialization.
- Fix/acceptance: bootstrap stored appearance, model system/light/dark, update through backend, and verify relaunch plus OS theme changes.

### EDGE-D4 — Dark-theme semantic colors fail normal-text contrast

- Severity P1; accessibility/contrast.
- Actual computed source ratios: positive 3.08:1 and negative 3.27:1 against dark surface, below WCAG AA 4.5:1 for ordinary small text. These colors are used down to 10–12px.
- Source: `styles.css:46-54,257-270,321-323`.
- Fix/acceptance: theme-specific semantic colors with at least 4.5:1 for normal text and 3:1 for graphical/UI components; automated contrast checks for both themes.

### EDGE-D5 — Activity search has no visible keyboard focus indicator

- Severity P1; keyboard accessibility.
- Reproduce: Activity → Tab into Search activity. Expected clearly visible focus. Actual input outline is forced off and wrapper has no `:focus-within` replacement.
- Source: `styles.css:422-439`.
- Fix/acceptance: visible ≥2px focus indicator on the composite container meeting contrast requirements in both themes; screenshot/keyboard regression at all supported windows.

### EDGE-D6 — Custom radio group does not implement radio keyboard interaction

- Severity P2; keyboard accessibility.
- Actual: every radio-role button remains in Tab order and only click handlers exist. Expected one tab stop and arrow keys moving selection/focus, with Space selecting per ARIA radio pattern.
- Source: `App.tsx:411-430`.
- Fix/acceptance: native radio inputs or roving tabindex + arrow/Home/End behavior; automated keyboard tests for all five kinds.

### EDGE-D7 — Net-worth chart lacks a usable nonvisual alternative

- Severity P2; accessibility.
- Actual: `aria-label` is placed on a generic div without `role=img`; SVG has no title/description, and the plotted monthly trend has no tabular/text values. The headline provides only ending value, not trend data.
- Source: `App.tsx:621-654`.
- Fix/acceptance: expose chart role/name/summary and underlying time/value alternative; decorative SVG descendants hidden; accessibility-tree test confirms one meaningful chart object.

### EDGE-D8 — Current navigation and expanded rows do not expose state

- Severity P2; accessibility.
- Actual: current page is CSS class only; disclosure buttons omit `aria-expanded`/`aria-controls`.
- Source: `App.tsx:167-177,875-913`.
- Fix/acceptance: `aria-current=page`, stateful disclosure attributes, stable controlled panel IDs, and keyboard/state-announcement tests.

### EDGE-D9 — Empty Net Worth has no empty-state guidance

- Severity P2; usability.
- Preconditions: completed/seeded profile with zero accounts (or future supported deletion). Actual blank section under Accounts & assets plus an enabled no-op Add account. Expected explicit empty state and working next action.
- Source: `App.tsx:949-983`.
- Fix/acceptance: conditional empty state with functional add flow; keyboard activation and resulting persistence verified.

### EDGE-D10 — Settings save rejection is unhandled and unannounced

- Severity P2; error accessibility.
- Reproduce with backend save failure, activate Save members. Expected announced actionable error and retained edits. Actual awaited call has no try/catch; status is set only on client validation or success.
- Source: `App.tsx:1007-1029,1075`.
- Fix/acceptance: busy state, disabled duplicate submit, caught error in `role=alert`, focus management as appropriate, edits retained, retry succeeds.

## Follow-up blockers

Native verification remains mandatory for actual WebKit accessibility-tree names, calendar keyboard behavior, scrolling/focus retention, contrast after compositing/filtering, and all four viewport sizes. Long/extreme content should be seeded through SQLite but evaluated visually and by keyboard in the real packaged app; source risks above must not be converted to passes without that evidence.
