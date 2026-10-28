# UI verification

Use this guide to check panel changes in a browser and in Codex, in both the
inline widget and the expanded panel. [Local development](development.md#panel-dev-host)
covers dev host setup, live service connections and
[fixture recording](development.md#recorded-fixtures).

## Workflow

1. Reuse the `panel-dev` server from `.claude/launch.json` (port 5317), or start
   `npm run dev:ui`. Start `service-dev` (port 17317) only for live data. Tell
   the user when you start or restart a server. Stop only the servers you
   started.
2. Open `http://127.0.0.1:5317`, set **Data** to **Fixtures**, and
   **Relaunch**. The iframe may stay blank briefly.
3. Check the relevant scenarios at narrow and wide widths, and in both themes
   when layout or styling changes. Check keyboard navigation, focus, loading,
   error and empty states when the change involves them.
4. Afterwards, use **Reset projects** and clear **Claude Code unavailable** if
   you changed them.

Fixture mode makes no model calls and sends nothing to a real parent chat. Its
interactions still update fixture state and temporary Git repositories. Use
live data only for behavior fixtures cannot show. During a read-only live check,
select **Launch: Global** and do not start tasks.

To add fixtures, build events with the typed builder in
`dev/panel/scenarios/timeline.ts` or record them. Add a fixture for every new
activity row or event kind in its owning scenario module, and register it in
`dev/panel/scenarios/fixtures.ts`. `preview-sdk-fixtures.test.ts` replays built
and recorded fixtures through the provider.

## Scope and host controls

The dev host saves its settings in browser storage. Changing a setting relaunches
the panel.

| Control                               | Use                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Launch**                            | **Thread** shows one conversation's tasks. **Global** shows every project and conversation. `dev-thread` has `/demo/project` and `/demo/website` tasks, and `other-thread` owns two. |
| **Theme**, **Display**, **Width**     | Width offers 360, 480, 760 and Fill. A short 360px frame can scroll the whole inspector, so use a taller or wider frame to check the fixed-header layout.                            |
| **Send messages**, **Update context** | Vary the host capabilities the panel sees.                                                                                                                                           |
| **Successful limit updates**          | Lets budget Apply, Continue prefill and the send-button tooltip succeed without a service.                                                                                           |
| **Slow async reads**                  | Delays fixture content reads, including the initial task list, so you can inspect loading placeholders. Writes and live mode are unaffected.                                         |
| **Inspector > Bridge log**            | Lists tool calls, message and context requests and display-mode changes, including those made while the inspector was closed. `served` names the source that answered each call.     |
| **Inspector > Host settings**         | Holds the controls below.                                                                                                                                                            |

Host settings:

- **Sandbox cwd** supplies the chat directory. The default is the checkout,
  which is not a fixture project and shows **Add chat project**. Enter
  `/demo/website` to open that project.
- **Automatically add chat projects** matches the user setting of that name.
- **Claude Code unavailable** shows readiness notices in the panel and the New
  task form.
- **Added projects** lists projects you registered. They persist across reloads
  until **Reset projects**.
- **Host style variable overrides** takes JSON. See
  [Measurement and checks in Codex](#measurement-and-checks-in-codex).

## Fixture catalogue

| Task                                        | Scenario                                                                                                                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review recorded edits                       | Typed SDK tool results replay through the mapper. Covers added, modified, deleted, command and incomplete rows and the command warning in both scopes.                              |
| Refactor the billing module                 | Running task with recorded modified, added and deleted files, command tags, incomplete files and a command warning.                                                                 |
| Live: …                                     | Latest activity and clocks for thinking, tool, compaction, retry, rate limit, ordinary work, finishing, hook, background task and provider failure.                                 |
| Live: conversation cycle                    | Repeats a 32-second turn with thinking, two streamed replies, a long tool command, compaction and completion. Reloads show up to three recent turns.                                |
| Live: streaming reply                       | Chat draft grows over time and restarts.                                                                                                                                            |
| Recorded: …                                 | Real SDK runs: steer, interrupt and send now, streamed reply, question interrupted and resumed, read-only MCP review.                                                               |
| Limit upload sizes                          | Parent-started turns, user and parent follow-ups, Markdown lists, tables, code, footnotes, relative links and images, HTML-like prose. Recorded changes remain after later commits. |
| Tidy the settings copy                      | Taken and pending steers, and queued messages including one from the parent. New steers and queued messages stay until reload.                                                      |
| Rename the feature flags                    | Interrupted task with a paused queue: a leftover steer, then two messages to reorder, edit or remove until reload.                                                                  |
| Move the date helpers                       | Cost budget exhausted. The warning notice applies a higher limit without sending a message.                                                                                         |
| Finish the date helper migration            | Runtime budget exhausted. The warning notice applies a higher runtime limit without sending a message.                                                                              |
| Move the screens to the new layout          | Long Chat conversation for scrolling.                                                                                                                                               |
| Stabilise the retry timer test              | Worktree recreated from its branch in a new session.                                                                                                                                |
| Migrate the config loader                   | Pending inline question and queue-only composer. Queued messages stay until reload.                                                                                                 |
| Plan the sign-in rollout                    | Three stacked questions, single and multiple choices, and queue-only composer.                                                                                                      |
| Investigate session expiry regression       | Pending permission request.                                                                                                                                                         |
| Review the inspector layout change          | Waiting on a dependency.                                                                                                                                                            |
| Convert the test suite to the new runner    | Trimmed timeline, scrolling, View activity for turns inside and outside the recent window, and custom instructions in Details.                                                      |
| Move the API clients onto the retry wrapper | Many turns, including a failure. View activity loads older turns separately and scrolls to recent ones.                                                                             |
| Catalogue the design assets                 | Thinking, images, documents, web search, plugin and memory signals.                                                                                                                 |
| Tighten the task inspector layout           | Two committed turns, the **This turn** option, recorded changes and clean worktree removal.                                                                                         |
| Fix the flaky retry test                    | Removed worktree with its branch retained.                                                                                                                                          |
| Draft the release notes                     | Removed worktree and deleted branch.                                                                                                                                                |
| Speed up the production build               | 60-file recorded diff, listed as 61 files because its rename shows as a deletion and an addition. Removal asks before discarding checkout changes.                                  |
| Profile the production build                | Large added files and multiple pages of diff and file previews.                                                                                                                     |

Read state:

- Audit dependency licences, Fix the flaky retry test, Migrate the config loader
  and Investigate session expiry regression start unread. Use them to check the
  row dot and the **Unread** filter.
- Move the screens to the new layout starts read through the middle, so Chat
  opens at its **New** divider partway down.
- The other fixtures start read. Read marks reset when the preview reloads.

Changes fixtures in `dev/panel/scenarios/change-fixtures.ts` replay recorded
edits into real temporary Git repositories for file previews and worktree
actions. Worktree actions change these repositories. A Vite restart or a service
source edit rebuilds them. To get fresh state without restarting a shared dev
host, start another with `npx vite --port <port> --strictPort`. `large-files.ts`
supplies the 60-file diff, minified JSON, a large CSV, a log file, long Markdown
with heading links, a single long line and an oversized SVG that displays as
source.

## Measurement and checks in Codex

### Browser measurement

The panel runs in an iframe. Inspect its `contentDocument` when the browser tool
supports DOM inspection.

- If the tool's form input does not change a host select, set `.value` and
  dispatch `change`.
- Use `getBoundingClientRect` for layout and `scrollIntoView` for long feeds.
- Hidden panes throttle frames. To inspect an exact animation state, pause
  `element.getAnimations()` and set `currentTime`.

### Host styles

The dev host sends no style variables by default. Enter JSON in **Host style
variable overrides** to test them. `dev/panel/host/host-styles-light.json` and
`host-styles-dark.json` hold captures from Codex desktop's MCP App context for
reference. The panel drops style keys the installed SDK does not recognize, so
new host keys do not break initialization.

### Checks in Codex

The dev host does not reproduce Codex's iframe sandbox, CSP or placement.
Automated tests and fixture screenshots cannot show message delivery or
placement in Codex. For changes that affect the panel in Codex, build and open
an approved repository in Codex, then check:

| Change            | Check                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any panel change  | Scope and New task prefills, without submitting. Then reopen an existing task.                                                                                  |
| Entrypoints       | The sidebar entrypoint and switching between inline and expanded.                                                                                               |
| Folder browsing   | On macOS, **Browse** and cancel leaves the selection unchanged. Choosing a valid Git root registers and selects it without starting a task.                     |
| Scope             | Two chats with different projects stay separate.                                                                                                                |
| Composer mentions | Search finds Claude, selecting it delivers the provider hint, and the delegation flow uses it. See [Composer mentions](host-capabilities.md#composer-mentions). |
