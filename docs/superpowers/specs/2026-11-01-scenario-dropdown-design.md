# Scenario dropdown

The header dropdown will let people switch, add, and delete scenarios in one place. “Add new scenario” uses the existing fork behavior: copy the selected scenario's applied inputs, ask for a name, and activate the copy. Existing source drafts remain intact.

Use a button with an accessible menu because native select options cannot contain separate delete buttons. Each scenario row has a selection action and a trash button; the baseline stays protected. Retain the existing fork shortcut and rename management.

Deleting opens a first confirmation describing the inputs and drafts affected. Continuing shows a separate final confirmation with Cancel focused. Only the final “Delete scenario” action queues deletion. Cancel and Escape at either step make no changes. Keep the captured scenario target across both steps, preserve cancellation of queued work, and return focus to the dropdown.

The menu supports keyboard navigation, Escape, outside dismissal, long names, and mobile widths. Reuse the manager's persistence and active-scenario fallback behavior without changing stored data or financial calculations.
