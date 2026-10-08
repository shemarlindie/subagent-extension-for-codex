# Agent instructions

## Running integration tests

- HTTP integration suites need localhost TCP listeners. If the default Codex command sandbox reports `listen EPERM`, rerun the affected suites with escalated execution permission. CI needs a runner that permits it. Do not skip or weaken these tests.

## Formatting

Run Prettier and ESLint with `--fix` on the files you change (`npx eslint --fix <files> && npx prettier --write <files>`). ESLint enforces blank-line layout.

## Verifying UI changes

Check in the browser when a change is large, when seeing it would help, or when the user asks. Skip small changes that tests cover.

- Preview fixtures (`ui/dev/preview/fixtures.ts`) cover every task status and activity row kind. Build events with the typed builder, not by hand, or record them from a real run with `npm run fixture:record` (see [Recorded fixtures](docs/development.md#recorded-fixtures)); `ui/dev/preview/preview-sdk-fixtures.test.ts` replays both through the provider. Add a fixture for any new event or row kind.
- Dev servers are in `.claude/launch.json`: `panel-dev` (port 5317, usually running) and `service-dev` (port 4317, needed only for live data). The user or an agent may have started them. Start a needed dev server or restart one when required to test new changes without asking for permission, and notify the user when you do. Otherwise, leave them running.
- Navigate to `http://localhost:5317`, set **Data** to `fixtures` and **Relaunch** (the iframe is blank for a few seconds). Use `live` data only for what fixtures cannot show: set **Launch** to `global`, and do not start tasks, since live mode performs real actions.
- **Launch** works with fixtures, too (controls in [Local development](docs/development.md#panel-dev-host)). `Thread` shows the chosen thread's tasks for one project; `Global` shows every conversation and project.
  - **Thread**: the default `dev-thread` has tasks in `/demo/project` and `/demo/website`; `other-thread` owns two more.
  - **Sandbox cwd**: the default (this repository) is not a fixture project, so it shows **Add chat project**. Set it to `/demo/website` to scope the panel to that project.
  - Projects added in fixtures are kept until **Inspector** > **Host settings** > **Reset projects**. Reset after checking registration so later checks start from the fixture projects.
- Fixture tasks for specific cases:
  - **Refactor the billing module**: running (live status, running rows).
  - **Live: …** tasks (ten of them): each is running and ends on a different latest activity, such as thinking, a running tool, compaction, a retry, a rate limit, a hook, a background task or a provider failure. Use them to check the live status line and the clocks. **Live: thinking** is the one with an active thinking state.
  - **Live: streaming reply**: running, with a reply streaming into Chat; its draft grows with time since the page loaded, then starts over.
  - **Recorded: …** tasks (four of them, from real Claude runs in `ui/dev/preview/recorded/`): a steer taken mid-turn followed by interrupt and send now, a streamed reply, a question interrupted and resumed in the same session, and a read-only review over MCP. Use them to see real SDK messages in Activity and Chat.
  - Chat, which is the default tab (fixtures can't send messages):
    - **Limit upload sizes**: three turns started by the parent agent, with a user and a parent follow-up and Markdown replies (a list, a table, code).
    - **Tidy the settings copy**: a running turn with a steer it took, a pending steer and two queued messages (one from the parent).
    - **Rename the feature flags**: interrupted with a steer pending, so the queue is paused with the leftover steer at its front.
    - **Move the date helpers**: a turn stopped by its cost budget, so the composer offers to raise it.
    - **Move the screens to the new layout**: a 14-turn conversation, for scrolling Chat.
    - **Stabilise the retry timer test**: a second turn after **Remove worktree**, with the worktree recreated from its branch in a new session.
    - **Migrate the config loader** and **Plan the sign-in rollout** show questions inline at the end of Chat, with the composer in queue-only mode.
  - **Migrate the config loader**: pending question.
  - **Plan the sign-in rollout**: three stacked questions in one request (card deck, single and multiple choice).
  - **Convert the test suite to the new runner**: exceeds the 200-event activity tail (trimmed timeline). Use it to test timeline scrolling, since most other timelines are short.
  - **Catalogue the design assets**: rare content blocks and SDK signals (thinking, images, documents, web search, plugin and memory updates).
  - Changes tab, each read from a real Git repository (`ui/dev/preview/change-fixtures.ts`):
    - **Tighten the task inspector layout**: a worktree task with two committed turns, so **This turn** shows, with no uncommitted changes (the empty state). Clean, so **Remove worktree** removes it at once.
    - **Refactor the billing module**: `current_repo`, with the user's earlier README edit left out, renames, a deletion and a binary image.
    - **Fix the flaky retry test**: the worktree was removed; the branch remains (`task.worktree_removed` event).
    - **Draft the release notes**: the worktree and branch were deleted (`task.branch_deleted` event).
    - **Speed up the production build**: the 60-file diff from `large-files.ts`, uncommitted, so **Remove worktree** asks first.
    - **Profile the production build**: every file in `large-files.ts`, added. Its diff comes in several pages; use it for the previews.
- Large files for the file viewers (60-file diff, minified JSON, 20,000-row CSV, 30,000-line log, long Markdown, a single 250 KB line, and an SVG over 64 KB that shows as source only) come from `ui/dev/preview/large-files.ts`.
- Tools in `FIXTURE_SERVICE_TOOLS` (the Changes tab's: changes, changed files and worktree actions) run the real service code on the Vite server (`ui/dev/fixture-service.ts`). Worktree actions change the fixture repositories until the store is rebuilt (an edit to `src/` or a Vite restart). The **Bridge log** shows each call's `served` source.
- The host's selects ignore `form_input`; set `.value` and dispatch `change`. **Width** offers 360, 480, 760, and Fill. At 360px the short frame stacks the inspector (the whole pane scrolls), so use 480 or Fill for the fixed-header layout.
- The panel is an iframe: query `document.querySelector('iframe').contentDocument` (`#tab-activity`, `.activity-group`, `.activity-debug-toggle`).
- Measure layout with `getBoundingClientRect` instead of judging by eye, and use `scrollIntoView` to move the timeline.
- A hidden browser pane throttles frames, so do not time animations. Sample them instead: get the running animations with `element.getAnimations()`, pause them, set `currentTime`, and measure.

## Component and change conventions

- Organize modules around feature ownership and reasons to change. Keep feature-specific logic, types, UI, and styles together; use subfolders for cohesive responsibilities rather than file types. Keep shared code limited to stable cross-feature concepts and platform integrations at system boundaries.
- Keep focused tests beside their owning modules; reserve integration suites for behavior that crosses feature, process, host, or environment boundaries.
- Keep components focused on rendering. Split oversized files by responsibility and keep one React component per file, except where splitting adds needless indirection. Match component file names using the repository's kebab-case convention.
- Put reusable generic helpers in `ui/shared/utils` and feature-owned domain logic in `ui/features`; avoid embedding reusable helpers in component modules.
- Prefer named prop and state types over inline object types.
- Name components for their actual scope. Use a generic name only when the component and its styling are genuinely reusable; use a domain-specific name when behavior or styling is domain-specific.
- Keep large collapsed sections lightweight: unmount expensive child rows while closed, and show a loader when asynchronous or deferred rendering needs feedback.
- Write documentation for the current state. Avoid historical notes about replaced implementations or tools unless that history is needed to understand current behavior.
- Categorize changes into coherent, independently understandable commit groups, and make dependencies/order clear so a requested group can be applied first. Do not auto-commit unless implementing a plan already divided into commits or the user explicitly asks.
