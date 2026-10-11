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

**One data directory.** The service, the panel dev host, and Codex must all use
the same `CODEX_SUBAGENT_EXTENSION_DATA`; it holds the database and the admin
token they authenticate with. The Codex-launched stdio proxy does not read
`.env`, so set the same path, made absolute, in Codex's MCP environment:

```toml
[mcp_servers.codex_subagent_extension]
command = "node"
args = ["<checkout-root>/dist/stdio.js"]

[mcp_servers.codex_subagent_extension.env]
CODEX_SUBAGENT_EXTENSION_DATA = "<checkout-root>/.codex-subagent-extension/live"
```

For composer mention diagnostics, add
`CODEX_SUBAGENT_EXTENSION_MENTION_TEST_MODE=1` to the project `.env`, then
reload the MCP connection. The stdio proxy reads this one setting and answers
mention search locally, so the backend service does not need a restart. Every
mention query returns a visibly labeled sample `Claude` result and is appended
to `<data-directory>/mention-search.jsonl`. The log contains the query,
timestamp, result names, and whether provider checks were skipped for the sample.
Remove the setting after testing; the sample does not prove a Claude provider
is available.

Projects need no startup registration. A chat's project is added when a task
starts from that chat, and **Manage → Add project** or `npm run projects` covers the
rest (see [Multiple projects](configuration.md#repository-access)).

## Generated validation schemas

Choose the source of validation according to what the contract owns:

- Plain boundary data shapes use TypeScript contracts and generated Zod schemas.
  This covers event subscription identity, settings documents, panel output,
  and Claude start/task options. Edit the feature-owned source types rather
  than the generated validators.
- Inputs with transformations, defaults, or substantial validation behavior use
  handwritten Zod and inferred TypeScript types. Task start, tool inputs,
  settings updates, stored task validation, and forms/SDK contracts keep this
  approach.
- Database row validators derive from Drizzle tables at deserialization
  boundaries. Internal types that need no runtime validation remain plain
  TypeScript.

JSDoc supplies rules that ordinary TypeScript types cannot express. For example,
the subscription contract uses `@strict` to reject extra properties,
`@format url` to validate URLs, and `@default {}` to fill in omitted filters.
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
rows at deserialization boundaries, including task event and webhook outbox
rows. Use `createInsertSchema` when insert validation is needed; it allows fields
with database defaults to be omitted. These use the same Zod 4 runtime as the
generated protocol validators. JSON bodies are decoded and validated separately:
an event subscription's `body` column stores serialized JSON, so its table schema
validates the string, not the subscription inside it. Schema generation does not
change database migrations.

## Run the service

```sh
npm run build && npm start
```

`npm start` runs the built `dist/main.js`; `npm run dev` runs
`src/service/main.ts` through `tsx` and Node's watch mode, restarting it when an
imported source file changes. A restart interrupts active tasks; send a follow-up
after the service returns to continue them. Either way the service runs in the
foreground at `http://127.0.0.1:4317`; stop it with Ctrl-C. If Codex is open with
the plugin enabled, its stdio proxy may already have started one; a second service
cannot own the same data directory. On macOS and Linux, an interactive startup
reports process details and asks before sending SIGTERM to a verified service
owner. If it remains alive after five seconds, a second confirmation is required
before SIGKILL. Non-interactive launches and Windows do not stop processes here.
A service started before identity metadata was added must also be stopped manually.

Check it from another terminal:

```sh
curl --fail http://127.0.0.1:4317/health
npm run projects -- list
```

The standalone console is at `http://127.0.0.1:4317`. Sign in with the contents
of `<data-directory>/admin-token`, for example
`pbcopy < .codex-subagent-extension/live/admin-token` on macOS.

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
Use **Data: fixtures** for UI checks without a service; prepared fixtures cannot
create tasks or send Chat messages. **Launch** chooses thread or global
scope; theme, display mode, width and host capabilities can be varied. The
**Inspector** exposes the bridge log, host settings and icon catalog.

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

Codex's iframe sandbox, CSP, real host styles, and native placement are not
reproduced, so confirm layout-sensitive changes in Codex before release.

### Access from your local network

Pass `--host` to either command to listen on network interfaces. Without it,
both commands keep their existing loopback listeners:

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
  workspace, so its Changes tab is empty. A record from before the current task
  shape (strings for messages, `attempt` for `turn`) gets the current fields.

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

With the MCP configuration above, reload the MCP connection in Codex and open
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

The fixture worker (`dev/service/fixture-provider.ts`) and demo entry
(`dev/service/demo-service.ts`, run through `tsx`) are in `dev/`, excluded from
production bundles and the distributed package. Tests also import the fixture worker.
It streams its reply in small pieces before storing it.
Markers in a turn's prompt shape the turn: `[input]` asks a question, `[fail]`
fails, `[slow]` runs several steps that each take pending steers, as at a tool
boundary, and `[late]` takes none, so they're left for the next turn.

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
  `dist/projects-cli.js` and shared `dist/chunks/`. Every package, the Claude
  Agent SDK included, is bundled; only Node built-ins stay external, so the
  package needs no `node_modules`. The build fails if code from `dev/`, `src/panel/`,
  `tests/` or a test file reaches the bundle, or if anything else is left
  external. It writes the bundled packages' licenses to
  `dist/THIRD_PARTY_LICENSES.txt`.
- `scripts/build-panel.mjs` builds the panel into `dist/app.html`. It rejects
  service, development and test code in the production bundle.

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

## Database

The service and the projects CLI share `<data directory>/console.sqlite`.
`openDatabase` in `src/service/platform/database/database.ts` opens it, sets WAL,
foreign keys and a 5-second busy timeout, and applies pending migrations
before any feature reads it.

- Each feature declares its tables with Drizzle in its own `schema.ts`;
  `src/service/platform/database/schema.ts` collects them for drizzle-kit.
- Each feature queries only its own tables, through the shared `Database`:
  tasks and events in `tasks/store.ts`, form requests in
  `tasks/form-requests.ts`, webhooks in `events/storage.ts`, and settings and
  project roots in their services. Other features read tasks and events
  through `Store`. Queries use Drizzle; raw SQL is kept where it is clearer,
  such as the JSON predicates in `Store.chatEvents`.
- JSON columns are checked when read (`decodeStored` in
  `src/service/platform/database/decode.ts`, with each feature's schema). A malformed
  record fails with an error naming it, and is never dropped or given
  defaults. The schemas check the fields ownership and control flow rely on
  and pass the rest, such as provider state and event data, through
  unchanged.
- Drizzle query failures throw SQLite's own error (such as
  `FOREIGN KEY constraint failed`), not Drizzle's wrapper, whose message
  holds the SQL and its parameters.
- After changing a schema, run `npm run db:generate -- --name <change>` and
  commit the new folder under `migrations/`. Review the SQL: SQLite rebuilds a
  table for many column changes, and data backfills need a custom migration
  (`npx drizzle-kit generate --custom --name <change>`). Never edit a
  migration once it is committed.
- `src/service/platform/database/migrate.ts` applies migrations in one
  `BEGIN IMMEDIATE` transaction and records them in Drizzle's
  `__drizzle_migrations` ledger, so a service and a CLI starting together
  migrate once. It refuses a database whose ledger names a migration this
  build lacks.
- Databases from before versioned migrations are not upgraded: startup
  refuses them and asks for the data directory to be deleted. In a checkout,
  `npm run db:migrate-legacy -- [--dry-run] [<data directory>]` converts one
  instead (`dev/database/migrate-legacy-database.ts`). Stop the service first. It
  copies every record into a new database, keeping event ids and filling in
  the task references,
  checks each record as the service would, and keeps the old file as
  `console.sqlite.pre-migration`. Forms and webhook deliveries whose task is
  gone, and the retired `artifacts` and `codex_executors` tables, are dropped
  and reported. Worktrees and keys are untouched.
- `migrations/` ships in the package and is read with `packagePath`, so
  source checkouts and installed packages use the same folder.

Write a task change and the events that record it in one
`store.transaction(() => …)`, so they commit together. Transactions are
synchronous and don't nest: run Git, provider and network work before
opening one, and call helpers that write events inside it rather than opening
another.

Event listeners on `store.bus` hear an event only after its transaction
commits, in order, and never one that rolled back. A notification is a hint
that rows exist: a listener that throws is logged without affecting the
commit or other listeners, and consumers recover what they miss from the
database (webhook capture from its checkpoint, long polls by re-reading, SSE
clients through `Last-Event-ID`).

### Qualifying Claude Code versions

`claudeCliSupport` in `src/service/features/providers/claude/configuration/executable.ts` holds the
minimum version beside the Agent SDK version it was qualified with. Newer
CLI releases are accepted without an upper bound. A test fails when the installed
SDK no longer matches that version, so an SDK update requires compatibility
checks. Run these checks when updating the SDK or changing the minimum:

1. Run `npm test`. Recorded fixtures cover the SDK message mapping, and the
   packed-artifact suite runs model discovery through the host's CLI.
2. Run the [live Claude checks](#live-claude-checks) with that
   version selected (through `PATH` or `CODEX_SUBAGENT_EXTENSION_CLAUDE_PATH`).
   They cover reads, resume, the sandbox, MCP, budgets and CLI parity
   (project settings, hooks, skills and MCP servers).
3. In a live task from the panel, steer, interrupt and answer a question.

Keep the minimum at or below the SDK's paired version (`claudeCodeVersion` in its
`package.json`). Check the current stable and latest releases
(`npm view @anthropic-ai/claude-code dist-tags`) when qualifying compatibility.

## Live Claude checks

These checks make authenticated model calls and require configured Claude Code
credentials. Build first: the script runs service source through `tsx`, while
the `mcp` scenario also reads `dist/stdio.js` and `dist/app.html`. Explicitly opt
in for each scenario:

```sh
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 npx tsx scripts/verify-live-claude.mjs read
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 npx tsx scripts/verify-live-claude.mjs resume
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 npx tsx scripts/verify-live-claude.mjs sandbox
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 npx tsx scripts/verify-live-claude.mjs mcp
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 npx tsx scripts/verify-live-claude.mjs budget
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 npx tsx scripts/verify-live-claude.mjs parity
```

Each uses a temporary Git fixture and a native cost limit of $0.25, or $0.50 for
parity. The budget scenario sets $0.001 and expects budget failure. Claude checks
cost after a response, so it can exceed the configured amount; this is not a
hard billing cap. These checks are excluded from the ordinary test suite.

The sandbox scenario enables the extension sandbox, approves only its five
exact fixture commands, denies unexpected permissions and uses a local listener.
Parity uses default settings and project-local skill, `.mcp.json` stdio server
and `PreToolUse` hook fixtures; it approves only fixture tools and checks a
subagent run. Select a CLI with `PATH` or
`CODEX_SUBAGENT_EXTENSION_CLAUDE_PATH` when qualifying versions.

## Checks

```sh
npm run typecheck
npm test
```

`npm run typecheck` runs the read-only `schemas:check` before checking the service,
panel, shared modules, development tooling, tests, and Vite configs. `npm test` uses Vitest (`vitest.config.ts`); its
`pretest` checks schema freshness, formatting, and linting, then builds. Fix
formatting with `npm run format`. ESLint (`eslint.config.js`) checks TypeScript
code quality and React hook rules; explicit `any` is allowed only in tests.
It also checks Markdown with `@eslint/markdown`'s recommended rules, such as
missing link fragments, code fences without a language and malformed tables.
The `project/source-boundaries` rule in `scripts/lint/source-boundaries.mjs`
resolves import targets before enforcing the runtime ownership described in
[Architecture](architecture.md#code-ownership). Service-owned panel integration
under `src/service/platform/panel/` remains service code. Run `npm run lint`
after moving modules to catch accidental imports across runtime boundaries.

Vitest has two projects. Unit tests time out after 15 seconds, and
`tests/integration` gets 60 seconds because those suites spawn processes and
worktrees. Keep a unit test under the shorter limit, and move a suite that
needs longer into `tests/integration`.

Compare DOM nodes with Vitest's `expect`, not Node's `assert` equality methods.
A failed Node assertion can format jsdom's document graph, including for
identity and `null` checks, and block the worker until it is killed; a timeout
cannot interrupt it. `expect(node).toEqual(otherNode)` compares nodes with
`isEqualNode()`. Use `toBe` when identity matters and `toBeNull` for absence.

`npm run dev` regenerates schemas at startup. `npm run test:watch` reruns affected
tests on save without the preflight: run `npm run schemas:generate` after contract
edits, and build first when a test reads `dist/`.

For scope and remaining gaps, see [Implementation status](implementation-status.md).
UI checks are described in [React UI architecture](react-ui.md#build-and-verification). Opt-in tests
against real Claude make model calls; see
[Live Claude checks](#live-claude-checks).

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
