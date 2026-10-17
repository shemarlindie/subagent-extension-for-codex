# UI verification

Use this guide to verify the panel in a browser and in Codex, covering both
the inline widget and expanded panel. Setup, live service connections and fixture
recording are in [Local development](development.md#panel-dev-host).

## Workflow

1. Reuse the `panel-dev` server from `.claude/launch.json` (port 5317), or start
   `npm run dev:ui`. Start `service-dev` (17317) only for live data. Notify the
   user when starting or restarting a server. Leave existing servers running
   otherwise. Stop servers you started when verification is complete.
2. Open `http://localhost:5317`, set **Data** to `fixtures`, and **Relaunch**.
   The iframe may stay blank briefly. Fixture mode does not send messages to a real parent chat or
   start provider workers. Its simulated interactions can still update fixture
   state and temporary Git repositories. Use live data only for behavior fixtures cannot show. Select
   **Launch: global** and do not start tasks during a read-only check.
3. Check relevant scenarios below at narrow and wide widths and in both themes
   when layout or styling changes. Check keyboard navigation, focus, loading,
   error and empty states when the changed interaction involves them.
4. Reset fixture registrations and disable **Claude Code unavailable** after
   checking them. Worktree actions mutate temporary fixture repositories. A
   Vite restart or service-source edit rebuilds them.

Build new events with the typed builder in `dev/panel/scenarios/timeline.ts`, or
[record them](development.md#recorded-fixtures). Add a fixture for every new
activity row/event kind in its owning scenario module, and register it in
`dev/panel/scenarios/fixtures.ts`. `preview-sdk-fixtures.test.ts` replays built and
recorded fixtures through the provider.

## Scope and host controls

- **Launch: Thread** shows a conversation's tasks. **Global** shows every
  project and conversation. `dev-thread` has `/demo/project` and `/demo/website`
  tasks. `other-thread` owns two more.
- **Inspector > Host settings > Sandbox cwd** supplies the chat directory.
  The checkout itself is not a fixture project and shows **Add chat project**.
  Set `/demo/website` to check that project. Added fixture projects persist
  across reloads until **Reset projects**.
- **Claude Code unavailable** checks readiness notices in the panel and New
  task form. **Send messages** and **Update context** vary host capabilities.
- **Successful limit updates** enables the fixture's Apply, Continue-prefill
  and send-button tooltip flow without calling a service.
- **Slow async reads** delays fixture content reads so
  loading placeholders can be inspected across the panel, including the initial
  task list. Enabling it relaunches the panel automatically. Writes and live
  mode are unaffected.
- **Width** offers 360, 480, 760 and Fill. A short 360px frame can make the whole
  inspector scroll. Use a taller or wider frame to check the fixed-header layout.
- **Bridge log** shows tools, message/context requests and display-mode changes,
  including entries recorded while the inspector was closed. Its `served`
  field distinguishes browser fixtures, fixture service and live service.

## Fixture catalogue

| Task                                        | Scenario                                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review recorded edits                       | Typed SDK tool results replay through the mapper, covering added, modified, deleted, command and incomplete rows plus the command warning in both scopes.                                   |
| Refactor the billing module                 | Running task with recorded modified, added and deleted files, command tags, incomplete files and a command warning in both scopes.                                                          |
| Live: …                                     | Latest activity and clocks: thinking, tool, compaction, retry, rate limit, ordinary work, finishing, hook, background task and provider failure.                                            |
| Live: streaming reply                       | Chat draft grows over time and restarts.                                                                                                                                                    |
| Recorded: …                                 | Real SDK runs: steer/interrupt/send-now, streamed reply, question interrupted and resumed, read-only MCP review.                                                                            |
| Limit upload sizes                          | Parent-started turns, user and parent follow-ups, Markdown lists/tables/code, footnotes, relative links and images, HTML-like prose. Recorded changes remain available after later commits. |
| Tidy the settings copy                      | Taken and pending steers, queued messages including one from the parent. New steers and queued messages stay until reload.                                                                  |
| Rename the feature flags                    | Interrupted task with a paused queue: a leftover steer, then two messages to reorder, edit or remove until reload.                                                                          |
| Move the date helpers                       | Cost budget exhausted. The warning notice applies a higher limit without sending a message.                                                                                                 |
| Finish the date helper migration            | Runtime-only budget exhausted. The warning notice applies the higher runtime limit without sending a message.                                                                               |
| Move the screens to the new layout          | Long Chat conversation for scrolling.                                                                                                                                                       |
| Stabilise the retry timer test              | Worktree recreated from its branch in a new session.                                                                                                                                        |
| Migrate the config loader                   | Pending inline question and queue-only composer. Queued messages stay until reload.                                                                                                         |
| Plan the sign-in rollout                    | Three stacked questions, single/multiple choices and queue-only composer.                                                                                                                   |
| Convert the test suite to the new runner    | Trimmed timeline, scrolling and View activity for turns inside and outside the recent window.                                                                                               |
| Move the API clients onto the retry wrapper | Many turns, including a failure. View activity loads older turns separately and scrolls to recent ones.                                                                                     |
| Catalogue the design assets                 | Thinking, images, documents, web search, plugin and memory signals.                                                                                                                         |
| Tighten the task inspector layout           | Two committed turns, the **This turn** option, recorded changes and clean worktree removal.                                                                                                 |
| Fix the flaky retry test                    | Removed worktree with branch retained.                                                                                                                                                      |
| Draft the release notes                     | Removed worktree and deleted branch.                                                                                                                                                        |
| Speed up the production build               | 60-file recorded diff. Removal asks before discarding checkout changes.                                                                                                                     |
| Profile the production build                | Large added files and multiple pages of diff/file previews.                                                                                                                                 |

Audit dependency licences, Fix the flaky retry test, Migrate the config loader
and Investigate session expiry regression start unread, for the row dot and the
**Unread** filter. Move the screens to the new layout starts read through the
middle of its conversation, so Chat opens at its **New** divider partway down.
The other fixtures start read. Read and unread marks stay
until the preview reloads (`dev/panel/scenarios/unread-tools.ts`).

Changes fixtures in `dev/panel/scenarios/change-fixtures.ts` use recorded edits
and real temporary Git repositories for file previews and worktree actions. `large-files.ts` supplies the 60-file diff, minified JSON,
large CSV and log files, long Markdown with heading links, a single long line,
and an oversized SVG that displays as source.

## Measurement and checks in Codex

The panel is an iframe. Inspect its `contentDocument` when the browser tool
supports DOM inspection. Host selects require setting `.value` and dispatching
`change` if the tool's ordinary form input does not work. Use
`getBoundingClientRect` for layout measurements and `scrollIntoView` for long
feeds. Hidden panes throttle frames: sample animations by pausing
`element.getAnimations()` and setting `currentTime` to inspect a precise animation state.

The dev host omits style variables by default. Enter JSON in the inspector to
test them. Light and dark captures from Codex desktop's MCP App context serve as
development references. The panel filters style keys the installed SDK does
not recognize, so later host additions do not prevent app initialization.

The dev host does not reproduce Codex's iframe sandbox, CSP or container placement.
For changes affecting the panel in Codex, build and open an approved repository
in Codex. Check scope and New task prefills without submitting, then reopen an
existing task. Check the sidebar entrypoint and inline/expanded switching when
their integration changes. Automated transport and DOM tests and fixture
screenshots cannot establish message delivery or placement in Codex.

For folder browsing changes, use **Browse** on macOS. Verify that cancelling
leaves the selection unchanged, and that choosing a valid Git root registers and
selects it without starting a task. For scope changes, use two chats with
different projects and confirm they stay separate.

For composer mention changes, verify that search finds Claude, selecting it
delivers the provider hint, and the delegation flow uses that hint. See
[Composer mentions](host-capabilities.md#composer-mentions).
