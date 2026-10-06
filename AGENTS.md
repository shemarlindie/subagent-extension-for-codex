# Agent instructions

## Running integration tests

- HTTP and executor integration suites need localhost TCP listeners; `mac-executor` also invokes nested macOS `sandbox-exec` profiles. If the default Codex command sandbox reports `listen EPERM` or `sandbox_apply: Operation not permitted`, rerun the affected suites with escalated execution permission. CI needs a macOS runner that permits both operations. Do not skip or weaken these tests.

## Formatting

Run Prettier and ESLint with `--fix` on the files you change (`npx eslint --fix <files> && npx prettier --write <files>`). ESLint enforces blank-line layout.

## Verifying UI changes

Check in the browser when a change is large, when seeing it would help, or when the user asks. Skip small changes that tests cover.

- Preview fixtures (`ui/dev/preview/fixtures.ts`) cover every task status and activity row kind. Build events with the typed builder, not by hand; `ui/dev/preview/preview-sdk-fixtures.test.ts` replays them through the provider. Add a fixture for any new event or row kind.
- The `panel-dev` server (port 5317) is usually running. Navigate to `http://localhost:5317`; do not start or stop it.
- Set **Data** to `fixtures` and **Relaunch** (the iframe is blank for a few seconds). Use `live` data only for what fixtures cannot show: set **Launch** to `global`, and do not start tasks, since live mode performs real actions.
- **Launch** works with fixtures, too (controls in [Local development](docs/development.md#panel-dev-host)). `Thread` shows the chosen thread's tasks for one project; `Global` shows every conversation and project.
  - **Thread**: the default `dev-thread` has tasks in `/demo/project` and `/demo/website`; `other-thread` owns two more.
  - **Sandbox cwd**: the default (this repository) is not a fixture project, so it shows **Add chat project**. Set it to `/demo/website` to scope the panel to that project.
  - Projects added in fixtures are kept until **Inspector** > **Host settings** > **Reset projects**. Reset after checking registration so later checks start from the fixture projects.
- Fixture tasks for specific cases:
  - **Refactor the billing module**: running (live status, running rows).
  - **Live: …** tasks (ten of them): each is running and ends on a different latest activity, such as thinking, a running tool, compaction, a retry, a rate limit, a hook, a background task or a provider failure. Use them to check the live status line and the clocks. **Live: thinking** is the one with an active thinking state.
  - **Migrate the config loader**: pending question.
  - **Plan the sign-in rollout**: three stacked questions in one request (card deck, single and multiple choice).
  - **Convert the test suite to the new runner**: exceeds the 200-event activity tail (trimmed timeline). Use it to test timeline scrolling, since most other timelines are short.
  - **Profile the production build** (in `/demo/website`): only large artifacts, each crossing a different preview limit (60-file diff, minified JSON, long report, 20,000-row CSV, 30,000-line log, long Markdown, a single 250 KB line, an SVG large enough to be rasterized, and a PNG with a thumbnail). Their content is generated on first request (`ui/dev/preview/large-artifacts.ts`).
  - In fixture mode, the artifact tools run the real service code on the Vite server (`ui/dev/fixture-service.ts`), with real thumbnails and summary caching. The **Bridge log** shows each call's `served` source.
  - **Catalogue the design assets**: one artifact of each small format (JSON, log, Markdown, CSV, SVG, code).
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
