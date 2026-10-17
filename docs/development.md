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
[stdio or HTTP in the connection guide](../README.md#connect-codex). For stdio,
the Codex-launched proxy needs that data directory in its MCP environment for
service discovery. Add the same path, made absolute:

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
UI needs no service restart.

## Build

`npm run build` regenerates validation schemas, cleans `dist/`, type checks the
service, and builds the service entrypoints and `dist/app.html`. Both builds
reject dependencies from the opposing runtime, development tooling and tests.

The service bundle includes its runtime packages and third-party license notices,
so the extracted package runs without a separate `node_modules` directory. It ships no Claude Code binary.
Launches use the installed [Claude Code CLI](claude-cli.md). Source maps omit
embedded sources and map stack traces to the original files.

`npm run package:plugin` builds and packs the plugin. The archive includes
migrations, assets, skills and documentation, but no service or panel source.
`tests/integration/package/packed-artifact.test.ts` verifies startup, transports,
CLI readiness and restart behavior from an extracted package outside the checkout.

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

`npm run typecheck` checks schema freshness and TypeScript across production,
development and test code. `npm test` runs Vitest after checking schema freshness,
formatting, lint and unused code, then building. To diagnose a preflight failure,
run `npm run schemas:check`, `npm run format:check`, `npm run lint`,
`npm run knip` or `npm run build` individually.

During iteration, run focused tests with `npx vitest run <test-file>`. Watch mode
(`npm run test:watch`) skips the preflight: regenerate schemas after contract
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

Unit tests have a 15-second timeout. Integration suites have 60 seconds for
process and worktree setup. Keep shared colocated test setup in a
`<module>-test-harness.ts` file. These harnesses are treated as test code by lint,
type checks and builds.

Compare DOM nodes with Vitest's `expect`, not Node's assertion equality methods:
formatting a failed Node assertion can hang on jsdom's document graph. Use `toBe`
for identity, `toEqual` for structural equality and `toBeNull` for absence.

Use [UI verification](ui-verification.md) for browser checks and
[Claude execution verification](claude-verification.md#live-claude-checks) for
opt-in tests that make model calls.

## Send latency measurements

The service writes structured `task.timing` debug records for repository
validation, message storage, scheduler scans and interrupt shutdown. The panel
writes transport durations to its browser console. Durations use a monotonic
clock and milliseconds. Records exclude message text and repository paths.
Transport duration includes service processing and bridge or HTTP overhead, so
compare it with service phases instead of adding it to them. Scheduler scans
report their work count so scan cost can be assessed before changing scheduling.
An unfinished shutdown has no completion duration until it settles.

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
