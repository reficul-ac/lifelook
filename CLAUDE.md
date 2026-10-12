# Development instructions

- Perform development directly on `main`. Do not create or use feature or development branches.
- Commit changes on `main`; the only permitted push target is repository `reficul-ac/lifelook`, remote `origin`, branch `main`.
- Before every command or tool action that performs a `git push`, obtain explicit user confirmation for the exact repository, remote and branch. This applies to force pushes, aliases, scripts and chained commands. General requests to work autonomously are not push confirmation. After confirmation, push only the confirmed target.

## Current application

LifeLook is a browser application with native HTML forms and a separate TypeScript calculation engine. Run commands from the repository root using Node 22:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:1421`. Run `npm run check` for typechecking, engine/browser tests, the production build and Chromium acceptance flows; install Chromium first with `npm exec playwright -- install chromium`. Use `npm run build` and `npm run preview` to inspect the production application on `http://127.0.0.1:4174`.

Keep the calculation engine independent of browser APIs, persistence and the clock. Financial rules and their provenance belong in versioned rule packs; reference expectations must come from independent calculations and primary-source worksheets. Preserve explicit unknown history, dependent-result availability, provisional assumptions and saved input revisions.

## Basic app usage

1. In **Household**, enter the two tax filers, full-year California and married-filing-jointly assumptions, forecast dates, opening cash and applicable tax history.
2. Add salaries and dated changes in **Income**; enter operating expenses and debts in **Expenses and debts**.
3. In **Investments**, enter account ownership, opening balances, return assumptions, contribution requests and required eligibility history.
4. In **Properties**, enter property values and acquisition history, linked mortgages, rental or ADU allocations, expenses and separate federal/California tax history. Confirm a known zero explicitly; a blank required history remains unknown.
5. Use each record's **Save** action to validate its complete draft and recalculate. Invalid drafts remain editable while the projection stays tied to the last saved revision. If a draft conflicts with a newer save, use **Discard edits and reload saved values**, then reapply changes.
6. Inspect annual projection rows, expand months and open tax explanations to see calculations, funding gaps, rule provenance and unresolved issues.
7. Use **Backups and recovery** to export or import a JSON plan. Invalid restores leave the current plan intact. If saving fails, export the valid in-memory plan before closing. An unreadable stored document can be downloaded for recovery.

Plans retain JSON schema version 1 and storage key `lifelook.foundation.plan.v1`. Storage is local to each browser origin; use JSON export/restore to transfer plans between development and preview. The former desktop application's SQLite profiles and `.lifelook` backups are not compatible with this format. Do not delete user device data when removing obsolete source code.

The approved rebuild design and plan under `docs/superpowers/` are historical records. Their former `foundation/` paths describe the implementation stage; the application now lives at the repository root. See [README.md](README.md) for current commands, coverage and source updates.
