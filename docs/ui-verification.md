# UI verification

Use this guide to verify the React UI in a browser and in Codex, covering both
the inline widget and expanded panel. Setup, live service connections and fixture
recording are in [Local development](development.md#panel-dev-host).

## Workflow

1. Reuse the `panel-dev` server from `.claude/launch.json` (port 5317), or start
   `npm run dev:ui`. Start `service-dev` (4317) only for live data. Notify the
   user when starting or restarting a server; leave existing servers running
   otherwise.
2. Open `http://localhost:5317`, set **Data** to `fixtures`, and **Relaunch**.
   The iframe may stay blank briefly. Fixture mode does not send messages to a real parent chat or
   start provider workers; its simulated interactions can still update fixture
   state and temporary Git repositories. Use live data only for behavior fixtures cannot show; select
   **Launch: global** and do not start tasks during a read-only check.
3. Check relevant scenarios below at narrow and wide widths and in both themes
   when layout or styling changes. Check keyboard navigation, focus, loading,
   error and empty states when the changed interaction involves them.
4. Reset fixture registrations and disable **Claude Code unavailable** after
   checking them. Worktree actions mutate temporary fixture repositories; a
   Vite restart or service-source edit rebuilds them.

Build new events with the typed builder in `dev/panel/scenarios/timeline.ts`, or
[record them](development.md#recorded-fixtures). Add a fixture for every new
activity row/event kind in its owning scenario module, and register it in
`dev/panel/scenarios/fixtures.ts`. `preview-sdk-fixtures.test.ts` replays built and
recorded fixtures through the provider.

## Scope and host controls

- **Launch: Thread** shows a conversation's tasks; **Global** shows every
  project and conversation. `dev-thread` has `/demo/project` and `/demo/website`
  tasks; `other-thread` owns two more.
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
  task list. Enabling it relaunches the panel automatically; writes and live
  mode are unaffected.
- **Width** offers 360, 480, 760 and Fill. A short 360px frame can make the whole
  inspector scroll; use 480 or Fill to check the fixed-header layout.
- **Bridge log** shows tools, message/context requests and display-mode changes,
  including entries recorded while the inspector was closed. Its `served`
  field distinguishes browser fixtures, fixture service and live service.

## Fixture catalogue

| Task                                        | Scenario                                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Refactor the billing module                 | Running status; current-repo changes omit a pre-existing README edit and include renames, a deleted file and a binary image.                     |
| Live: …                                     | Latest activity and clocks: thinking, tool, compaction, retry, rate limit, ordinary work, finishing, hook, background task and provider failure. |
| Live: streaming reply                       | Chat draft grows over time and restarts.                                                                                                         |
| Recorded: …                                 | Real SDK runs: steer/interrupt/send-now, streamed reply, question interrupted and resumed, read-only MCP review.                                 |
| Limit upload sizes                          | Parent-started turns, user and parent follow-ups, Markdown lists/tables/code, footnotes, relative links and images, HTML-like prose.             |
| Tidy the settings copy                      | Taken and pending steers, queued messages including one from the parent; new steers and queued messages stay until reload.                       |
| Rename the feature flags                    | Interrupted task with a paused queue: a leftover steer, then two messages to reorder, edit or remove until reload.                               |
| Move the date helpers                       | Cost budget exhausted; the warning notice applies a higher limit without sending a message.                                                      |
| Finish the date helper migration            | Runtime-only budget exhausted; the warning notice applies the higher runtime limit without sending a message.                                    |
| Move the screens to the new layout          | Long Chat conversation for scrolling.                                                                                                            |
| Stabilise the retry timer test              | Worktree recreated from its branch in a new session.                                                                                             |
| Migrate the config loader                   | Pending inline question and queue-only composer; queued messages stay until reload.                                                              |
| Plan the sign-in rollout                    | Three stacked questions, single/multiple choices and queue-only composer.                                                                        |
| Convert the test suite to the new runner    | More than 200 events in two turns; trimmed timeline, scrolling, and View activity for a turn inside (2) and outside (1) the window.              |
| Move the API clients onto the retry wrapper | 15 turns and about 580 events, with a failed turn 8; View activity reads turns 1–10 on their own and scrolls to turns 11–15.                     |
| Catalogue the design assets                 | Thinking, images, documents, web search, plugin and memory signals.                                                                              |
| Tighten the task inspector layout           | Two committed turns; This turn option and empty uncommitted changes; clean worktree removal.                                                     |
| Fix the flaky retry test                    | Removed worktree with branch retained.                                                                                                           |
| Draft the release notes                     | Removed worktree and deleted branch.                                                                                                             |
| Speed up the production build               | 60-file uncommitted diff; removal asks before discarding changes.                                                                                |
| Profile the production build                | Large added files and multiple pages of diff/file previews.                                                                                      |

Changes fixtures in `dev/panel/scenarios/change-fixtures.ts` use real temporary Git
repositories. `large-files.ts` supplies the 60-file diff, minified JSON,
20,000-row CSV, 30,000-line log, long Markdown whose contents links jump to
headings, single 250 KB line, and SVG over 64 KiB that displays as source.

## Measurement and checks in Codex

The panel is an iframe; inspect its `contentDocument` when the browser tool
supports DOM inspection. Host selects require setting `.value` and dispatching
`change` if the tool's ordinary form input does not work. Use
`getBoundingClientRect` for layout measurements and `scrollIntoView` for long
feeds. Hidden panes throttle frames: sample animations by pausing
`element.getAnimations()` and setting `currentTime`, instead of timing them.

The dev host omits style variables by default; enter JSON in the inspector to
test them. Light and dark captures from Codex desktop's MCP App context are kept
as development references. The panel filters style keys the installed SDK does
not recognize, so later host additions do not fail app initialization. The dev host does not reproduce Codex's iframe sandbox, CSP or
container placement. For changes affecting the React UI in Codex, build and open an approved
repository in Codex, check scope and New task prefills without submitting, and
reopen an existing task. Check the sidebar entrypoint and inline/expanded switching
when their integration changes. For folder browsing changes, use **Browse** on
macOS, verify that cancelling leaves the selection unchanged, and that selecting
a valid Git root registers and selects it without starting a task. For scope
changes, use two chats with different projects and confirm they stay separate.
Automated transport/DOM tests and fixture screenshots
cannot establish panel message delivery or its placement in Codex.

For composer mention changes, verify that search finds Claude, selecting it
delivers the provider hint, and the delegation flow uses that hint. See
[Composer mentions](host-capabilities.md#composer-mentions).
