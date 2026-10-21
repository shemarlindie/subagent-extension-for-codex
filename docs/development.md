# Local development

Use this guide to build, run, change and check the project locally. For code
ownership and runtime boundaries, see [Architecture](architecture.md). For browser
checks, see [UI verification](ui-verification.md).

Run every command from the project root. Requires Node.js 24+ and Git.

## Setup

```sh
npm ci
cp -n .env.example .env
```

`.env` is gitignored. `npm run dev`, `npm start`, `npm run projects`, and
`npm run dev:ui` load it when present. Variables already set in the shell take
precedence. The stdio proxy reads the mention-test setting from `.env` and uses
its `CODEX_SUBAGENT_EXTENSION_DATA` only as a fallback destination for the test
search log. Service connection settings come from its MCP environment.
The example keeps data in `.codex-subagent-extension/live`. See the
[configuration table](configuration.md#environment-variables) for every variable.

**One data directory.** The service and panel dev host must use the same
`CODEX_SUBAGENT_EXTENSION_DATA`, which holds the database and admin token. Choose
[stdio or HTTP](#connect-codex-from-a-checkout). For stdio,
the Codex-launched proxy needs that data directory in its MCP environment for
service discovery. Add the same path, made absolute:

```toml
[mcp_servers.codex_subagent_extension.env]
CODEX_SUBAGENT_EXTENSION_DATA = "<checkout-root>/.codex-subagent-extension/live"
```

If the plugin is installed too, also give the checkout its own `PORT` (for
example `17318`) in `.env` and the MCP environment. Otherwise the plugin's proxy
finds the checkout's service on port 17317, and an update can
[hand over](task-continuation.md#updates-and-service-handoff) a
checkout service that a stdio proxy started.

For HTTP, configure the [Streamable HTTP](#streamable-http) URL and Authorization header using the
token from `<checkout-root>/.codex-subagent-extension/live/admin-token`, or the
service's token override. Codex does not need a data-directory environment setting
for HTTP.

For composer mention diagnostics, add
`CODEX_SUBAGENT_EXTENSION_MENTION_TEST_MODE=1` to the project `.env`, then
reload the MCP connection. The stdio proxy reads this one setting and answers
mention search locally, so the backend service does not need a restart. Every
mention query returns a visibly labeled sample `Claude` result and is appended
to `<data-directory>/mention-search.jsonl`. The log contains the query,
timestamp, result names, and whether provider checks were skipped for the sample.
Remove the setting after testing. The sample does not prove a Claude provider
is available.

With **Automatically add chat projects** enabled (the default), starting a task
from a chat registers its project. Use **Manage → Add project** or
`npm run projects` to register other projects. See
[Repository access](configuration.md#repository-access).

## Generated validation schemas

Choose the source of validation according to what the contract owns:

- Plain boundary data shapes use TypeScript contracts and generated Zod schemas.
  This covers settings documents, panel output,
  and Claude start/task options. Edit the source types in the owning feature and regenerate the validators.
- Inputs with transformations, defaults, or substantial validation behavior use
  handwritten Zod and inferred TypeScript types. Task start, tool inputs,
  settings updates, stored task validation, and SDK input contracts keep this
  approach.
- Database row validators derive from Drizzle tables at deserialization
  boundaries. Internal types that need no runtime validation remain plain
  TypeScript.

JSDoc supplies rules that ordinary TypeScript types cannot express. For example,
the Claude task-options contract uses `@strict` to reject extra properties.
Supported annotations also include `@format url` for URLs and `@default` for
omitted input values.
Contracts describe parsed output. Defaults can make an input property optional
even when it is required in that output.

The runner discovers `src/**/*-contract.ts` automatically, excluding generated
files and `*-contract.test.ts`. No central registration is needed, and imports
between discovered contracts resolve to their generated validators.

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
   `message-contract.generated.ts`, exporting `messageSchema`.
3. Call the generated validator at the boundary and use the source type for
   internal code:

   ```ts
   import { messageSchema } from "./message-contract.generated.js";
   import type { Message } from "./message-contract.js";

   export function decodeMessage(input: unknown): Message {
     return messageSchema.parse(input);
   }
   ```

4. Add focused tests beside the contract for accepted and rejected data and any
   annotation behavior. Run `npm run typecheck`.

Keep the source, generated file, and tests together in any requested commit. See
[Checks](#checks) for the build and watch workflows.

For a handwritten validator, add a feature-owned `schema-generation.mjs` with
paths relative to that configuration file. Claude's configuration, for example,
keeps its permission policy in `permissions.ts`:

```js
export default {
  mappings: [{ input: "./permissions.ts", output: "./permissions.ts" }],
};
```

These configurations run only during schema generation. Each imported type maps
to its usual camel-case schema name (for example, `PermissionMode` maps to
`permissionModeSchema`). A mapping can supply `getSchemaName` for another naming
convention. The runner rejects duplicate mappings, conflicts with generated
outputs, and permissive `z.any()` fallbacks. See [Troubleshooting](#troubleshooting).
Do not feed Drizzle inferred types into this generator.

Database row validation derives from Drizzle tables at deserialization boundaries.
Serialized JSON needs its own payload validation. See
[Database and migrations](database.md). Schema generation does not change migrations.

## Run the service

Build before starting either service mode, including when testing in Codex over
HTTP or stdio:

| Use           | Command                        | Backend behavior                                                                                                       |
| ------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Development   | `npm run build && npm run dev` | Runs `src/service/main.ts` through `tsx` and Node's watch mode. Restarts when an imported backend source file changes. |
| Built service | `npm run build && npm start`   | Runs `dist/main.js`. Applying backend changes requires rebuilding and restarting.                                      |

Both modes serve the embedded Codex panel and standalone console from
`dist/app.html`. `npm run dev` does not rebuild the panel after UI edits.
Follow [What reloads when](#what-reloads-when) to apply subsequent changes.
For browser UI development with Fast Refresh, use the [panel dev host](#panel-dev-host).

A restart interrupts active tasks. Send a follow-up after the service returns
to continue them. Both commands run the service in the foreground at `http://127.0.0.1:17317`. Stop it with Ctrl-C. If Codex is open with
the plugin enabled, its stdio proxy may already have started one. A second service
cannot own the same data directory. On macOS and Linux, an interactive startup
reports process details and asks before sending SIGTERM to a verified service
owner. If it remains alive after five seconds, a second confirmation is required
before SIGKILL. Non-interactive launches and Windows do not stop processes here.

Check it from another terminal:

```sh
curl --fail http://127.0.0.1:17317/health
npm run projects -- list
```

The standalone console is at `http://127.0.0.1:17317`. Sign in with the contents
of `<data-directory>/admin-token`, for example
`pbcopy < .codex-subagent-extension/live/admin-token` on macOS.
Use the configured console origin: `localhost` and `127.0.0.1` are different
browser origins, and substituting `localhost` for the default address can fail
the service's origin checks.

## Choosing a development tool

| Command          | Use for                                                      | Worker                                                  |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| `npm run dev:ui` | UI development, prepared scenarios and host/layout controls. | Prepared fixtures, or a connected backend in live mode. |
| `npm run demo`   | Interactive service testing with disposable data.            | Fake worker with no model calls.                        |
| `npm run dev`    | Backend development and Claude execution.                    | Claude model calls can incur costs.                     |

**Data: live** connects to a backend. The connected service determines whether its worker is
fake or Claude. The [Demo](#demo) instructions show how to combine it with the
[panel dev host](#panel-dev-host). See [What reloads when](#what-reloads-when)
for applying source changes.

## Panel dev host

```sh
npm run dev:ui
```

This starts a Vite server at `http://127.0.0.1:5317` with React Fast Refresh and
CSS hot replacement for development. Production HTML comes from
`scripts/build-panel.mjs`.

The page embeds the real panel in an iframe through the official `AppBridge`.
Use **Data: fixtures** for UI checks without a production service. Prepared
fixtures cannot start provider tasks. Supported Chat interactions update
simulated fixture state. **Launch** chooses thread or global
scope. You can also vary the theme, display mode, width and host capabilities. The
**Inspector** exposes the bridge log, host settings and icon catalog. The dev
host does not send style variables by default. Leave **Host style variable
overrides** empty to omit them, or enter JSON to test specific values. See
[UI verification](ui-verification.md#measurement-and-checks-in-codex) for the
captured host styles and the limits of the dev host.

[UI verification](ui-verification.md) documents the browser workflow, fixture
catalogue and host controls. Fixtures in `dev/panel/scenarios/` are excluded from the
production bundle. Most calls use browser fixtures. Changes and worktree calls
in `FIXTURE_SERVICE_TOOLS` run real service code against disposable repositories
on Vite. Source edits rebuild these repositories on the next call, and the
bridge log identifies the source that served each call.

Live mode connects to the service's `/mcp` endpoint through the Vite proxy at
`/service`. The proxy adds the admin token server-side and drops the browser
`Origin` header, so the token never reaches the page. It checks `CODEX_SUBAGENT_EXTENSION_URL`,
`CODEX_SUBAGENT_EXTENSION_ORIGIN`, the data directory's `service.json`, then
port 17317. It ignores `PORT`, which in the dev host's process is its own port
(the `.claude/launch.json` launcher sets it). It reads the token from
`CODEX_SUBAGENT_EXTENSION_TOKEN` or the data directory's `admin-token`. Start
the service first, or restart Vite after it moves ports.

For Claude execution against throwaway data, give both processes the same data directory.
The dev host finds the service's port in its `service.json`:

```sh
CODEX_SUBAGENT_EXTENSION_DATA=/tmp/panel-dev PORT=4399 npm run dev
CODEX_SUBAGENT_EXTENSION_DATA=/tmp/panel-dev npm run dev:ui
```

### Access from your local network

Pass `--host` to either command to listen on network interfaces. Without it,
both commands listen on loopback only:

```sh
npm run dev -- --host
npm run dev:ui -- --host
```

On the other computer, open `http://<service-computer-LAN-IP>:5317` for the
dev UI or `http://<service-computer-LAN-IP>:17317` for the standalone console.
The service binds all IPv4 interfaces and prints its network URLs at startup.
The console still requires the admin token. LAN console origins use the service computer's interface
addresses discovered at startup. Restart after those addresses change.
Codex and the UI proxy continue connecting through loopback.

For dev UI live mode alone, only `dev:ui` needs `--host`. The service can stay
on loopback. The dev UI proxy adds the admin token automatically, so anyone
who can reach that UI can control the service in live mode. Use these flags
only on a trusted local network. They bind all interfaces. Firewall rules
determine which computers can connect. Public and multi-user hosting are
outside this development option.

## Recorded fixtures

The preview supports synthetic fixtures built with
`dev/panel/scenarios/timeline.ts` and tasks recorded from real Claude runs in
`dev/panel/recorded/`. Recordings preserve SDK messages from those runs.
Scenario modules live in `dev/panel/scenarios/`, and `fixtures.ts` assembles the
registry used by the dev host and replay tests.
`dev/panel/scenarios/preview-sdk-fixtures.test.ts` replays both kinds through the
provider.

Record a task from any service database (the service's, the demo's, or a
temporary one such as `scripts/verify-live-claude.mjs` creates):

```bash
npm run fixture:record -- --db <tasks.sqlite> --task <task id> --name <name> --title "Recorded: <what it shows>" --start 2026-10-02T11:40:00.000Z --first-id 3400
```

It writes `dev/panel/recorded/<name>.json` for task `preview-recorded-<name>`
in the `dev-thread` thread and the `/demo/project` project. Then import the file
in `fixtures.ts` and add it to `recordedFixtures`. Choose a `--first-id` past the
other fixtures' event ids (the recorded ones start at 3000, a hundred apart), and
a `--start` that keeps the task where you want it in the newest-first list.

The recorder replaces machine paths and identifiers, removes local Claude
configuration and private usage details, and shifts event IDs and times for the
preview. Fixture replay maps recorded `tool_use_result` payloads through
`claudeFileEdits`, so captured edit results populate Changes. File previews still
need a fixture workspace or prepared content.

Review the output before committing: prompts and file contents can still contain
private information. The recorder rejects common machine identifiers, but that
check cannot establish that the whole recording is safe to share. Use repeatable
`--replace <from>=<to>` arguments for additional literal replacements, quoting
values with spaces or shell characters, for example
`--replace 'internal-name=/demo/name'`.

## Connect Codex from a checkout

Installed users get the plugin from the marketplace ([README](../README.md#install)).
To run a checkout instead, build it, choose one transport and add its example to
`~/.codex/config.toml`. Remove the plugin first, or Codex runs both servers. Both expose
the same task tools and MCP App. Replace the existing server entry when switching
transports. Do not combine its stdio and HTTP settings. See the
[Codex MCP configuration reference](https://learn.chatgpt.com/docs/extend/mcp#configure-with-configtoml)
for supported options.

### Stdio

Run `npm run build`, then configure the built launcher using an absolute checkout
path:

```toml
[mcp_servers.codex_subagent_extension]
command = "node"
args = ["<checkout-root>/dist/stdio.js"]
```

The launcher connects to the local service or starts it when needed. It reads the admin token itself. If you override `CODEX_SUBAGENT_EXTENSION_DATA`, give the service and MCP launcher the same absolute path through `[mcp_servers.codex_subagent_extension.env]`. See [task continuation](task-continuation.md) for recovery and state preservation, and [Configuration](configuration.md#admin-token) for token overrides.

### Streamable HTTP

Start the service before connecting Codex:

```sh
npm run build && npm start
```

For development, use `npm run build && npm run dev` instead. Both serve the built
panel. Follow [What reloads when](#what-reloads-when) after edits.

Configure the authenticated `/mcp` endpoint:

```toml
[mcp_servers.codex_subagent_extension]
url = "http://127.0.0.1:17317/mcp"

[mcp_servers.codex_subagent_extension.http_headers]
Authorization = "Bearer <admin-token>"
```

Replace `<admin-token>` locally with the contents of
`~/.local/share/codex-subagent-extension/admin-token`, or
`<data-directory>/admin-token` if you changed the data directory. If the service
uses `CODEX_SUBAGENT_EXTENSION_TOKEN`, use that override instead. On macOS, copy
the default file's token without printing it:

```sh
pbcopy < ~/.local/share/codex-subagent-extension/admin-token
```

Keep the token and configuration private. Do not paste them into chats or commit
them. Update the URL if you changed the service port. HTTP connections require
you to keep the service running. Codex does not start it through this transport.

### Verify either connection

After saving the configuration, reload the MCP connection in Codex and open
**Delegated Work** from a chat. Use `codex mcp list` to check the configured server.
Opening the panel verifies the connection and shows the same tasks as the dev
host in live mode. Changed tool metadata also requires
MCP reconnection. To check UI changes in Codex, see
[UI verification](ui-verification.md#measurement-and-checks-in-codex).

## Demo

```sh
npm run demo
```

The script builds the project, registers a disposable repository at
`.codex-subagent-extension/demo-repository`, and starts the real service with
only the fixture worker. Its data directory is `.codex-subagent-extension/demo`.
It makes no model calls. Sign in at
`http://127.0.0.1:17317` with `local-demo-only-not-a-real-token`. Stop any other
service on port 17317 first.

To combine interactive fake-worker tasks with UI hot reload:

1. Run `npm run demo` in one terminal.
2. Start Vite in another terminal with the demo connection:

   ```sh
   CODEX_SUBAGENT_EXTENSION_DATA="$PWD/.codex-subagent-extension/demo" \
   CODEX_SUBAGENT_EXTENSION_TOKEN=local-demo-only-not-a-real-token \
   CODEX_SUBAGENT_EXTENSION_URL=http://127.0.0.1:17317 npm run dev:ui
   ```

3. Open `http://127.0.0.1:5317`, choose **Data: live** and **Launch: global**, and
   **Relaunch**.
4. Select the demo repository in New task.

The panel sends actual requests: create tasks, send follow-ups, answer questions
and interrupt turns. The explicit connection overrides keep Vite from using a
different service configured in `.env`.

For the full fixture trigger catalog, expected outcomes, queue controls, and
failure cases, see [Fixture scenarios](fixture-scenarios.md).

## What reloads when

| Change                               | To see it                                                               |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `src/panel/` in the dev host         | Nothing: Fast Refresh applies it                                        |
| `src/panel/` in Codex or the console | `npm run build`, then reopen the panel or reload the page               |
| `src/service/`                       | `npm run dev` restarts automatically. Restart `npm start` after a build |
| `src/shared/`                        | Refresh the panel as above. `npm run dev` restarts automatically        |
| Tool metadata or panel resource URI  | Restart the service, then reload the MCP connection in Codex            |
| `.env` or `vite.config.ts`           | Restart the affected processes                                          |

The service reads panel HTML from `dist/` on each resource request, so rebuilt
UI needs no service restart. It keeps the last copy it read, and serves that
copy if the file disappears, as when a plugin update removes the running
installation before the service hands over.

## Build

`npm run build` regenerates validation schemas, cleans `dist/`, type checks the
service, and builds the service entrypoints and `dist/app.html`. Both builds
reject dependencies from the opposing runtime, development tooling and tests.

The service bundle includes its runtime packages, so the extracted package runs
without a separate `node_modules` directory. It ships no Claude Code binary.
Bundling drops the packages' license files, so each build collects them into a
notice: `dist/THIRD_PARTY_LICENSES.txt` for the service and
`dist/app.html.THIRD_PARTY_LICENSES.txt` for the panel.
Launches use the installed [Claude Code CLI](claude-cli.md). Source maps omit
embedded sources and map stack traces to the original files.

The bundles live in `dist/bundle/`. The public entries `dist/main.js`,
`dist/stdio.js` and `dist/projects-cli.js` are small ES2017 guards. Each checks
Node against `engines.node` and prints what to install instead of failing on
syntax an old runtime can't parse, then imports its bundle.

`npm run package:plugin` builds and packs the plugin. The package holds only
what the installed plugin runs or shows: `dist/`, `migrations/`, `assets/`,
`skills/`, `plugin.json`, `mcp.json`, the README and `LICENSE`. Guides under
`docs/` are read on GitHub, so the README's relative links to them don't resolve
inside an extracted package. `tests/integration/package/packed-artifact.test.ts`
verifies startup, transports, CLI readiness and restart behavior from an
extracted package outside the checkout. It fails if the top-level file list
changes.

`npm run release:assemble` (after a build) writes `release/`: the packed files,
a manifest with no scripts or dependencies, and
`.agents/plugins/marketplace.json` listing the plugin with source `./`, so the
directory is both a Codex marketplace and the plugin. Install it locally with
`codex plugin marketplace add ./release`, then
`codex plugin add codex-subagent-extension@shemarlindie`. The marketplace name
`shemarlindie` is part of the plugin ID and its `PLUGIN_DATA` path, so it must
not change.

`tests/integration/package/marketplace-install.test.ts` assembles its own copy
from `dist/`, installs it with the Codex CLI into a temporary `CODEX_HOME`, and
runs the MCP command Codex reports against an isolated data directory and port.
It checks that the installed plugin reports the package version, lists and
answers tools, and starts the service itself. It runs in `npm test`, needs the
Codex CLI (`CODEX_BIN` or `codex` on `PATH`) and is skipped without it. To run
it alone after a build:

```sh
npx vitest run tests/integration/package/marketplace-install.test.ts
```

Set `MARKETPLACE_SOURCE` to a published marketplace, such as
`owner/repo@v1.2.3`, to install that instead. Its version must match the
checkout's `package.json`, which the test compares against. The release
workflow does this after publishing.

## Releasing

Users install from the `release` branch, which holds only assembled releases.
Each release commit is tagged `v<version>`. Codex refreshes Git marketplaces on
startup and reinstalls the plugin when the branch moves, so every push to
`release` reaches users.

1. Bump `version` in `package.json` and `plugin.json`. The build fails when they
   differ, and Codex keys installed versions by it, so every release needs a
   new one.
2. Add a `## <version>` section to `CHANGELOG.md` for users: what changed, and
   anything to do by hand. Its text becomes the GitHub release notes.
3. Merge to `main`, then run the **Release** workflow from `main` in GitHub
   Actions.

A version with a prerelease suffix, such as `1.2.0-beta.1`, makes a
prerelease. It needs its own `## 1.2.0-beta.1` section in `CHANGELOG.md`. The
workflow builds its commit on top of `release` and pushes only the tag, so
users following the branch don't receive it. The GitHub release is marked as a
prerelease. Testers install it at its tag, and a later release replaces its
running service as described in
[updates and service handoff](task-continuation.md#updates-and-service-handoff).

The workflow (`.github/workflows/release.yml`) runs the CI checks and the
marketplace install test, assembles the release, commits it to `release` with
the source commit in the message, tags it, attaches an attested zip to a
GitHub release, and then installs `<owner>/<repo>@v<version>` from GitHub with
Codex on Linux, macOS and Windows. The source commit on `main` isn't tagged,
because user-facing tags name release commits.

Repository settings the workflow relies on, set by hand:

- A ruleset on `release` that allows only GitHub Actions to push and blocks
  force pushes and deletion.
- A ruleset on `v*` tags that allows only GitHub Actions to create them and
  blocks updates and deletion.
- A public repository, since `codex plugin marketplace add owner/repo` fetches
  without credentials.

The workflows pin the Codex CLI to the version the README lists as tested.
Change them together.

`.github/workflows/ci.yml` runs the checks on Linux and macOS for pushes to
`main` and pull requests. Windows runs only the build and packaging tests,
because parts of the suite use POSIX shell fakes.

## Storage and Claude verification

- [Database and migrations](database.md) covers schema changes, transactions
  and event notifications.
- [Claude execution verification](claude-verification.md) covers CLI/SDK
  qualification and opt-in authenticated scenarios.

## Checks

```sh
npx playwright install chromium
npm run typecheck
npm test
```

`npm run typecheck` checks schema freshness and TypeScript across production,
development and test code. `npm test` checks schema freshness, formatting, lint
and unused code, then builds, runs the browser flows and runs Vitest. Install
Chromium once after setup, and again when a Playwright upgrade requires it. To
diagnose a preflight failure, run `npm run schemas:check`, `npm run format:check`, `npm run lint`,
`npm run knip` or `npm run build` individually.

During iteration, use `npm run test:e2e` for browser flows. Use
`npm run test:integration` or `npm run test:unit` for one Vitest project, or
`npx vitest run <test-file>` for a focused check. These Vitest commands and watch
mode (`npm run test:watch`) skip the preflight: regenerate schemas after contract
edits and build first when a test reads `dist/`.

Format edited files with `npx eslint --fix <files>` followed by
`npx prettier --write <files>`. ESLint also checks Markdown, but cross-file links
and heading fragments need a separate check after documentation moves.

Lint enforces the [runtime boundaries](architecture.md#code-ownership), React hook
rules and type-aware checks. Use types that reflect the data an input can
contain, and handle missing values when reading it. TypeScript also checks for
missing values in indexed reads.

Lint limits file length and code complexity.
Lower or remove exceptions when refactoring. Explain any increase needed for a change. Remove stale
complexity suppressions with `npx eslint . --prune-suppressions`. If Knip reports a
file loaded by path as unused, declare its entry point in `knip.json`.

Unit tests have a 15-second timeout, including the jsdom suites in `tests/ui/`.
Integration and browser suites have 60 seconds for process and worktree setup.
Keep shared colocated test setup in a `<module>-test-harness.ts` file. These harnesses are
treated as test code by lint, type checks and builds.

### Choosing test coverage

Start with browser end-to-end coverage for user flows. Browser flows in
`tests/e2e/` exercise the built console against real HTTP, SSE, task controls,
SQLite and temporary Git repositories with the fixture worker. They do not call
Claude. Use integration tests for service, transport, process and Git boundaries
that need direct control or cannot be reached through the console.

Keep feature integration tests beside their owning code as
`*.integration.test.ts`. Tests that combine task control, real SQLite, Git or
worker execution belong here. Keep cross-runtime, HTTP/MCP, package and process
suites in `tests/integration/`. Both locations run in Vitest's `integration`
project with a 60-second timeout and are excluded from `test:unit`. Pure logic,
mocked boundary behavior and component tests remain ordinary `*.test.ts` or
`*.test.tsx` files in the `unit` project. Classify a test by its fixtures and
assertions. A temporary directory alone does not make it an integration test.

Add unit tests only when they protect complicated logic or a case that broader
tests cannot reliably exercise. Examples include parser boundaries, permission
rules, async races, stale responses, Unicode handling and state reconciliation.
Use jsdom tests in `tests/ui/` or beside components for deterministic failures,
concurrent edits, keyboard behavior and host bridge interactions that console
browser tests cannot reproduce.

Give each behavior one primary test layer. Remove happy-path unit and mocked UI
tests once browser or integration coverage owns the same behavior. Keep a
focused test only for its additional rule or edge case, and make that purpose
clear in its name. Avoid assertions that repeat constant tables, property
projections, CSS declarations, SVG geometry or placeholder markup. Types and
lint cover structural rules without more tests.

```sh
npx playwright install chromium
npm run test:e2e
```

`test:e2e` builds first and runs with two browser workers. Each test starts a
disposable service on an OS-assigned loopback port with its own SQLite database,
settings, fixture worker and Git repository. Teardown closes the service and
removes its files even when the test fails. Allow localhost TCP listeners and
browser processes when running in a sandbox. To rerun against an existing build,
use `npx playwright test`. CI runs Chromium on Linux and macOS after the build
and retains traces and screenshots from failures in
`test-results/`. Inspect a trace with `npx playwright show-trace <trace.zip>`.

Login and explicit project registration have one full browser flow. Other flows
prepare these prerequisites through the public HTTP login and registration
endpoints, sharing cookies with their fresh browser context. Task creation,
questions, approvals, continuation, worktree actions, archive controls, read
state and settings still run through the browser. Reload checks establish
persistence. Lost responses use Playwright routing, and a lost event stream
closes the service's open connections. Most HTTP services run inside their
Playwright worker process. The recovery
browser flow starts the development fixture service in a separate process,
crashes it and reopens the same data directory on the same port. It verifies
reauthentication, interrupted work, scheduler-queued tasks, the paused message
queue and ordered continuation. Separate suites in `tests/integration/service/`
own launcher and package lifecycle details.

Measure browser performance against the same build and trace settings. Use
`npx playwright test --workers=1 --reporter=json` to inspect serial costs, then
compare the default worker count. Use `--repeat-each=3` to check repeatability
and isolation. The JSON report records total runtime and individual test
durations. Trace hooks distinguish setup time from the actual flow. Keep
condition-based assertions and failure diagnostics when optimizing. Add workers
only when measurements show a benefit without resource contention. Give
concurrent Playwright commands distinct `--output` directories so one run cannot
clean up another run's traces and screenshots.

The browser verification checklist is:

| ID  | Expected behavior                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------- |
| E1  | Sign in and explicitly register a project through the console.                                                              |
| E2  | Start a task, answer its question and approve a simulated tool request.                                                     |
| E3  | Reload persisted history, then send a follow-up in the same worker session.                                                 |
| E4  | Start in a worktree, preview recorded edits, remove the worktree and branch, then reload the retained diff.                 |
| E5  | Preserve a failed turn across reload and successfully continue the same task.                                               |
| E6  | Archive a completed task, restore it from the project archive, cancel deletion and explicitly delete it.                    |
| E7  | Save settings, reload persisted values and retain a new-task draft while visiting settings.                                 |
| E8  | Queue messages, edit, reorder and remove them, interrupt, reload the paused queue and resume in order.                      |
| E9  | Exhaust a runtime budget, raise its limit, reload and successfully continue.                                                |
| E10 | Create a dependency through the task form, preserve its wait across reload and release it after the prerequisite completes. |
| E11 | Rename a project and verify both removal choices, retaining checkout files and cleaning task worktrees only when requested. |
| E12 | Crash a service with running and queued work, restart, sign in and resume the recovered queue without losing its order.     |
| E13 | Answer stacked single-choice and multiple-choice questions with a skip, then deny a tool with a message.                    |
| E14 | Keep tasks unread until read, mark them read or unread by menu, reply or bulk action, and reload the results.               |
| E15 | Lose a send's response, keep the draft with retry guidance and deliver the retried message once.                            |
| E16 | Lose the event stream, show reconnection and display work finished while disconnected.                                      |
| E17 | Follow a streaming reply at the end, hold the reading position in history and restore it when Chat returns.                 |

Browser coverage currently uses desktop Chromium. The fake worker establishes
extension routing and persistence behavior. It does not establish native Claude
permissions, live Codex placement or host message delivery. Use
[UI verification](ui-verification.md) and
[Claude execution verification](claude-verification.md) for those checks.

Compare DOM nodes with Vitest's `expect`, not Node's assertion equality methods:
formatting a failed Node assertion can hang on jsdom's document graph. Use `toBe`
for identity, `toEqual` for structural equality and `toBeNull` for absence.

Use [UI verification](ui-verification.md) for browser checks and
[Claude execution verification](claude-verification.md#live-claude-checks) for
opt-in tests that make model calls.

## Send latency measurements

[Logging and diagnostics](logging.md#measure-performance) owns the task timing
format, transport measurements, rotation and resource samples. Use those records
to compare message latency and scheduler work before changing performance
behavior.

Read-only Git-root validation probes have a five-second subprocess timeout.
Timeouts leave repository approval requirements in place and report a retryable
validation failure. See [message retry semantics](mcp-reference.md#retrying-message-sends)
and [panel timeout behavior](panel-guide.md#chat-tab).

## Troubleshooting

| Symptom                                        | Cause                                                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Dev host live mode logs 502                    | The service is not running, or not on the port Vite resolved at startup                             |
| Dev host live mode logs 401                    | Vite and the service use different data directories, so the token does not match                    |
| Codex shows different tasks than the dev host  | Codex's `CODEX_SUBAGENT_EXTENSION_DATA` differs from `.env`                                         |
| Service exits on start                         | Another service owns the data directory, or the port is taken (for example, the demo)               |
| `npm test` fails before running tests          | Schema freshness, formatting, lint, or build preflight failed. Run the checks individually          |
| Missing or stale generated schema              | Run `npm run schemas:generate`, then `npm run schemas:check`                                        |
| No schema contracts found under `src`          | Run the command from the project root. Check that source files use `*-contract.ts`                  |
| Permissive validator rejected                  | Put imported types in a discovered `*-contract.ts` file, or add a feature-owned handwritten mapping |
| Duplicate mapping or generated-output conflict | Remove the duplicate mapping. Discovered contracts already map to their generated validators        |
