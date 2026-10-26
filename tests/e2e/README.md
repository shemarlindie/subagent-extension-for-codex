# Browser flows

These Playwright flows drive the built console against a disposable service.
[Checks](../../docs/development.md#browser-flows) covers running them and
inspecting failures, and
[Choosing test coverage](../../docs/development.md#choosing-test-coverage)
covers when to add one.

## State setup

- One flow covers login and explicit project registration in full. Other flows
  log in and register through the public HTTP endpoints, sharing cookies with
  their fresh browser context.
- Reloads establish persistence. Playwright routing drops responses, and closing
  the service's open connections drops the event stream.
- Most services run inside their Playwright worker process. The recovery flow
  runs the development fixture service as a separate process, crashes it and
  reopens the same data directory on the same port.
- Suites configure the fixture worker with `test.use({ fixtureProvider })`, for
  example to fail provider session deletion.

## Performance

Measure performance with the same build and trace settings. Run
`npx playwright test --workers=1 --reporter=json` to see serial costs, then
compare the default worker count. Add `--repeat-each=3` to check repeatability
and isolation. The JSON report records total and per-test durations, and trace
hooks separate setup from the flow. Keep condition-based assertions and failure
diagnostics when optimizing.

## Verified behaviors

The browser flows verify:

| ID  | Expected behavior                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------- |
| E1  | Sign in and explicitly register a project through the console.                                                              |
| E2  | Start a task, answer its question and approve a simulated tool request.                                                     |
| E3  | Reload persisted history, then send a follow-up in the same worker session.                                                 |
| E4  | Start in a worktree, preview recorded edits, remove the worktree and branch, then reload the retained diff.                 |
| E5  | Preserve a failed turn across reload and successfully continue the same task.                                               |
| E6  | Start a task with Enter, keep composer focus, archive and restore it, cancel deletion and explicitly delete it.             |
| E7  | Save settings, reload persisted values and retain a new-task draft while visiting settings.                                 |
| E8  | Queue messages, edit, reorder and remove them, interrupt, reload the paused queue and resume in order.                      |
| E9  | Exhaust a runtime budget, raise its limit, reload and successfully continue.                                                |
| E10 | Create a dependency through the task form, preserve its wait across reload and release it after the prerequisite completes. |
| E11 | Rename a project and verify both removal choices, retaining checkout files and cleaning task worktrees only when requested. |
| E12 | Crash a service with running and queued work, restart, sign in and resume the recovered queue without losing its order.     |
| E13 | Answer stacked questions with typed and multiple choices, undo and keep skips, then deny a tool with a message.             |
| E14 | Keep tasks unread until read, mark them read or unread by menu, reply or bulk action, and reload the results.               |
| E15 | Lose a send's response, keep the draft with retry guidance and deliver the retried message once.                            |
| E16 | Lose the event stream, show reconnection and display work finished while disconnected.                                      |
| E17 | Glide after a reply at the end, fade new messages in without moving others back, hold and restore the reading position.     |
| E18 | Steer a running turn, promote a queued message, interrupt to send it now and clear a paused queue.                          |
| E19 | Reject a lower cost limit, raise a spent cost budget and continue.                                                          |
| E20 | Fail a dependent with its failed prerequisite, then resume both with follow-ups.                                            |
| E21 | Filter, search and rename tasks, keeping the filter and title across reload.                                                |
| E22 | Reject an invalid setting, keep drafts, confirm discarding edits, reset a section and start from saved defaults.            |
| E23 | Start a task with a chosen model and permission mode and see the policy applied.                                            |
| E24 | Review recorded diffs across scopes, use floating file navigation, mark viewed files and use previews.                      |
| E25 | Delete a running task with its agent session and bulk delete archived tasks.                                                |
| E26 | Keep a task whose agent session can't be deleted, then delete it locally.                                                   |
| E27 | Switch between the list and a task in a narrow console without horizontal overflow.                                         |
| E28 | Search, open a task and move between its tabs by keyboard.                                                                  |
| E29 | Announce a new task, preserve the open task, draft, focus and reading position, then open it with View.                     |
| E30 | Add a project from the new-task composer, select it there without changing the list scope and start a task in it.           |
| E31 | Keep reply geometry stable through streamed handoffs and preserve reading position through changing activity.               |

Accepted limits:

- Focused component tests own large file previews, clipboard handoff and theme
  presentation.
- `tests/integration/service/` owns launcher and package lifecycle details.
- Browser flows run desktop Chromium only.
- The fake worker establishes extension routing and persistence. It does not
  establish native Claude permissions, live Codex placement or host message
  delivery. Use [UI verification](../../docs/ui-verification.md) and
  [Claude execution verification](../../docs/claude-verification.md) for those.
