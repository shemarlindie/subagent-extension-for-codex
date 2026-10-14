# Local development

How to run, change, and check this project locally. Run every command from the
project root. Requires Node.js 24+ and Git.

## Setup

```sh
npm ci
cp -n .env.example .env
```

`.env` is gitignored. `npm run dev`, `npm start`, `npm run projects`, and
`npm run dev:ui` load it when present; variables already set in the shell take
precedence. The stdio proxy reads the mention-test setting from `.env` and uses
its `CODEX_SUBAGENT_EXTENSION_DATA` only as a fallback destination for the test
search log. Service connection settings come from its MCP environment.
The example keeps data in `.codex-subagent-extension/live`. See the
[configuration table](configuration.md#environment-variables) for every variable.

**One data directory.** The service and panel dev host must use the same
`CODEX_SUBAGENT_EXTENSION_DATA`; it holds the database and admin token. Choose
[stdio or HTTP in the connection guide](../README.md#connect-codex). For stdio,
the Codex-launched proxy also needs that data directory and does not read `.env`,
so add the same path, made absolute, to its MCP environment:

```toml
[mcp_servers.codex_subagent_extension.env]
CODEX_SUBAGENT_EXTENSION_DATA = "<checkout-root>/.codex-subagent-extension/live"
```

For HTTP, configure the connection guide's URL and Authorization header using the
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
Remove the setting after testing; the sample does not prove a Claude provider
is available.

Projects need no startup registration. With **Automatically add chat projects** enabled (the default), a chat's project
is added when a task starts from that chat, and **Manage → Add project** or `npm run projects` covers the
rest (see [Multiple projects](configuration.md#repository-access)).

## Generated validation schemas

Choose the source of validation according to what the contract owns:

- Plain boundary data shapes use TypeScript contracts and generated Zod schemas.
  This covers settings documents, panel output,
  and Claude start/task options. Edit the feature-owned source types rather
  than the generated validators.
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
Contracts describe parsed output; defaults can make an input property optional
even when it is required in that output.

The runner discovers `src/**/*-contract.ts` automatically, excluding generated
files and `*-contract.test.ts`. No central registration is needed, and imports
between discovered contracts resolve to their generated validators.

To add a contract, put exported types in a feature-owned file such as
`src/service/features/<feature>/message-contract.ts`:

```ts
/** @strict */
export interface Message {
  body: string;
}
```

Run `npm run schemas:generate`. This creates the adjacent
`message-contract.generated.ts`, exporting `messageSchema`. Call the generated
validator at the boundary and use the source type for internal code:

```ts
import { messageSchema } from "./message-contract.generated.js";
import type { Message } from "./message-contract.js";

export function decodeMessage(input: unknown): Message {
  return messageSchema.parse(input);
}
```

Add focused tests beside the contract for accepted and rejected data and any
annotation behavior. Run `npm run typecheck`. Keep the source, generated file, and tests together
in any requested commit. See [Checks](#checks) for the build and watch workflows.

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
`permissionModeSchema`); a mapping can supply `getSchemaName` for another naming
convention. The runner rejects duplicate mappings, conflicts with generated
outputs, and permissive `z.any()` fallbacks; see [Troubleshooting](#troubleshooting).
Do not feed Drizzle inferred types into this generator.

For database rows, `createSelectSchema` from `drizzle-orm/zod` validates returned
rows at deserialization boundaries, including task and event rows. Use `createInsertSchema` when insert validation is needed; it allows fields
with database defaults to be omitted. These use the same Zod 4 runtime as the
generated protocol validators. JSON bodies are decoded and validated separately:
a task event's `data` column stores serialized JSON, so its table schema
validates the string, not the event data inside it. Schema generation does not
change database migrations.

## Run the service

Build before starting either service mode, including when testing in Codex over
HTTP or stdio:

| Use           | Command                        | Backend behavior                                                                                                       |
| ------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Development   | `npm run build && npm run dev` | Runs `src/service/main.ts` through `tsx` and Node's watch mode; restarts when an imported backend source file changes. |
| Built service | `npm run build && npm start`   | Runs `dist/main.js`; applying backend changes requires rebuilding and restarting.                                      |

Both modes serve the embedded Codex panel and standalone console from
`dist/app.html`. `npm run dev` does not rebuild the panel after UI edits;
follow [What reloads when](#what-reloads-when) to apply subsequent changes.
For browser UI development with Fast Refresh, use the [panel dev host](#panel-dev-host).

A restart interrupts active tasks; send a follow-up
after the service returns to continue them. Either way the service runs in the
foreground at `http://127.0.0.1:4317`; stop it with Ctrl-C. If Codex is open with
the plugin enabled, its stdio proxy may already have started one; a second service
cannot own the same data directory. On macOS and Linux, an interactive startup
reports process details and asks before sending SIGTERM to a verified service
owner. If it remains alive after five seconds, a second confirmation is required
before SIGKILL. Non-interactive launches and Windows do not stop processes here.

Check it from another terminal:

```sh
curl --fail http://127.0.0.1:4317/health
npm run projects -- list
```

The standalone console is at `http://127.0.0.1:4317`. Sign in with the contents
of `<data-directory>/admin-token`, for example
`pbcopy < .codex-subagent-extension/live/admin-token` on macOS.
Use the configured console origin: `localhost` and `127.0.0.1` are different
browser origins, and substituting `localhost` for the default address can fail
the service's origin checks.

## Choosing a development tool

| Command          | Use for                                                      | Worker                                                  |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| `npm run dev:ui` | UI development, prepared scenarios and host/layout controls. | Prepared fixtures, or a connected backend in live mode. |
| `npm run demo`   | Interactive service testing with disposable data.            | Fake worker; no model calls.                            |
| `npm run dev`    | Backend development and Claude execution.                    | Claude; model calls can incur costs.                    |

**Data: live** means a
backend connection; the connected service determines whether its worker is
fake or Claude. The [Demo](#demo) instructions show how to combine it with the
[panel dev host](#panel-dev-host). See [What reloads when](#what-reloads-when)
for applying source changes.

## Panel dev host

```sh
npm run dev:ui
```

This starts a Vite server at `http://127.0.0.1:5317` with React Fast Refresh and
CSS hot replacement, for development only; production HTML comes from
`scripts/build-panel.mjs`.

The page embeds the real panel in an iframe through the official `AppBridge`.
Use **Data: fixtures** for UI checks without a production service. Prepared
fixtures cannot start provider tasks; supported Chat interactions update
simulated fixture state. **Launch** chooses thread or global
scope; theme, display mode, width and host capabilities can be varied. The
**Inspector** exposes the bridge log, host settings and icon catalog. The dev
host does not send style variables by default. Leave **Host style variable
overrides** empty to omit them, or enter JSON to test specific values; see
[UI verification](ui-verification.md#measurement-and-checks-in-codex) for the
captured host styles and the limits of the dev host.

[UI verification](ui-verification.md) documents the browser workflow, fixture
catalogue and host controls. Fixtures in `dev/panel/scenarios/` are excluded from the
production bundle. Most calls use browser fixtures; Changes and worktree calls
in `FIXTURE_SERVICE_TOOLS` run real service code against disposable repositories
on Vite. Source edits rebuild these repositories on the next call, and the
bridge log identifies the source that served each call.

Live mode connects to the service's `/mcp` endpoint through the Vite proxy at
`/service`. The proxy adds the admin token server-side and drops the browser
`Origin` header, so the token never reaches the page. It finds the service much
as the stdio launcher does: `CODEX_SUBAGENT_EXTENSION_URL`,
`CODEX_SUBAGENT_EXTENSION_ORIGIN`, the data directory's `service.json`, then
port 4317. It ignores `PORT`, which in the dev host's process is its own port
(the `.claude/launch.json` launcher sets it). It reads the token from
`CODEX_SUBAGENT_EXTENSION_TOKEN` or the data directory's `admin-token`. Start
the service first, or restart Vite after it moves ports.

For Claude execution against throwaway data, give both processes the same data directory;
the dev host finds the service's port in its `service.json`:

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
dev UI or `http://<service-computer-LAN-IP>:4317` for the standalone console.
The service binds all IPv4 interfaces and prints its network URLs at startup.
The console still requires the admin token; LAN console origins use the service computer's interface
addresses discovered at startup. Restart after those addresses change.
Codex and the UI proxy continue connecting through loopback.

For dev UI live mode alone, only `dev:ui` needs `--host`; the service can stay
on loopback. The dev UI proxy adds the admin token automatically, so anyone
who can reach that UI can control the service in live mode. Use these flags
only on a trusted local network. They bind all interfaces; firewall rules
determine which computers can connect. Public and multi-user hosting are
outside this development option.

## Recorded fixtures

Besides the fixtures built with the typed builder in `dev/panel/scenarios/timeline.ts`,
the preview can show tasks recorded from real runs, in `dev/panel/recorded/`.
Scenario modules live in `dev/panel/scenarios/`; `fixtures.ts` assembles the
registry used by the dev host and replay tests.
Their SDK messages come from a real Claude run, so they show exactly what the
SDK sends, which built fixtures can only approximate.
`dev/panel/scenarios/preview-sdk-fixtures.test.ts` replays them through the provider
like the built ones.

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

Recording (`recordFixture` in `dev/panel/recording/recording.ts`) sanitizes the run so
the file can be committed:

- Paths (the repository, the workspace and the run's directory, the home and
  temporary directories), including Claude's dash-encoded project paths, become
  `/demo/...` paths. The host name, the task and session ids, and API request ids
  become fixture values.
- `system/init` messages lose your skills, plugins, MCP servers, commands and
  local paths, and rate-limit events keep only their status and window, not your
  usage or your organization's overage policy.
- Events are renumbered and moved to `--start`, keeping their spacing. Provider
  events get their presentation again from the sanitized SDK message.
- The task belongs to the preview owner, is renamed with `--title`, and has no
  workspace, so its Changes tab is empty.

It refuses to write a file that still contains your home directory, the
temporary directory, the host name or your user name, as they are or
dash-encoded. Replace anything else the run added, or what a refusal names, with
`--replace <from>=<to>` (repeatable). Read the file before committing it anyway:
a task's own content, such as its prompt or the files it read, is kept as it is.

Replacement values are literal text. Quote the whole argument when it contains
spaces or shell characters, for example `--replace 'internal-name=/demo/name'`.
Claude's encoded project paths get the corresponding dash-encoded replacement;
ordinary text keeps the replacement as written.

## Codex

After [building and starting the service](#run-the-service), follow the
[stdio or HTTP connection guide](../README.md#connect-codex), reload the MCP
connection in Codex and open
**Delegated Work** from a chat. It should show the same tasks as the dev host in
live mode.

## Demo

```sh
npm run demo
```

The script builds the project, registers a disposable repository at
`.codex-subagent-extension/demo-repository`, and starts the real service with
only the fixture worker. Its data directory is `.codex-subagent-extension/demo`;
it makes no model calls. Sign in at
`http://127.0.0.1:4317` with `local-demo-only-not-a-real-token`. Stop any other
service on port 4317 first.

To combine interactive fake-worker tasks with UI hot reload, run `npm run demo`
in one terminal, then start Vite in another with the demo connection:

```sh
CODEX_SUBAGENT_EXTENSION_DATA="$PWD/.codex-subagent-extension/demo" \
CODEX_SUBAGENT_EXTENSION_TOKEN=local-demo-only-not-a-real-token \
CODEX_SUBAGENT_EXTENSION_URL=http://127.0.0.1:4317 npm run dev:ui
```

Open `http://127.0.0.1:5317`, choose **Data: live** and **Launch: global**, and
**Relaunch**. Select the demo repository in New task. The panel sends actual
requests: create tasks, send follow-ups, answer questions and interrupt turns.
The explicit connection overrides keep Vite from using a different service
configured in `.env`.

For the full fixture trigger catalog, expected outcomes, queue controls, and
failure cases, see [Fixture scenarios](fixture-scenarios.md).

## What reloads when

| Change                               | To see it                                                               |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `src/panel/` in the dev host         | Nothing: Fast Refresh applies it                                        |
| `src/panel/` in Codex or the console | `npm run build`, then reopen the panel or reload the page               |
| `src/service/`                       | `npm run dev` restarts automatically; restart `npm start` after a build |
| `src/shared/`                        | Refresh the panel as above; `npm run dev` restarts automatically        |
| Tool metadata or panel resource URI  | Restart the service, then reload the MCP connection in Codex            |
| `.env` or `vite.config.ts`           | Restart the affected processes                                          |

The service reads panel HTML from `dist/` on each resource request, so rebuilt
UI needs no service restart.

## Build

`npm run build` regenerates validation schemas, cleans `dist/`, and type checks
the service with `tsc --noEmit`, then runs two builds that write into `dist/` without removing each other's
output:

- `scripts/build-service.mjs` bundles `src/service/main.ts`, `src/service/stdio.ts` and
  `src/service/projects-cli.ts` with esbuild into `dist/main.js`, `dist/stdio.js`,
  `dist/projects-cli.js` and shared `dist/chunks/`. Runtime packages, including the Claude
  Agent SDK, are bundled, so the package needs no `node_modules`. Node built-ins
  stay external; `supports-color` is an optional external probe whose absence
  falls back to the bundled dependency's default behavior. The build fails if code from `dev/`, `src/panel/`,
  `tests/` or a test file reaches the bundle, or if an unexpected package is left external. It writes the bundled packages' licenses to
  `dist/THIRD_PARTY_LICENSES.txt`.
- `scripts/build-panel.mjs` builds the panel into `dist/app.html`. It rejects
  service, development and test code in the production bundle.

The package includes the README, agent instructions, `docs/` and the feature-owned
file-preview README so local documentation links resolve after extraction. It
does not include service or panel source code.

The package ships no Claude Code binary. Every Claude launch, `npm run dev`
included, runs the installed CLI that `src/service/features/providers/claude/configuration/executable.ts`
finds and validates; see [Claude Code CLI](claude-cli.md).

The bundle ships source maps without embedded sources. `npm start`, `mcp.json`
and the launcher pass `--enable-source-maps`, so stack traces point to `src/`
files and lines.

`tests/integration/package/packed-artifact.test.ts` packs the current `dist/`,
extracts it outside the checkout and runs the projects CLI, the stdio proxy
with launcher auto-start, the panel, the packaged `.env` and a service restart
against the extracted copy. It also checks that the archive holds no native
binaries, drives Claude readiness with fake CLIs (at or above the minimum, too old,
a broken override and none on `PATH`) and, when the host has a supported CLI,
runs model discovery through it.

## Storage and Claude verification

- [Database and migrations](database.md) covers schema changes, transactions
  and event notifications.
- [Claude execution verification](claude-verification.md) covers CLI/SDK
  qualification and opt-in authenticated scenarios.

## Checks

```sh
npm run typecheck
npm test
```

`npm run typecheck` runs the read-only `schemas:check` before checking the service,
panel, shared modules, development tooling, tests, and Vite configs. `npm test` uses Vitest (`vitest.config.ts`); its
`pretest` checks schema freshness, formatting, linting and unused code, then
builds. Fix formatting with `npm run format`. The TypeScript configs enable
`noImplicitOverride` and `noImplicitReturns`, so overriding members are marked
`override` and functions that return a value on some paths return explicitly
on all of them.

They also enable `noUncheckedIndexedAccess`, so an array element or open-record
value read by index may be `undefined`. Handle that from the data's contract
rather than silencing it:

- Traverse arrays with `for…of` or `entries()`, or destructure and check the
  element once; a length check doesn't narrow `items[i]`.
- Type a fixed key set as an exhaustive `Record<Key, Value>`, and a lookup whose
  key may be absent as `Partial<Record<…>>` with a meaningful fallback.
- Give a collection that is never empty a tuple type such as
  `[Event, ...Event[]]`.
- Make parsers of Git or other external output throw on truncated or malformed
  input instead of producing empty paths or `NaN`.
- In tests, destructure and assert presence with `assert.ok(value)` or Vitest's
  `assert(value)`, which narrow the type; `expect(value).toBeDefined()` doesn't.

Use a non-null assertion only for a local invariant the compiler can't see, with
a comment when it isn't obvious.

ESLint (`eslint.config.js`) checks TypeScript
code quality and React hook rules; explicit `any` is allowed only in tests.
Type-aware rules read the three tsconfigs and catch unhandled or misused
promises, deprecated APIs, non-exhaustive `switch` statements over unions, and
values that would stringify as `[object Object]`. They also reject unnecessary
type assertions and, outside tests, conditions the types say can't vary. When a
check guards data the static type doesn't describe, such as host input, a
missing record key or a browser API absent in jsdom, make the type say so
(`Partial<Record>`, `.at()`, `unknown`) or test with `typeof` rather than
disabling the rule. Pass async event handlers
through `controller.run` or `controller.handle` so failures are reported, and
narrow untyped event data with `scalarText` from `src/shared/text.ts`. A full
`npm run lint` takes about 10 seconds.
It rejects nested ternaries, and in panel JSX it rejects inline handlers whose
`{ … }` body holds more than one expression, or any other statement such as
`if`; move those into a named function. Empty no-ops and one-expression bodies,
such as `(element) => { ref.current = element; }`, stay inline.
Statements that fit on one line, such as `if (!task) return;`, may omit braces;
a body on another line, or one spanning several lines, needs braces, and every
branch of an `if`/`else` follows the same choice.
It also checks Markdown with `@eslint/markdown`'s recommended rules, such as
invalid same-file heading fragments, code fences without a language and malformed
tables. It does not check that links to other files exist or that their heading
fragments resolve; check those after documentation moves.
The `project/source-boundaries` rule in `scripts/lint/source-boundaries.mjs`
resolves import targets before enforcing the runtime ownership described in
[Architecture](architecture.md#code-ownership). Service-owned panel integration
under `src/service/platform/panel/` remains service code. Run `npm run lint`
after moving modules to catch accidental imports across runtime boundaries.

TypeScript under `src/` and `dev/` uses max-lines (400 nonblank, noncomment lines)
and complexity (20) ceilings; tests and `*.generated.ts` files are exempt. These
rules act as a ratchet. Existing complexity findings are counted in
`eslint-suppressions.json`; normal lint rejects new findings. Lower or remove a
per-file line ceiling when refactoring, and do not raise one to make a change pass
without stating the review reason. Remove stale complexity exceptions with
`npx eslint . --prune-suppressions`.

`npm run knip` reports unused files, dependencies and exports. Its entry points
in `knip.json` are the build entries, the panel dev host's HTML entries, the
fixture service Vite loads by path, `scripts/` and schema-generation configs.
Remove an export nothing imports, or drop `export` when only its own module uses
it; add an entry when a file is loaded by path rather than imported.

Vitest has two projects. Unit tests time out after 15 seconds, and
`tests/integration` gets 60 seconds because those suites spawn processes and
worktrees. Keep a unit test under the shorter limit, and move a suite that
needs longer into `tests/integration`.

Put setup shared by colocated tests in a `<module>-test-harness.ts` file beside
the module. Lint, type checks and the panel build treat these files as test
code. For example, tests that drive a real panel `Controller` use `setup()`,
`FakeTransport` and the `task()` builder from
`src/panel/app/state/controller-test-harness.ts`.

Compare DOM nodes with Vitest's `expect`, not Node's `assert` equality methods.
A failed Node assertion can format jsdom's document graph, including for
identity and `null` checks, and block the worker until it is killed; a timeout
cannot interrupt it. `expect(node).toEqual(otherNode)` compares nodes with
`isEqualNode()`. Use `toBe` when identity matters and `toBeNull` for absence.

`npm run dev` regenerates schemas at startup. `npm run test:watch` reruns affected
tests on save without the preflight: run `npm run schemas:generate` after contract
edits, and build first when a test reads `dist/`.

UI checks are described in [UI verification](ui-verification.md). Opt-in tests
against real Claude make model calls; see
[Live Claude checks](claude-verification.md#live-claude-checks).

## Troubleshooting

| Symptom                                        | Cause                                                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Dev host live mode logs 502                    | The service is not running, or not on the port Vite resolved at startup                             |
| Dev host live mode logs 401                    | Vite and the service use different data directories, so the token does not match                    |
| Codex shows different tasks than the dev host  | Codex's `CODEX_SUBAGENT_EXTENSION_DATA` differs from `.env`                                         |
| Service exits on start                         | Another service owns the data directory, or the port is taken (for example, the demo)               |
| `npm test` fails before running tests          | Schema freshness, formatting, lint, or build preflight failed; run the checks individually          |
| Missing or stale generated schema              | Run `npm run schemas:generate`, then `npm run schemas:check`                                        |
| No schema contracts found under `src`          | Run the command from the project root; check that source files use `*-contract.ts`                  |
| Permissive validator rejected                  | Put imported types in a discovered `*-contract.ts` file, or add a feature-owned handwritten mapping |
| Duplicate mapping or generated-output conflict | Remove the duplicate mapping; discovered contracts already map to their generated validators        |
