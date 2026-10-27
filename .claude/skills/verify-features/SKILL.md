---
name: verify-features
description: Verify, QA or own a feature or user experience of the Delegated Work panel or the extension service end to end, using fixtures and the fake worker so no model calls run. Use for manual-testing passes, checking a change in the browser, or confirming a feature still works before a release.
---

# Verify features with fixtures

Use this skill to check a feature the way a user meets it, then decide what
coverage it needs. Read [UI verification](../../../docs/ui-verification.md)
and [Fixture provider scenarios](../../../docs/fixture-scenarios.md) first.

Never start live Claude tasks. Live data is for read-only checks that fixtures
can't show, with **Launch: Global** and no task starts.

## 1. Pick the scope

Name the feature area and the behaviors to check. Give each behavior an ID,
such as `CH1` for the first Changes check.
[Delegated Work panel](../../../docs/panel-guide.md) describes the expected
behavior. Then find what already exists for the area:

- [Verified behaviors](../../../tests/e2e/README.md#verified-behaviors) lists
  the browser flows. Skip behaviors a flow already verifies unless the change
  touched them.
- The [fixture catalogue](../../../docs/ui-verification.md#fixture-catalogue)
  lists the dev host tasks that show prepared states.
- [Prompt markers](../../../docs/fixture-scenarios.md#prompt-markers) and the
  scenario tables after them show how to make the demo's fake worker produce
  it.

These areas need setup the tables don't describe:

- **Settings changes.** Prepared fixtures can't save, export or import
  settings, so use the demo. To check
  custom instructions on a task, save them, start a task with that profile and
  open Details.
- **New task toasts.** In the demo, open a task, then start another from a
  second console tab or through MCP.
- **User-only settings.** An agent `update_settings` call that sets
  `approvals`, `projects`, `profiles` or `providers.<id>` must fail and name
  the setting. `src/service/features/settings/settings.integration.test.ts`
  covers this.
- **[Port recovery](../../../docs/configuration.md#service-address).**
  `tests/integration/service/launcher.test.ts` covers it. To check it by hand,
  hold port 17317 with another program, then start the plugin's proxy without
  an address override.

## 2. Choose the tool

[Choosing a development tool](../../../docs/development.md#choosing-a-development-tool)
compares the options. For fixture verification:

- Use `npm run dev:ui` with **Data: Fixtures** for layout, styling, prepared
  states and host controls.
- Use `npm run demo` for task controls and settings changes that need a real
  service. Its fake worker makes no model calls. Put fixture markers in task
  descriptions or follow-ups.
- To check demo tasks in the dev host, pair them as [Demo](../../../docs/development.md#demo)
  describes.

Follow the [UI verification workflow](../../../docs/ui-verification.md#workflow)
for reusing and stopping servers. The demo needs port 17317. If another service
holds it, ask the user before stopping that service, since it may be their own.

## 3. Drive it in a browser

Use the project's Playwright with the Chromium that
[Checks](../../../docs/development.md#checks) installs. The dev host embeds the
panel in an iframe, so use `page.frameLocator("iframe").first()` for panel
elements.

The host toolbar's selects carry labels you can target with `getByLabel`. Pass
these option values to `selectOption`:

| Label   | Values                      |
| ------- | --------------------------- |
| Data    | `fixtures`, `live`          |
| Launch  | `thread`, `global`          |
| Theme   | `light`, `dark`             |
| Display | `inline`, `fullscreen`      |
| Width   | `360`, `480`, `760`, `fill` |

A fresh browser starts with **Launch: Thread** and **Display: inline**. Use
**Launch: Global** with the **All** filter to list every fixture task, and
**Display: fullscreen** to open Settings and the task inspector.

Check each behavior at the widths, themes and states the
[workflow](../../../docs/ui-verification.md#workflow) lists. Save screenshots
under a temporary directory, such as `/tmp/verify-<area>/`, and look at them.
Text checks alone miss layout faults.

## 4. Record results

Report a checklist:

```text
| ID  | Behavior                                  | Result | Evidence                     |
| CH1 | File tree opens a folded file's diff      | Pass   | /tmp/verify-changes/ch1.png  |
| CH2 | Tree rows truncate at 360px               | Fail   | Name overflows its row       |
```

List what you couldn't check and why, including any
[live-only checks](#live-only-checks) the feature touches.

## 5. Decide on coverage

Follow [Choosing test coverage](../../../docs/development.md#choosing-test-coverage).
When a gap needs new coverage:

- Add a new browser flow's ID to
  [Verified behaviors](../../../tests/e2e/README.md#verified-behaviors).
- Add a missing fixture as a scenario in `dev/panel/scenarios/`, registered
  in `fixtures.ts`, or as a marker in `dev/service/fixture-scenarios.ts`.
  Then add it to the owning guide's catalogue.

## 6. Clean up

Stop the servers you started and reset the host settings you changed, as the
[workflow](../../../docs/ui-verification.md#workflow) describes.

## Live-only checks

Fixtures can't show these. They need the
[live Claude checks](../../../docs/claude-verification.md#live-claude-checks)
or [checks in Codex](../../../docs/ui-verification.md#checks-in-codex):

- Native Claude permission and sandbox enforcement. The fixture simulates the
  decisions only.
- Whether turning off **Load Claude Code settings** or **Your MCP servers**
  keeps settings files, hooks and outside MCP servers out of a session beyond
  the project fixture. The live `isolated` and `parity` scenarios check the
  fixture's sources only.
- Custom instructions reaching Claude's system prompt and Claude following
  them. Tests check only the options the service passes.
- Codex placement, the iframe sandbox and CSP, switching between inline and
  expanded, message delivery to the parent chat and composer mentions.
- A Codex thread with no project or working directory.
- A Codex thread that delegates several Claude requests while it works, with
  the inline preview showing each live status.
- SDK changes in a new Claude Code release. Record a fresh fixture with
  `npm run fixture:record` and replay it through
  `dev/panel/scenarios/preview-sdk-fixtures.test.ts`.
