# Agent instructions

## Running integration tests

- HTTP and executor integration suites need localhost TCP listeners; `mac-executor` also invokes nested macOS `sandbox-exec` profiles. If the default Codex command sandbox reports `listen EPERM` or `sandbox_apply: Operation not permitted`, rerun the affected suites with escalated execution permission. CI needs a macOS runner that permits both operations. Do not skip or weaken these tests.

## Verifying UI changes

Check in the browser when a change is large, when seeing it would help, or when the user asks. Skip small changes that tests cover.

- Preview fixtures (`ui/transports/preview-fixtures.ts`) cover every task status and activity row kind. Build events with the typed builder, not by hand; `tests/preview-sdk-fixtures.test.ts` replays them through the provider. Add a fixture for any new event or row kind.
- The `panel-dev` server (port 5317) is usually running. Navigate to `http://localhost:5317`; do not start or stop it.
- Set **Data** to `fixtures` and **Relaunch** (the iframe is blank for a few seconds). Use `live` data only for what fixtures cannot show: set **Launch** to `global`, and do not start tasks, since live mode performs real actions.
- **Launch** works with fixtures, too (controls in [Local development](docs/development.md#panel-dev-host)). `Thread` shows the chosen thread's tasks for one project; `Global` shows every conversation and project.
  - **Thread**: the default `dev-thread` has tasks in `/demo/project` and `/demo/website`; `other-thread` owns two more.
  - **Sandbox cwd**: the default (this repository) is not a fixture project, so it shows **Add chat project**. Set it to `/demo/website` to scope the panel to that project.
  - Projects added in fixtures are kept until **Host** > **Reset projects**. Reset after checking registration so later checks start from the fixture projects.
- Fixture tasks for specific cases:
  - **Refactor the billing module**: running (live status, running rows).
  - **Live: …** tasks (ten of them): each is running and ends on a different latest activity, such as thinking, a running tool, compaction, a retry, a rate limit, a hook, a background task or a provider failure. Use them to check the live status line and the clocks. **Live: thinking** is the one with an active thinking state.
  - **Migrate the config loader**: pending question.
  - **Convert the test suite to the new runner**: exceeds the 200-event activity tail (trimmed timeline). Use it to test timeline scrolling, since most other timelines are short.
- The host's selects ignore `form_input`; set `.value` and dispatch `change`. **Width** offers 360, 480, 760, and Fill. At 360px the short frame stacks the inspector (the whole pane scrolls), so use 480 or Fill for the fixed-header layout.
- The panel is an iframe: query `document.querySelector('iframe').contentDocument` (`#tab-activity`, `.activity-group`, `.activity-debug-toggle`).
- Measure layout with `getBoundingClientRect` instead of judging by eye, and use `scrollIntoView` to move the timeline.
- A hidden browser pane throttles frames, so do not time animations. Sample them instead: get the running animations with `element.getAnimations()`, pause them, set `currentTime`, and measure.
