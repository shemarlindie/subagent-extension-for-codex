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
[configuration table](../README.md#configuration) for every variable.

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
starts from that chat, and **Add project** or `npm run projects` covers the
rest (see [Multiple projects](../README.md#multiple-projects-and-packaged-startup)).

## Run the service

```sh
npm run build && npm start
```

`npm start` runs the built `dist/main.js`; `npm run dev` runs `src/main.ts`
directly with `tsx`. Either way the service runs in the foreground at
`http://127.0.0.1:4317`; stop it with Ctrl-C. If Codex is open with the plugin
enabled, its stdio proxy may already have started one; a second service cannot
own the same data directory.

Check it from another terminal:

```sh
curl --fail http://127.0.0.1:4317/health
npm run projects -- list
```

The standalone console is at `http://127.0.0.1:4317`. Sign in with the contents
of `<data-directory>/admin-token`, for example
`pbcopy < .codex-subagent-extension/live/admin-token` on macOS.

## Panel dev host

```sh
npm run dev:ui
```

This starts a Vite server at `http://127.0.0.1:5317` with React Fast Refresh and
CSS hot replacement, for development only; production HTML comes from
`scripts/build-ui.mjs`.

The page is a mock MCP Apps host (`ui/dev/host.tsx`, mounted by `main.tsx`;
its pure helpers are in `host-helpers.ts` and tested in
`tests/integration/development/dev-host.test.ts`). It embeds the panel in an
iframe through the official `AppBridge`, so the panel runs its real
`HostTransport`, as it does in Codex. Like Codex, the host calls the launch tool
and delivers its result to the panel. The toolbar controls:

- **Data**: fixture results (`ui/dev/preview/tools.ts`, development
  only; never in the production bundle) or the live service. Fixtures need no
  service; unsupported operations fail explicitly. Tools listed in
  `FIXTURE_SERVICE_TOOLS` (`host-helpers.ts`) are the exception: the Vite
  server answers them with the real service code (`ui/dev/fixture-service.ts`,
  a `Store` in a temporary SQLite file seeded with the fixture tasks), for
  behavior the browser fixtures cannot fake. They are the Changes tab's tools:
  changes, changed files and worktree actions. Tasks with a change fixture
  (`ui/dev/preview/change-fixtures.ts`) get a real Git repository each, with a
  base commit and then each turn's edits, so their diffs come from Git. Edits
  to `src/` rebuild that store, and its repositories, on the next call. The **Bridge log** marks each
  call `served` by `fixture service`, `browser fixtures` or `service`.
- **Launch**: thread (`open_codex_subagent_extension` with Codex's `threadId`
  and `codex/sandbox-state-meta` request metadata) or global. With fixtures,
  `ui/dev/preview/tools.ts` resolves the thread's scope the way the service does.
- **Thread** (thread launches only): the threads that have tasks, from the
  fixtures or the live service.
- **Theme**, **Display** (inline or fullscreen; the panel's **Open panel** and
  **Collapse** requests switch it), and **Width**.
- **Send messages** and **Update context** host capabilities.
- **Inspector**: the toolbar button opens a right-side pane with **Bridge log**,
  **Host settings**, and **Icon catalog** tabs. Host settings include **Thread
  ID** (accepts any ID), **Sandbox cwd** (the chat's directory, sent as a
  `file://` URI; a typed path is converted), auto-adding chat projects, and
  resetting fixture projects, plus optional host style variables as JSON. An
  unregistered directory shows **Add chat project**. Fixture registrations
  persist across relaunches and reloads until reset; starting a task
  fails. The icon catalog lists every panel glyph.

Changing data, launch, capabilities, or host metadata starts a new panel
session; theme, display mode, width, and styles are pushed as host context
changes. The bridge log records tool calls, messages, model context updates,
and display-mode requests, including entries recorded while the inspector is
closed. Open **Inspector** and select **Bridge log** to view them.

The mock host mirrors the panel's project, task or task-list selection, tab,
search, and status filter into the outer page URL. Open dialogs add a boolean
`dw_dlg_<name>=1` URL flag; action dialogs use distinct names, such as `steer`
and `retry`. Ordered dialog references and form drafts stay in local storage.
Reloading the dev host then restores the panel view and any saved dialogs. Host
toolbar settings continue to use local storage.

Live mode connects to the service's `/mcp` endpoint through the Vite proxy at
`/service`. The proxy adds the admin token server-side and drops the browser
`Origin` header, so the token never reaches the page. It finds the service the
same way the stdio launcher does: `CODEX_SUBAGENT_EXTENSION_URL`,
`CODEX_SUBAGENT_EXTENSION_ORIGIN`, the data directory's `service.json`, then
`PORT` (default 4317). It reads the token from `CODEX_SUBAGENT_EXTENSION_TOKEN`
or the data directory's `admin-token`. Start the service first, or restart Vite
after it moves ports.

Live mode performs real actions: starting a task from the panel runs a worker.
To work against throwaway data, give both processes the same overrides:

```sh
CODEX_SUBAGENT_EXTENSION_DATA=/tmp/panel-dev PORT=4399 npm run dev
CODEX_SUBAGENT_EXTENSION_DATA=/tmp/panel-dev PORT=4399 npm run dev:ui
```

Codex's iframe sandbox, CSP, real host styles, and native placement are not
reproduced, so confirm layout-sensitive changes in Codex before release.

## Codex

With the MCP configuration above, reload the MCP connection in Codex and open
**Delegated Work** from a chat. It should show the same tasks as the dev host in
live mode.

## Demo

```sh
npm run demo
```

The development service runs a fixture worker with a disposable sample
repository in `.codex-subagent-extension/demo`; it makes no model calls. Sign in at
`http://127.0.0.1:4317` with `local-demo-only-not-a-real-token`. Stop any other
service on port 4317 first.

The fixture worker (`dev/fixture-provider.ts`) and demo entry
(`dev/demo-service.ts`, run through `tsx`) are in `dev/`, outside the `src/`
build. The package contains neither. Tests import the fixture worker from
`dev/`. The packaged service supports the `claude` and `codex` providers.

## What reloads when

| Change                              | To see it                                                         |
| ----------------------------------- | ----------------------------------------------------------------- |
| `ui/` in the dev host               | Nothing: Fast Refresh applies it                                  |
| `ui/` in Codex or the console       | `npm run build`, then reopen the panel or reload the page         |
| `src/`                              | Restart the service (`npm start` after a build, or `npm run dev`) |
| Tool metadata or panel resource URI | Restart the service, then reload the MCP connection in Codex      |
| `.env` or `vite.config.ts`          | Restart the affected processes                                    |

The service reads panel HTML from `dist/` on each resource request, so rebuilt
UI needs no service restart.

## Checks

```sh
npm run typecheck
npm test
```

Tests run with Vitest (`vitest.config.ts`). `npm test` runs `npm run format:check`, `npm run lint`, and the build first through `pretest`; `npm run test:watch` reruns affected tests on save without those steps, so run `npm run build` first when a test reads `dist/`.
Fix formatting failures with `npm run format`. Linting (`eslint.config.js`) checks code quality only: TypeScript recommended rules, React hook rules in `ui/`, and permits explicit `any` only in test files. `npm run typecheck` also covers the tests and Vite configs. The suite is described in the
[README](../README.md#verification-and-remaining-plan) and
[React UI architecture](react-ui.md#build-and-verification). Opt-in checks
against real Claude make model calls; see
[Live Claude checks](../README.md#live-claude-checks).

## Troubleshooting

| Symptom                                       | Cause                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| Dev host live mode logs 502                   | The service is not running, or not on the port Vite resolved at startup               |
| Dev host live mode logs 401                   | Vite and the service use different data directories, so the token does not match      |
| Codex shows different tasks than the dev host | Codex's `CODEX_SUBAGENT_EXTENSION_DATA` differs from `.env`                           |
| Service exits on start                        | Another service owns the data directory, or the port is taken (for example, the demo) |
| `npm test` fails before running tests         | Formatting (`npm run format`) or lint (`npm run lint`)                                |
