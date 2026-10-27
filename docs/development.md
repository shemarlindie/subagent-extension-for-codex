# Local development

Use this guide to build, run, change and check the project from a checkout. It
is for contributors and agents working on the code.

- [Architecture](architecture.md) covers code ownership and runtime boundaries.
- [UI verification](ui-verification.md) covers browser and Codex checks of the
  panel.
- [Database and migrations](database.md) covers schema changes, transactions
  and event notifications.
- [Claude execution verification](claude-verification.md) covers CLI and SDK
  qualification and opt-in authenticated scenarios.

Run every command from the project root. You need Node.js 24 or later and Git.

## Setup

```sh
npm ci
cp -n .env.example .env
```

`npm run dev`, `npm start`, `npm run projects` and `npm run dev:ui` load `.env`
when present. Shell variables take precedence. `.env` is gitignored, and the
example keeps data in `.codex-subagent-extension/live`. See the
[configuration table](configuration.md#environment-variables) for every
variable.

The service and panel dev host must use the same
`CODEX_SUBAGENT_EXTENSION_DATA`, which holds the database and admin token. How
Codex finds that directory depends on the
[transport](#connect-codex-from-a-checkout):

- **Stdio.** The Codex-launched proxy needs the same path, made absolute, in its
  MCP environment for service discovery:

  ```toml
  [mcp_servers.codex_subagent_extension.env]
  CODEX_SUBAGENT_EXTENSION_DATA = "<checkout-root>/.codex-subagent-extension/live"
  ```

- **HTTP.** Configure the [Streamable HTTP](#streamable-http) URL and an
  Authorization header with the token from
  `<checkout-root>/.codex-subagent-extension/live/admin-token`, or the service's
  token override. Codex needs no data directory setting.

If the plugin is installed too, give the checkout its own `PORT`, such as
`17318`, in `.env` and the MCP environment. Otherwise the plugin's proxy finds
the checkout's service on port 17317, and a plugin update can
[hand over](task-continuation.md#updates-and-service-handoff) a checkout service
that a stdio proxy started.

With **Automatically add chat projects** on (the default), starting a task from
a chat registers its project. Use **Manage → Add project** or `npm run projects`
to register others. See [Repository access](configuration.md#repository-access).

### Test composer mentions

To diagnose [composer mentions](host-capabilities.md#composer-mentions), add
`CODEX_SUBAGENT_EXTENSION_MENTION_TEST_MODE=1` to `.env` and reload the MCP
connection. The stdio proxy reads this setting from `.env` and answers mention
search itself, so the service needs no restart.

Every query then returns a labeled sample `Claude` result and appends the query,
timestamp, result names and skipped provider checks to
`<data-directory>/mention-search.jsonl`. The proxy uses the `.env` data
directory for this log only when its MCP environment sets none. The sample does
not prove that a Claude provider is available. Remove the setting after
testing.

## Generated validation schemas

Pick the validation source by what the contract owns:

| Contract                                                                                                                                        | Source                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plain boundary data, such as settings documents, panel output and event payloads                                                                | TypeScript types with generated Zod schemas. Edit the source types and regenerate.                                                                       |
| Inputs with transformations, defaults or substantial validation, such as task start, tool inputs, settings updates, stored tasks and SDK inputs | Handwritten Zod with inferred TypeScript types.                                                                                                          |
| Database rows                                                                                                                                   | Validators derived from Drizzle tables at deserialization. Serialized JSON needs its own payload validation. See [Database and migrations](database.md). |
| Internal data that needs no runtime validation                                                                                                  | Plain TypeScript.                                                                                                                                        |

The generator discovers `src/**/*-contract.ts`, excluding generated files and
`*-contract.test.ts`. Contracts need no central registration, and imports
between them resolve to their generated validators. Schema generation never
changes migrations.

JSDoc supplies rules that plain types cannot express. Supported annotations
include `@strict` to reject extra properties, `@format url` and `@default` for
omitted input values. Contracts describe parsed output, so a default can make an
input property optional even when the output requires it.

To add a contract:

1. Put exported types in a feature-owned file such as
   `src/service/features/<feature>/message-contract.ts`:

   ```ts
   /** @strict */
   export interface Message {
     body: string;
   }
   ```

2. Run `npm run schemas:generate`. This creates the adjacent
   `message-contract.generated.ts`, which exports `messageSchema`.
3. Call the generated validator at the boundary and use the source type
   internally:

   ```ts
   import { messageSchema } from "./message-contract.generated.js";
   import type { Message } from "./message-contract.js";

   export function decodeMessage(input: unknown): Message {
     return messageSchema.parse(input);
   }
   ```

4. Add focused tests beside the contract for accepted and rejected data and any
   annotation behavior. Run `npm run typecheck`.

Commit the source, generated file and tests together.

A contract can import types only from other contracts. A type from anywhere
else would generate a permissive `z.any()`, so the generator rejects it. Data
built from handwritten schemas belongs in handwritten Zod, as Claude task
options do in `src/shared/providers/claude/task-options.ts`. Do not feed Drizzle
inferred types into this generator.

## Run the service

Build before starting either mode, including when testing in Codex:

| Use           | Command                        | Backend behavior                                                                                     |
| ------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Development   | `npm run build && npm run dev` | Runs `src/service/main.ts` through `tsx` in Node's watch mode. Restarts when backend sources change. |
| Built service | `npm run build && npm start`   | Runs `dist/main.js`. Rebuild and restart to apply backend changes.                                   |

Both modes run in the foreground at `http://127.0.0.1:17317` and serve the
embedded panel and standalone console from `dist/app.html`. `npm run dev` does
not rebuild the panel, so follow [What reloads when](#what-reloads-when) after
edits. Use the [panel dev host](#panel-dev-host) for UI work with Fast Refresh.

Stop the service with Ctrl-C. A restart interrupts active tasks. Send a
follow-up after the service returns to continue them.

Only one service can own a data directory. If Codex is open with the plugin
enabled, its stdio proxy may already have started one. On macOS and Linux, an
interactive start shows the owner's process details and asks before sending it
SIGTERM. If it is still running after five seconds, a second prompt offers
SIGKILL. Non-interactive starts and Windows never stop other processes.

Check the service from another terminal:

```sh
curl --fail http://127.0.0.1:17317/health
npm run projects -- list
```

Open the standalone console at `http://127.0.0.1:17317` and sign in with the
contents of `<data-directory>/admin-token`. On macOS,
`pbcopy < .codex-subagent-extension/live/admin-token` copies it. Use the
configured origin. `localhost` and `127.0.0.1` are different browser origins,
and the service's origin checks can reject the substitute.

## Choosing a development tool

| Command          | Use for                                                     | Worker                                                 |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| `npm run dev:ui` | UI development, prepared scenarios and host/layout controls | Prepared fixtures, or a connected backend in live mode |
| `npm run demo`   | Interactive service testing with disposable data            | Fake worker with no model calls                        |
| `npm run dev`    | Backend development and Claude execution                    | Claude model calls, which can incur costs              |

In the dev host, **Data: live** connects to a running service, whose worker may
be fake or Claude. [Demo](#demo) shows how to pair the dev host with the fake
worker.

## Panel dev host

```sh
npm run dev:ui
```

This starts Vite at `http://127.0.0.1:5317` with React Fast Refresh and CSS hot
replacement. The page embeds the real panel in an iframe through the official
`AppBridge`, and lets you vary launch scope, theme, display mode, width and host
capabilities. Production HTML comes from `scripts/build-panel.mjs`.
[UI verification](ui-verification.md) covers the workflow, host controls,
fixture catalogue and style variables.

**Data: fixtures** checks the UI without a production service. Prepared fixtures
cannot start provider tasks, but supported Chat interactions update simulated
state. Fixtures live in `dev/panel/scenarios/` and stay out of the production
bundle. Most tool calls use browser fixtures. Changes and worktree calls listed
in `FIXTURE_SERVICE_TOOLS` run real service code on Vite against disposable
repositories, which source edits rebuild on the next call.

**Data: live** connects to the service's `/mcp` endpoint through the Vite proxy
at `/service`. The proxy adds the admin token server-side and drops the browser
`Origin` header, so the token never reaches the page.

- The proxy finds the service from `CODEX_SUBAGENT_EXTENSION_URL`, then
  `CODEX_SUBAGENT_EXTENSION_ORIGIN`, then the data directory's `service.json`,
  then port 17317. It ignores `PORT`, which sets the dev host's own port in this
  process.
- It reads the token from `CODEX_SUBAGENT_EXTENSION_TOKEN` or the data
  directory's `admin-token`.
- Start the service first, and restart Vite after the service changes ports.

For Claude execution against throwaway data, give both processes the same data
directory. The dev host reads the service's port from `service.json`:

```sh
CODEX_SUBAGENT_EXTENSION_DATA=/tmp/panel-dev PORT=4399 npm run dev
CODEX_SUBAGENT_EXTENSION_DATA=/tmp/panel-dev npm run dev:ui
```

### Access from your local network

Both commands listen on loopback only. Pass `--host` to listen on network
interfaces:

```sh
npm run dev -- --host
npm run dev:ui -- --host
```

On another computer, open `http://<service-computer-LAN-IP>:5317` for the dev UI
or `http://<service-computer-LAN-IP>:17317` for the standalone console.

- The service binds all IPv4 interfaces and prints its network URLs at startup.
- The console still requires the admin token. It accepts LAN origins from the
  interface addresses found at startup, so restart after those change.
- Codex and the dev UI proxy still connect through loopback. For dev UI live
  mode alone, only `dev:ui` needs `--host`.

The dev UI proxy adds the admin token, so anyone who can reach the dev UI can
control the service in live mode. Use these flags only on a trusted local
network. Firewall rules decide which computers can connect. Public and
multi-user hosting are out of scope.

## Recorded fixtures

The dev host has two kinds of task fixtures:

- Synthetic fixtures built with `dev/panel/scenarios/timeline.ts`.
- Tasks recorded from real Claude runs in `dev/panel/recorded/`, which preserve
  their SDK messages.

`dev/panel/scenarios/fixtures.ts` assembles both into the registry the dev host
and replay tests use. `dev/panel/scenarios/preview-sdk-fixtures.test.ts` replays
both through the provider.

Record a task from any service database, such as the service's, the demo's or a
temporary one from `scripts/verify-live-claude.mjs`:

```bash
npm run fixture:record -- --db <tasks.sqlite> --task <task id> --name <name> --title "Recorded: <what it shows>" --start 2026-10-02T11:40:00.000Z --first-id 3400
```

This writes `dev/panel/recorded/<name>.json` for task `preview-recorded-<name>`
in the `dev-thread` thread and `/demo/project` project. Import the file in
`fixtures.ts` and add it to `recordedFixtures`.

- Choose a `--first-id` past other fixtures' event IDs. Recorded fixtures start
  at 3000, a hundred apart.
- Choose a `--start` that places the task where you want it in the
  newest-first list.

The recorder replaces machine paths and identifiers, removes local Claude
configuration and private usage details, and shifts event IDs and times.
Replay maps recorded `tool_use_result` payloads through `claudeFileEdits`, so
captured edits populate Changes. File previews still need a fixture workspace or
prepared content.

Review the output before committing, because prompts and file contents can still
hold private information. The recorder rejects common machine identifiers, but
that check cannot prove the recording is safe to share. Add literal
replacements with repeatable `--replace <from>=<to>` arguments, quoting values
with spaces or shell characters, such as `--replace 'internal-name=/demo/name'`.

## Showcase screenshots

The showcase plays a short, curated collaboration for promotional images. A
Codex-like thread sits beside the real panel, which runs from the dev server
through the same bridge as the dev host, so panel changes appear without extra
work.

With `npm run dev:ui` running, open `http://127.0.0.1:5317/showcase.html`. The
URL picks the frame:

- `step` is the 0-based story step. The default is the second-to-last.
- `theme` is `dark` (default) or `light`.
- `capture` hides the controls.
- `play` loops the whole story instead of showing one step. Codex's items
  appear one at a time, and Codex opens the panel inline in its thread before
  expanding it into the side pane. Claude's replies stream, and the panel
  updates in place, as in a live run. The Play button toggles it.

Export every step in both themes at 1600×1000 and 2x scale:

```sh
npm run showcase:capture
```

It writes to `showcase-captures/`. Use `--out <dir>` for another folder, for
example to compare a version without replacing the standard captures, and
`--scale <n>` for another pixel ratio. Captures default to `--zoom 1.15`, which
enlarges the page by 15% within the same export size. Use `--zoom 1` for the
original page size, or another positive multiplier to tune readability.

Chromium records video in CSS pixels and ignores the device scale, so both
screenshots and video open a viewport at the export size and apply CSS `zoom`
of scale × zoom. Stills then match video frames. Panel animations that measure
elements must divide by `currentCSSZoom`, as `autoListEffects` does.

Add `--video` to record one playback loop per theme as WebM instead. Video
defaults to 60 fps at 3200×2000. Use `--fps <n>` for another frame rate and
`--scale 1` for a 1600×1000 export. Higher scales and frame rates take more
resources and produce larger files. The command reuses a running dev server or
starts one.

The story lives in `dev/panel/showcase/story.ts`. Each step lists the items
Codex adds and builds Claude's events with the fixture `Timeline`. A step's
`reply` holds the message that ends Claude's turn, which playback streams.
Playback timing lives in `dev/panel/showcase/playback.ts`. The Codex look lives
in `dev/panel/showcase/codex/`. Update it there when Codex changes.

The showcase loads `dev/panel/host/panel.html?now=<ms>`, which freezes the
panel's clock, so elapsed times are the same in every capture. During playback
`&tick` lets the clock run, and the showcase moves it forward as events arrive.

## Connect Codex from a checkout

Installed users get the plugin from the marketplace
([README](../README.md#install)). To run a checkout instead, build it, pick one
transport and add its example to `~/.codex/config.toml`. Both transports expose
the same task tools and MCP App.

- Remove the plugin first, or Codex runs both servers.
- Replace the existing server entry when switching transports. Do not combine
  stdio and HTTP settings.
- To return to the plugin, delete `[mcp_servers.codex_subagent_extension]` and
  its `env` or `http_headers` tables, and stop the checkout's service. The
  plugin never stops a service it didn't start.

See the
[Codex MCP configuration reference](https://learn.chatgpt.com/docs/extend/mcp#configure-with-configtoml)
for supported options.

### Stdio

Run `npm run build`, then point Codex at the built launcher with an absolute
checkout path:

```toml
[mcp_servers.codex_subagent_extension]
command = "node"
args = ["<checkout-root>/dist/stdio.js"]
```

The launcher reads the admin token and connects to the local service, starting
it when needed. If you override `CODEX_SUBAGENT_EXTENSION_DATA`, give the
service and launcher the same absolute path through
`[mcp_servers.codex_subagent_extension.env]`. See
[Task continuation](task-continuation.md) for recovery and state, and
[Admin token](configuration.md#admin-token) for token overrides.

### Streamable HTTP

Codex does not start the service over HTTP, so keep it running:

```sh
npm run build && npm start
```

Use `npm run build && npm run dev` for development instead, and follow
[What reloads when](#what-reloads-when) after edits.

Configure the authenticated `/mcp` endpoint:

```toml
[mcp_servers.codex_subagent_extension]
url = "http://127.0.0.1:17317/mcp"

[mcp_servers.codex_subagent_extension.http_headers]
Authorization = "Bearer <admin-token>"
```

Replace `<admin-token>` with the contents of `<data-directory>/admin-token`, or
with `CODEX_SUBAGENT_EXTENSION_TOKEN` if the service uses that override. The
default data directory is `~/.local/share/codex-subagent-extension`. On macOS,
copy the token without printing it:

```sh
pbcopy < ~/.local/share/codex-subagent-extension/admin-token
```

Update the URL if you changed the service port. Keep the token and configuration
private, and never paste them into chats or commit them. Unlike the stdio proxy,
an HTTP client sends the token without checking that the
[service holds it](configuration.md#admin-token). On a computer shared with
other users, prefer the stdio proxy.

### Verify either connection

Reload the MCP connection in Codex and open **Delegated Work** from a chat. The
panel shows the same tasks as the dev host in live mode. `codex mcp list` shows
the configured server. Reconnect after changing tool metadata. To check UI
changes in Codex, see
[UI verification](ui-verification.md#measurement-and-checks-in-codex).

## Demo

```sh
npm run demo
```

The demo builds the project, registers a disposable repository at
`.codex-subagent-extension/demo-repository` and starts the service with only the
fixture worker, so it makes no model calls. Data lives in
`.codex-subagent-extension/demo`. Stop any other service on port 17317 first,
then sign in at `http://127.0.0.1:17317` with
`local-demo-only-not-a-real-token`.

To pair fake-worker tasks with UI hot reload:

1. Run `npm run demo` in one terminal.
2. Start Vite in another terminal with the demo connection:

   ```sh
   CODEX_SUBAGENT_EXTENSION_DATA="$PWD/.codex-subagent-extension/demo" \
   CODEX_SUBAGENT_EXTENSION_TOKEN=local-demo-only-not-a-real-token \
   CODEX_SUBAGENT_EXTENSION_URL=http://127.0.0.1:17317 npm run dev:ui
   ```

3. Open `http://127.0.0.1:5317`, choose **Data: live** and **Launch: global**,
   then **Relaunch**.
4. Select the demo repository in New task.

The panel sends real requests, so you can create tasks, send follow-ups, answer
questions and interrupt turns. The explicit variables keep Vite from using a
service configured in `.env`.

[Fixture scenarios](fixture-scenarios.md) lists the prompt triggers, expected
outcomes, queue controls and failure cases.

## What reloads when

| Change                               | To see it                                                               |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `src/panel/` in the dev host         | Nothing. Fast Refresh applies it                                        |
| `src/panel/` in Codex or the console | `npm run build`, then reopen the panel or reload the page               |
| `src/service/`                       | `npm run dev` restarts automatically. Restart `npm start` after a build |
| `src/shared/`                        | Refresh the panel as above. `npm run dev` restarts automatically        |
| Tool metadata or panel resource URI  | Restart the service, then reload the MCP connection in Codex            |
| `.env` or `vite.config.ts`           | Restart the affected processes                                          |

The service reads panel HTML from `dist/` on each resource request, so a rebuilt
UI needs no restart. If the file disappears, as when a plugin update removes the
running installation before handover, the service serves the last copy it read.

## Build

`npm run build` regenerates validation schemas, cleans `dist/`, type checks the
service, and builds the service entrypoints and `dist/app.html`. Each build
rejects imports from the other runtime, development tooling and tests.

- The service bundle includes its runtime packages, so an extracted package runs
  without `node_modules`. It ships no Claude Code binary and launches the
  installed [Claude Code CLI](claude-cli.md).
- Bundling drops package license files, so each build collects them into
  `dist/THIRD_PARTY_LICENSES.txt` for the service and
  `dist/app.html.THIRD_PARTY_LICENSES.txt` for the panel.
- Source maps omit embedded sources and map stack traces to the original files.
- Bundles live in `dist/bundle/`. The public entries `dist/main.js`,
  `dist/stdio.js` and `dist/projects-cli.js` are small ES2017 guards. Each
  checks Node against `engines.node`, prints what to install on an old runtime,
  then imports its bundle.

`npm run package:plugin` builds and packs the plugin. The package holds only
what the installed plugin runs or shows: `dist/`, `migrations/`, `assets/`,
`skills/`, `plugin.json`, `mcp.json`, the README and `LICENSE`. Guides stay on
GitHub, so the README's links to `docs/` don't resolve inside an extracted
package.

`npm run release:assemble`, run after a build, writes `release/`. It holds the
packed files, a manifest with no scripts or dependencies, and an
`.agents/plugins/marketplace.json` that lists the plugin with source `./`. The
directory is both a Codex marketplace and the plugin. Install it locally with:

```sh
codex plugin marketplace add ./release
codex plugin add codex-subagent-extension@shemarlindie
```

The marketplace name `shemarlindie` is part of the plugin ID and its
`PLUGIN_DATA` path, so it must not change.

Two package suites in `npm test` cover the result:

- `tests/integration/package/packed-artifact.test.ts` checks startup,
  transports, CLI readiness and restarts from an extracted package outside the
  checkout. It fails if the package's top-level file list changes.
- `tests/integration/package/marketplace-install.test.ts` assembles a release
  from `dist/`, installs it with the Codex CLI into a temporary `CODEX_HOME` and
  runs the MCP command Codex reports against an isolated data directory and
  port. It checks the reported version, tool listing and calls, and service
  startup. It needs the Codex CLI (`CODEX_BIN` or `codex` on `PATH`) and skips
  without it.

To run the marketplace test alone after a build:

```sh
npx vitest run tests/integration/package/marketplace-install.test.ts
```

Set `MARKETPLACE_SOURCE` to a published marketplace, such as
`owner/repo@v1.2.3`, to install that instead. Its version must match the
checkout's `package.json`. The release workflow does this after publishing.

## Releasing

Users install from the `release` branch, which holds only assembled releases
tagged `v<version>`. Codex refreshes Git marketplaces on startup and reinstalls
the plugin when the branch moves, so every push to `release` reaches users.

1. Bump `version` in `package.json` and `plugin.json`. The build fails when they
   differ, and Codex keys installed versions by it, so every release needs a new
   one.
2. Add a `## <version>` section to `CHANGELOG.md` that tells users what changed
   and anything they must do by hand. It becomes the GitHub release notes.
3. Merge to `main`, then run the **Release** workflow from `main` in GitHub
   Actions.

A version with a prerelease suffix, such as `1.2.0-beta.1`, makes a prerelease
and needs its own `CHANGELOG.md` section. The workflow builds its commit on top
of `release` but pushes only the tag, so users on the branch don't receive it.
Testers install it at its tag, and a later release replaces its running service
through [updates and service handoff](task-continuation.md#updates-and-service-handoff).

The workflow (`.github/workflows/release.yml`):

1. Runs the CI checks and the marketplace install test.
2. Assembles the release and commits it to `release`, naming the source commit
   in the message.
3. Tags the commit and attaches an attested zip to a GitHub release, marked as a
   prerelease when the version has a suffix.
4. Installs `<owner>/<repo>@v<version>` from GitHub with Codex on Linux, macOS
   and Windows.

The source commit on `main` stays untagged, because user-facing tags name
release commits. The workflows pin the Codex CLI to the version the README lists
as tested, so change them together.

The workflow relies on repository settings made by hand:

- A ruleset on `release` that lets only GitHub Actions push and blocks force
  pushes and deletion.
- A ruleset on `v*` tags that lets only GitHub Actions create them and blocks
  updates and deletion.
- A public repository, because `codex plugin marketplace add owner/repo` fetches
  without credentials.

`.github/workflows/ci.yml` runs the checks on Linux and macOS for pushes to
`main` and pull requests. Windows runs only the build and package tests,
because parts of the suite use POSIX shell fakes.

## Checks

```sh
npx playwright install chromium
npm run typecheck
npm test
```

Install Chromium once after setup, and again when a Playwright upgrade needs it.

- `npm run typecheck` checks schema freshness and TypeScript across production,
  development and test code.
- `npm test` first checks schema freshness, formatting, lint and unused code,
  then builds. It then runs the browser flows and Vitest. To diagnose a failure
  before the tests run, use `npm run schemas:check`, `npm run format:check`,
  `npm run lint`, `npm run knip` or `npm run build`.

For focused checks during iteration:

| Command                      | Runs                         |
| ---------------------------- | ---------------------------- |
| `npm run test:e2e`           | Browser flows, after a build |
| `npm run test:unit`          | Vitest `unit` project        |
| `npm run test:integration`   | Vitest `integration` project |
| `npx vitest run <test-file>` | One test file                |
| `npm run test:watch`         | Vitest in watch mode         |

The Vitest commands skip the `npm test` preflight. Regenerate schemas after
contract edits, and build first when a test reads `dist/`.

Format edited files with `npx eslint --fix <files>`, then
`npx prettier --write <files>`. ESLint also lints Markdown, but check cross-file
links and heading fragments yourself after moving documentation.

Lint enforces the [runtime boundaries](architecture.md#code-ownership), React
hook rules and type-aware checks. TypeScript checks for missing values in
indexed reads. Type inputs by the data they can contain, and handle missing
values when reading them.

Lint also limits file length and complexity. Lower or remove exceptions when
refactoring, and explain any increase a change needs. Remove stale complexity
suppressions with `npx eslint . --prune-suppressions`. If Knip reports a file
loaded by path as unused, declare its entry point in `knip.json`.

Unit tests, including the jsdom suites in `tests/ui/`, time out after 15
seconds. Integration and browser tests allow 60 seconds for process and worktree
setup. Put shared colocated test setup in a `<module>-test-harness.ts` file,
which lint, type checks and builds treat as test code.

Compare DOM nodes with Vitest's `expect`, never Node's assertion equality
methods. Formatting a failed Node assertion can hang on jsdom's document graph.
Use `toBe` for identity, `toEqual` for structure and `toBeNull` for absence.

[UI verification](ui-verification.md) covers manual browser checks, and
[Live Claude checks](claude-verification.md#live-claude-checks) cover opt-in
tests that make model calls.

### Choosing test coverage

Inspect existing coverage before adding tests. Give each behavior one primary
test layer, starting from the broadest that can reliably exercise it. Extend
the owning suite when possible.

| Layer             | Location                                                                       | Covers                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Browser flows     | `tests/e2e/*.spec.ts`                                                          | User flows through the built console against real HTTP, SSE, SQLite and temporary Git repositories, with the fixture worker |
| Integration tests | `*.integration.test.ts` beside the owning code, or `tests/integration/`        | Service, transport, process and Git boundaries that need direct control or the console cannot reach                         |
| Unit tests        | `*.test.ts` or `*.test.tsx` beside the module, and jsdom suites in `tests/ui/` | Complicated logic and cases broader tests cannot reliably exercise                                                          |

Feature integration tests that combine task control with real SQLite, Git or
worker execution sit beside their owning code. Cross-runtime, HTTP, MCP,
package and process suites go in `tests/integration/`. Both run in Vitest's
`integration` project, which `test:unit` excludes. Classify a test by its
fixtures and assertions. Real socket and child-process tests belong in
integration coverage even with fake services or executables. A temporary
directory alone does not make a test an integration test.

Add unit tests only for parser boundaries, permission rules, async races, stale
responses, Unicode handling, state reconciliation and similar rules. Use jsdom
tests for deterministic failures, concurrent edits, keyboard behavior and host
bridge interactions that console browser tests cannot reproduce.

Remove happy-path unit and mocked UI tests once a browser or integration test
owns the same behavior. Trim cases and assertions individually, preserving
unique rules and edge cases. Name retained tests for the behavior they protect.

Test behavior and documented contracts. Skip assertions that only copy constant
tables, property projections, CSS declarations, SVG artwork or placeholder
markup. Derive expected results independently of the production helper being
tested. Keep parameterized cases only when they protect distinct rules or
boundaries. Leave framework and standard-library behavior to their own tests.
Use the smallest fixtures that cross the relevant boundary, such as one row
past a rendering block, unless the test checks scale itself.

Keep fixture replay and preview simulation tests when production flows cannot
exercise their behavior.

### Browser flows

`npm run test:e2e` builds, then runs workers on half the CPU cores. Each test
starts a disposable service on an OS-assigned loopback port, with its own
SQLite database, settings, fixture worker and Git repository. Teardown closes
the service and removes its files even when the test fails. In a sandbox, allow
localhost TCP listeners and browser processes.

Wait for mutations to finish before reloading. A modal hiding background
content from role queries does not prove that the mutation succeeded.

Rerun against an existing build with `npx playwright test`. Failures keep
traces and screenshots in `test-results/`, which CI uploads. Inspect a trace
with `npx playwright show-trace <trace.zip>`. Give concurrent Playwright
commands distinct `--output` directories so one run cannot delete another's
results.

[Browser flows](../tests/e2e/README.md) describes how the flows set up state,
how to measure their performance and which behaviors they verify.

## Send latency measurements

[Measure performance](logging.md#measure-performance) covers task timing
records, transport measurements and resource samples. Use them to compare
message latency and scheduler work before changing performance behavior.

## Troubleshooting

| Symptom                                       | Cause and fix                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Dev host live mode logs 502                   | The service is not running, or not on the port Vite resolved at startup                    |
| Dev host live mode logs 401                   | Vite and the service use different data directories, so the token does not match           |
| Codex shows different tasks than the dev host | Codex's `CODEX_SUBAGENT_EXTENSION_DATA` differs from `.env`                                |
| Service exits on start                        | Another service owns the data directory, or the port is taken, for example by the demo     |
| `npm test` fails before running tests         | A schema, formatting, lint, unused code or build check failed. Run the checks individually |
| Missing or stale generated schema             | Run `npm run schemas:generate`, then `npm run schemas:check`                               |
| No schema contracts found under `src`         | Run the command from the project root, and check that source files use `*-contract.ts`     |
| Permissive validator rejected                 | Import the type from a discovered `*-contract.ts` file, or write the schema by hand        |
