# Local development

Use this guide to build, run, change and check the project from a checkout.

- [Architecture](architecture.md) covers code ownership and runtime boundaries.
- [UI verification](ui-verification.md) covers browser and Codex checks of the
  panel.
- [Database and migrations](database.md) covers schema changes, transactions and
  event notifications.
- [Claude execution verification](claude-verification.md) covers CLI and SDK
  qualification and opt-in authenticated scenarios.
- [Releasing and CI](releasing.md) covers publishing versions and the CI runner.
- [Showcase captures](showcase.md) covers the README's images and video.

Run every command from the project root. You need Node.js 24 or later and Git.

## Setup

```sh
npm ci
cp -n .env.example .env
```

`npm run dev`, `npm start`, `npm run projects`, `npm run dev:reset` and
`npm run dev:ui` load `.env` when present. Shell variables take precedence.
`.env` is gitignored, and the example keeps data in
`.subagent-extension-for-codex/live`. See the
[configuration table](configuration.md#environment-variables) for every
variable.

The service, the panel dev host and the stdio proxy must use the same
`SUBAGENT_EXTENSION_FOR_CODEX_DATA`, which holds the database and admin token.
[Connect Codex from a checkout](#connect-codex-from-a-checkout) shows how to
give Codex the same directory.

If the plugin is installed too, give the checkout its own `PORT`, such as
`17318`, in `.env` and the MCP environment. Otherwise the plugin's proxy finds
the checkout's service on port 17317, and a plugin update can
[hand over](task-continuation.md#updates-and-service-handoff) a checkout service
that a stdio proxy started.

With **Automatically add chat projects** on (the default), starting a task from
a chat registers its project. Use **Manage projects… → Add project** or
`npm run projects` to register others. See
[Repository access](configuration.md#repository-access).

## Choosing a development tool

| Command          | Use for                                                     | Worker                                                 |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| `npm run dev:ui` | UI development, prepared scenarios and host/layout controls | Prepared fixtures, or a connected backend in live mode |
| `npm run demo`   | Interactive service testing with disposable data            | Fixture worker with no model calls                     |
| `npm run dev`    | Backend development and Claude execution                    | Claude model calls, which can incur costs              |

In the dev host, **Data: live** connects to a running service, whose worker may
be the fixture worker or Claude. [Demo](#demo) shows how to pair the dev host
with the fixture worker.

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
contents of `<data-directory>/admin-token`. On macOS, with the example `.env`,
`pbcopy < .subagent-extension-for-codex/live/admin-token` copies it without
printing it. Use the configured origin. `localhost` and `127.0.0.1` are
different browser origins, and the service's origin checks can reject the
substitute.

### Reset service data

`npm run dev:reset` asks for confirmation, clears the configured data directory
and restarts the service only if it was running. The replacement uses the
current build in the background and logs to `<data-directory>/service.log`. On
Windows, stop the service manually first.

## Panel dev host

```sh
npm run dev:ui
```

This starts Vite at `http://127.0.0.1:5317` with React Fast Refresh and CSS hot
replacement. The page hosts the real panel and lets you vary launch scope,
theme, display mode, width and host capabilities.
[UI verification](ui-verification.md) covers the workflow, host controls,
fixture catalogue and style variables.

**Data: fixtures** checks the UI without a production service. Prepared fixtures
cannot start provider tasks, but supported Chat interactions update simulated
state. Fixtures live in `dev/panel/scenarios/` and stay out of the production
bundle. Most tool calls use browser fixtures. Changes and worktree calls listed
in `FIXTURE_SERVICE_TOOLS` run real service code on Vite against disposable
repositories. The fixture service creates each task's repository and recorded
edits on its first call for that task. Source edits reset this state.

**Data: live** connects to the service's `/mcp` endpoint through the Vite proxy
at `/service`. The proxy adds the admin token server-side and drops the browser
`Origin` header, so the token never reaches the page.

- The proxy finds the service from `SUBAGENT_EXTENSION_FOR_CODEX_URL`, then
  `SUBAGENT_EXTENSION_FOR_CODEX_ORIGIN`, then the data directory's
  `service.json`, then port 17317. It ignores `PORT`, which sets the dev host's
  own port in this process.
- It reads the token from `SUBAGENT_EXTENSION_FOR_CODEX_TOKEN` or the data
  directory's `admin-token`.
- Start the service first, and restart Vite after the service changes ports.

For Claude execution against throwaway data, give both processes the same data
directory. The dev host reads the service's port from `service.json`:

```sh
SUBAGENT_EXTENSION_FOR_CODEX_DATA=/tmp/panel-dev PORT=4399 npm run dev
SUBAGENT_EXTENSION_FOR_CODEX_DATA=/tmp/panel-dev npm run dev:ui
```

### Access from your local network

Both commands listen on loopback only. Pass `--host` to listen on network
interfaces:

```sh
npm run dev -- --host
npm run dev:ui -- --host
```

On another computer, open `http://<service-computer-LAN-IP>:5317` for the dev
host or `http://<service-computer-LAN-IP>:17317` for the standalone console.

- The service binds all IPv4 interfaces and prints its network URLs at startup.
- The console still requires the admin token. It accepts LAN origins from the
  interface addresses found at startup, so restart after those change.
- Codex and the dev host proxy still connect through loopback. For dev host live
  mode alone, only `dev:ui` needs `--host`.

The dev host proxy adds the admin token, so anyone who can reach the dev host
can control the service in live mode. Use these flags only on a trusted local
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

Start the service with `SUBAGENT_EXTENSION_FOR_CODEX_FULL_EVENTS=1` before
running a task you want to record. The live verification scripts enable this
automatically. Export the task from its service database:

```bash
npm run fixture:record -- --db <data-directory>/service.sqlite --task <task id> --name <name> --title "Recorded: <what it shows>" --start 2026-10-02T11:40:00.000Z --first-id 3400
```

This writes `dev/panel/recorded/<name>.json` for task `preview-recorded-<name>`
in the `dev-thread` thread and `/demo/project` project. Import the file in
`fixtures.ts` and add it to `recordedFixtures`.

- Choose a `--first-id` past the event IDs other fixtures use.
- Choose a `--start` that places the task where you want it in the newest-first
  list.

The recorder replaces machine paths, identifiers and thinking signatures,
removes local Claude configuration and private usage details, and shifts event
IDs and times. It derives provider events again from the sanitized responses, so
they match the current provider and can differ from the database.

Captured edits populate Changes. File previews still need a fixture workspace or
prepared content.

Review the output before committing, because prompts and file contents can still
hold private information. The recorder rejects common machine identifiers, but
that check cannot prove the recording is safe to share. Add literal replacements
with repeatable `--replace <from>=<to>` arguments, quoting values with spaces or
shell characters, such as `--replace 'internal-name=/demo/name'`.

## Connect Codex from a checkout

Installed users get the plugin from the marketplace
([README](../README.md#install)). To run a checkout, build it, pick one
transport and add its example to `~/.codex/config.toml`. Both transports expose
the same task tools and MCP App.

- Remove the plugin first, or Codex runs both servers.
- Replace the existing server entry when switching transports. Do not combine
  stdio and HTTP settings.
- To return to the plugin, delete `[mcp_servers.subagent_extension_for_codex]`
  and its `env` or `http_headers` tables, and stop the checkout's service. The
  plugin never stops a service it didn't start.

See the
[Codex MCP configuration reference](https://learn.chatgpt.com/docs/extend/mcp#configure-with-configtoml)
for supported options.

### Stdio

Run `npm run build`, then point Codex at the built stdio proxy. The proxy
ignores the checkout's `.env`, so give it the service's data directory as an
absolute path. With the example `.env`:

```toml
[mcp_servers.subagent_extension_for_codex]
command = "node"
args = ["<checkout-root>/dist/stdio.js"]

[mcp_servers.subagent_extension_for_codex.env]
SUBAGENT_EXTENSION_FOR_CODEX_DATA = "<checkout-root>/.subagent-extension-for-codex/live"
```

The proxy reads the admin token and connects to the local service, starting it
when needed. See [Task continuation](task-continuation.md) for recovery and
state, and [Admin token](configuration.md#admin-token) for token overrides.

### Streamable HTTP

Codex does not start the service over HTTP, so keep it running:

```sh
npm run build && npm start
```

For development, use `npm run build && npm run dev` and follow
[What reloads when](#what-reloads-when) after edits.

Configure the authenticated `/mcp` endpoint:

```toml
[mcp_servers.subagent_extension_for_codex]
url = "http://127.0.0.1:17317/mcp"

[mcp_servers.subagent_extension_for_codex.http_headers]
Authorization = "Bearer <admin-token>"
```

Replace `<admin-token>` with the contents of `<data-directory>/admin-token`, or
with `SUBAGENT_EXTENSION_FOR_CODEX_TOKEN` if the service uses that override.
[Run the service](#run-the-service) shows how to copy it. Codex needs no data
directory setting over HTTP.

Update the URL if you changed the service port. Keep the token and configuration
private, and never paste them into chats or commit them. Unlike the stdio proxy,
an HTTP client sends the token without checking that the
[service holds it](configuration.md#admin-token). On a computer shared with
other users, prefer stdio.

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
`.subagent-extension-for-codex/demo-repository` and starts the service with only
the fixture worker, so it makes no model calls. Data lives in
`.subagent-extension-for-codex/demo`. Stop any other service on port 17317
first, then sign in at `http://127.0.0.1:17317` with
`local-demo-only-not-a-real-token`.

To pair fixture worker tasks with UI hot reload:

1. Run `npm run demo` in one terminal.
2. Start Vite in another terminal with the demo connection:

   ```sh
   SUBAGENT_EXTENSION_FOR_CODEX_DATA="$PWD/.subagent-extension-for-codex/demo" \
   SUBAGENT_EXTENSION_FOR_CODEX_TOKEN=local-demo-only-not-a-real-token \
   SUBAGENT_EXTENSION_FOR_CODEX_URL=http://127.0.0.1:17317 npm run dev:ui
   ```

3. Open `http://127.0.0.1:5317`, choose **Data: live** and **Launch: global**,
   then **Relaunch**.
4. Select the demo repository in New task.

The panel sends real requests, so you can create tasks, send follow-ups, answer
questions and interrupt turns. The explicit variables keep Vite from using a
service configured in `.env`.

[Fixture scenarios](fixture-scenarios.md) lists the prompt triggers, expected
outcomes, queue controls and failure cases.

### Drive the demo from scripts

A browser script signs in the way the browser flows do, by posting the demo
token to `/api/login` with the service's `Origin`:

```js
await page.request.post("http://127.0.0.1:17317/api/login", {
  data: { token: "local-demo-only-not-a-real-token" },
  headers: { Origin: "http://127.0.0.1:17317" },
});
```

To call a tool with agent authority, post its arguments with the token as a
bearer credential and the `X-Subagent-Extension-For-Codex` header. Console
sessions and `/api/user-tools/` calls carry
[user authority](mcp-reference.md#app-and-user-authority).

```sh
curl -s http://127.0.0.1:17317/api/tools/get_settings \
  -H "Authorization: Bearer local-demo-only-not-a-real-token" \
  -H "X-Subagent-Extension-For-Codex: 1" -H "Content-Type: application/json" \
  -d '{}'
```

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
UI needs no restart.

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

A contract can import types only from other contracts. A type from anywhere else
would generate a permissive `z.any()`, so the generator rejects it. Data built
from handwritten schemas belongs in handwritten Zod, as Claude task options do
in `src/shared/providers/claude/task-options.ts`. Do not feed Drizzle inferred
types into this generator.

## Build

`npm run build` regenerates validation schemas, cleans `dist/`, type checks the
service, and builds the service entrypoints and `dist/app.html`. Each build
rejects imports from the other runtime, development tooling and tests.

- The service bundle includes its runtime packages, so an extracted package runs
  without `node_modules`. It ships no Claude Code binary and launches the
  installed [Claude Code CLI](claude-cli.md).
- The entries `dist/main.js`, `dist/stdio.js` and `dist/projects-cli.js` print
  what to install when Node is older than `engines.node`.

`npm run package:plugin` builds and packs the plugin. The package holds only
what the installed plugin runs or shows: `dist/`, `migrations/`, `assets/`,
`skills/`, `plugin.json`, `mcp.json`, the README and `LICENSE`. Guides stay on
GitHub, so the README's links to `docs/` don't resolve inside an extracted
package.

`npm run release:assemble`, run after a build, writes `release/`, the package
the release publishes to npm. It holds the packed files, a manifest with no
scripts or dependencies, and an `.agents/plugins/marketplace.json` that lists
the plugin with source `./`. The directory is both a Codex marketplace and the
plugin. [Install a local build](#install-a-local-build) installs it, and
[Releasing and CI](releasing.md) publishes it.

Adding the checkout itself (`codex plugin marketplace add ./`) adds `main`'s
marketplace, which installs the version it lists from npm, so test local builds
with `./release`.

The assembled marketplace takes its name and display name from `main`'s. The
name `shemarlindie` is part of the plugin ID and its `PLUGIN_DATA` path, so it
must not change.

Two package suites in `npm test` cover the result:

- `tests/integration/package/packed-artifact.test.ts` checks startup,
  transports, CLI readiness and restarts from an extracted package outside the
  checkout. It fails if the package's top-level file list changes.
- `tests/integration/package/marketplace-install.test.ts` assembles a release
  from `dist/`, packs it with npm and installs the extracted package with the
  Codex CLI into a temporary `CODEX_HOME`. It runs the MCP command Codex reports
  against an isolated data directory and port. It checks the reported version,
  tool listing and calls, and service startup. It needs the Codex CLI
  (`CODEX_BIN` or `codex` on `PATH`) and skips without it.

To run the marketplace test alone after a build:

```sh
npx vitest run tests/integration/package/marketplace-install.test.ts
```

Set `MARKETPLACE_SOURCE` to a published marketplace, such as
`owner/repo@v1.2.3`, to install from it. Its version must match the checkout's
`package.json`. The release workflow does this after publishing.

### Install a local build

Run from the repo root (macOS or Linux):

```sh
npm run dev:plugin -- install
npm run dev:plugin -- update
npm run dev:plugin -- uninstall
```

Install and update build and assemble `./release` before replacing the plugin
and its `shemarlindie` marketplace. This also switches a published installation
to the local build. Uninstall is safe to repeat and keeps task data.

A terminal prompt offers to stop the running plugin service, defaulting to No.
Noninteractive runs leave it alone. Add `--stop-service` to any command to stop
without asking. This uses the
[service handoff](task-continuation.md#updates-and-service-handoff), so running
turns get up to 10 minutes to finish before the rest are interrupted.
Development services are left alone. A failed requested stop returns exit 1 even
if installation or removal succeeded.

Reopen the panel and restart Codex for the new proxy and skills. Same-version
backend changes take effect after the service exits and the next proxy call
starts it again. Close existing Codex connections after uninstalling.

The script honors `CODEX_BIN`, `CODEX_HOME` and the shell's
`SUBAGENT_EXTENSION_FOR_CODEX_DATA`. It ignores the checkout's `.env`.

## Checks

```sh
npx playwright install chromium
npm test
```

Install Chromium once after setup, and again when a Playwright upgrade needs it.

- `npm run typecheck` checks schema freshness and TypeScript across production,
  development and test code.
- `npm test` checks schema freshness, then runs formatting, lint, unused code
  and all three TypeScript projects alongside the build and tests. Every check
  and test must pass.
- `npm run check` runs the checks and build without tests. It checks schemas
  without rewriting them and builds fresh bundles without repeating type checks.

To isolate a failure, run `npm run schemas:check`, `npm run format:check`,
`npm run lint`, `npm run knip`, `npm run typecheck` or `npm run build` on its
own.

For focused checks during iteration:

| Command                      | Runs                                  |
| ---------------------------- | ------------------------------------- |
| `npm run test:e2e`           | Browser flows, after a build          |
| `npm run test:unit`          | Vitest `unit` and `unit-dom` projects |
| `npm run test:integration`   | Vitest `integration` project          |
| `npx vitest run <test-file>` | One test file                         |
| `npm run test:watch`         | Vitest in watch mode                  |

The Vitest commands skip the `npm test` preflight. Regenerate schemas after
contract edits, and build first when a test reads `dist/`.

Vitest keeps file isolation. The `unit-dom` project uses VM threads. Keep
process, SQLite and native-boundary tests in the Node projects because objects
returned by native APIs can cross VM realms.

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
tests that make model calls. Before changing performance behavior, compare
message latency and scheduler work with the timing records, transport
measurements and resource samples in
[Measure performance](logging.md#measure-performance).

### Choosing test coverage

Before adding a test, name the behavior it protects and inspect existing
coverage. Give each behavior one primary test layer, starting from the broadest
that can reliably exercise it. Go broader only when the behavior depends on what
that layer adds. Extend the test or suite that already owns it when possible.
These rules apply to tests added in the same change as well as existing ones.

Add tests or cases only when existing coverage does not adequately protect
changed behavior or a concrete, relevant failure.

| Layer             | Location                                                                       | Covers                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Browser flows     | `tests/e2e/*.spec.ts`                                                          | User flows through the built console against real HTTP, SSE, SQLite and temporary Git repositories, with the fixture worker |
| Integration tests | `*.integration.test.ts` beside the owning code, or `tests/integration/`        | Service, transport, process and Git boundaries that need direct control or the console cannot reach                         |
| Unit tests        | `*.test.ts` or `*.test.tsx` beside the module, and jsdom suites in `tests/ui/` | Complicated logic and cases broader tests cannot reliably exercise                                                          |

Feature integration tests that combine task control with real SQLite, Git or
worker execution sit beside their owning code. Cross-runtime, HTTP, MCP, package
and process suites go in `tests/integration/`. Both run in Vitest's
`integration` project, which `test:unit` excludes. Classify a test by its
fixtures and assertions. Real socket and child-process tests belong in
integration coverage even with fake services or executables. A temporary
directory alone does not make a test an integration test.

Process tests should launch built `dist/` service entrypoints unless the source
loader is itself under test. Keep real process, socket and Git boundaries when
optimizing these tests.

Add unit tests only for parser boundaries, permission rules, async races, stale
responses, Unicode handling, state reconciliation and similar rules that the
change can break. Use jsdom tests for deterministic failures, concurrent edits,
keyboard behavior and host bridge interactions that console browser tests cannot
reproduce.

Remove happy-path unit and mocked UI tests once a browser or integration test
owns the same behavior, including tests written to check work in progress. Trim
cases and assertions individually, preserving unique rules and edge cases. Name
retained tests for the behavior they protect.

Test behavior and documented contracts. Skip assertions that only copy constant
tables, property projections, CSS declarations, SVG artwork or placeholder
markup. Derive expected results independently of the production helper being
tested. Keep parameterized cases, including viewport and theme loops, only when
they protect distinct rules or boundaries. Leave framework and standard-library
behavior to their own tests. Use the smallest fixtures that cross the relevant
boundary, such as one row past a rendering block, unless the test checks scale
itself.

Keep fixture replay and preview simulation tests when production flows cannot
exercise their behavior.

Wait for readiness signals or explicit checkpoints instead of fixed sleeps. Use
worker checkpoints for queue and steer assertions, reserving elapsed-time waits
for timing behavior. Held checkpoints must remain interruptible during cleanup.
Paste incidental fixture text, and keep actual typing for keyboard behavior.
Mount the owning page for local form checks, and keep the full shell for
navigation, focus restoration and scope changes.

#### Test levels

Apply the [shared level rules](../AGENTS.md#test-and-documentation-levels) at
every level.

| Level | Scope                                                                                                            |
| ----- | ---------------------------------------------------------------------------------------------------------------- |
| 1     | Add no new tests or cases. Report material coverage gaps.                                                        |
| 2     | Cover the main changed or fixed behavior with the smallest useful test. Extend existing coverage where suitable. |
| 3     | Also cover concrete failure cases of the changed behavior.                                                       |
| 4     | Also cover distinct risks in directly affected behavior and boundaries.                                          |
| 5     | Broad coverage for complex or high-impact behavior, including recovery and compatibility where relevant.         |

### Browser flows

`npm run test:e2e` builds, then runs workers on half the CPU cores. Each test
starts a disposable service on an OS-assigned loopback port, with its own SQLite
database, settings, fixture worker and Git repository. Teardown closes the
service and removes its files even when the test fails. In a sandbox, allow
localhost TCP listeners and browser processes.

Wait for mutations to finish before reloading. A modal hiding background content
from role queries does not prove that the mutation succeeded.

Rerun against an existing build with `npx playwright test`. Failures keep traces
and screenshots in `test-results/`, which CI uploads when a Linux or macOS run
fails. A failed streamed reply flow in `chat-reading.spec.ts` also saves
`chat-scroll.json`, which logs Chat's scroll position, scroll button and rows
with each scroll event and reader input. Traces do not record scroll positions
after each change. Inspect a trace with `npx playwright show-trace <trace.zip>`.
Give concurrent Playwright commands distinct `--output` directories so one run
cannot delete another's results.

[Browser flows](../tests/e2e/README.md) describes how the flows set up state,
how to measure their performance and what they leave to other checks.

## Troubleshooting

| Symptom                                       | Cause and fix                                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| Dev host live mode logs 502                   | The service is not running, or not on the port Vite resolved at startup                |
| Dev host live mode logs 401                   | Vite and the service use different data directories, so the token does not match       |
| Codex shows different tasks than the dev host | Codex's `SUBAGENT_EXTENSION_FOR_CODEX_DATA` differs from `.env`                        |
| Service exits on start                        | Another service owns the data directory, or the port is taken, for example by the demo |
| Missing or stale generated schema             | Run `npm run schemas:generate`, then `npm run schemas:check`                           |
| No schema contracts found under `src`         | Run the command from the project root, and check that source files use `*-contract.ts` |
| Permissive validator rejected                 | Import the type from a discovered `*-contract.ts` file, or write the schema by hand    |
