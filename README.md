# Codex subagent extension

A local MVP for Codex to delegate Claude coding tasks through MCP. Claude executes through the Claude Agent SDK and native Claude Code harness. One service owns the durable task database and creates worktrees for isolated tasks; MCP clients never become workers.

For local setup and task continuation, see the [Setup and task continuation guide](docs/setup-and-resume.md).

## Try the console

Requires Node.js 24+ and Git.

```sh
npm ci
npm run demo
```

Open http://127.0.0.1:4317 and enter `local-demo-only-not-a-real-token`. `npm run demo` starts a development-only service with a fixture worker and a disposable sample repository. It makes **no model calls**. The demo entry is `dev/demo-service.ts`; the fixture worker is in `dev/` and is excluded from the package. Add `[input]` to a fixture task to exercise human input, `[slow]` to give it time to take steers, or `[late]` to leave steers for the next turn. Fixture replies stream in and identify themselves as fixtures.

## Run real Claude tasks

Claude tasks run through the Claude Agent SDK and use whatever Claude Code credentials are configured on the service host. This project does not provide, request, or manage Claude credentials; Claude Code resolves them using its own [authentication precedence](https://code.claude.com/docs/en/authentication#authentication-precedence). Delegated tasks load user, project and local Claude Code settings the same way the CLI does, including `CLAUDE.md` files, rules, skills, hooks, and permission rules; settings-file permission rules can approve tool calls before the extension's approval routing is consulted. MCP servers and claude.ai connectors available to Claude Code are loaded too. By default a delegated task behaves like your own `claude` CLI session in the same repository: it gets every Claude Code tool, including subagents, and your settings decide the permission mode and Bash sandbox. Any tool call that Claude Code would prompt you for goes to the task's approver instead. Do not put provider credentials in MCP arguments, browser code, or this repository. The Claude harness inherits the service environment except the extension's own variables (`CODEX_SUBAGENT_EXTENSION_*`), OpenAI credentials (`OPENAI_*`) and `CLAUDE_CODE_OAUTH_TOKEN`. `env` values in Claude Code settings files also apply. See [Claude session restrictions](#claude-session-restrictions) to restrict tasks further.

```sh
npm run build
npm start
```

Run the command from the project root. Settings come from the shell or an optional `.env`; see [Local development](docs/development.md). Add target repositories with **Add project**, or let a chat's project be added when a task starts from it. A target must be a Git repository root with at least one commit. Use a committed repository or the disposable demo fixture. By default, a task runs directly in the approved repository with `workspace_strategy: "current_repo"` and `revision: "HEAD"`, including staged, unstaged, and untracked files. Set `workspace_strategy: "worktree"` to start from a specified **committed revision** in a worktree on its own branch, `<worktree_branch_prefix><task-id>` (`agent/<task-id>` by default); the service never automatically merges worktree changes. Push the branch to take the work elsewhere. The browser and host delegation forms offer the same Workspace choice. Review profiles remain read-only; write profiles edit the current checkout directly, so preserve unrelated user changes. Choose a worktree for isolated or parallel edits. Current-repo tasks receive a starting diff for review that includes pre-existing changes. The panel's Changes tab shows a task's uncommitted changes, and `get_agent_changes` everything it changed, live from Git; see [the panel guide](docs/codex-panel.md#changes-tab). The checkout stays live during execution, so edits by another task or by the user to the files a task changed can also appear in its changes.

Stop the demo service before starting Claude on the same port.

### Claude Code CLI

Claude tasks need a supported Claude Code CLI, 2.1.286–2.1.295, on the service host; [install it](https://code.claude.com/docs/en/setup) if you haven't. The service runs the first `claude` on its own `PATH`, or the absolute path in `CODEX_SUBAGENT_EXTENSION_CLAUDE_PATH`. Without a supported CLI, Claude tasks can't start but the rest of the service works. See [Claude Code CLI](docs/claude-cli.md) for release channels, how the executable is chosen and checked, and what each readiness message means.

### Admin token

The service listens only on loopback, but loopback is not private: other local processes and users can connect to the port, and any web page open in your browser can send it requests. Because the API starts workers that edit repositories and run commands, every API request must present a secret that only your account can read.

On first start, the service generates a random token and writes it to `<data-directory>/admin-token` with owner-only permissions. Each start re-applies owner-only permissions to that file and the data directory. `CODEX_SUBAGENT_EXTENSION_TOKEN` overrides it and must be at least 32 characters. The token persists across restarts, so MCP configuration keeps working. It is used in three places:

- **Console login.** Sign in once with the token; the browser receives an HttpOnly session cookie valid for one hour and keeps only that cookie, not the token. Restarting the service invalidates browser sessions; data and worktrees persist.
- **Stdio MCP proxy.** `dist/stdio.js` reads the file and adds the token to each forwarded request, so the MCP client never handles it.
- **Panel dev host.** The Vite proxy adds the token server-side; see [Local development](docs/development.md#panel-dev-host).

Treat the token as a credential: do not paste it into a chat or commit it.

## Connect Codex

The packaged stdio launcher connects to or starts the local service when enabled. Configure a stdio MCP server with paths to `dist/stdio.js` and the service's data directory. Replace `<checkout-root>` in this example with the full path to your local checkout; the MCP client may start with a different working directory:

```toml
[mcp_servers.codex_subagent_extension]
command = "node"
args = ["<checkout-root>/dist/stdio.js"]
```

The proxy and service share the per-user data default. If you set `CODEX_SUBAGENT_EXTENSION_DATA` for the service, set the same absolute value in `[mcp_servers.codex_subagent_extension.env]`.

The proxy forwards requests to the running service using its [admin token](#admin-token); it does not create another scheduler. `CODEX_SUBAGENT_EXTENSION_URL` changes its loopback URL. The portable plugin manifest, MCP configuration, and delegation skill are also included; build the package before configuring it. The service starts when the host launches the packaged stdio server; installation alone does not execute it.

For MCP App hosts, connect to the authenticated HTTP endpoint `/mcp`. Delegated Work uses the MCP resource `ui://codex-subagent-extension/app-v6` over the authenticated MCP bridge, with empty network allowlists. The standalone web console exposes its task routes over HTTP. The app uses portable MCP Apps calls; Codex-specific sidebar behavior depends on host support.

The standalone web console uses [token login](#admin-token), HTTP tools and live SSE. The stdio proxy provides tools and the separate `app-v6` Delegated Work app through the portable MCP Apps bridge. HTTP and stdio share the app's schemas, resources, and separate global/thread openers. Panel HTML is read from `dist` on each resource request, so rebuilt UI changes can appear without a service restart. Server code changes require a service restart; reload the MCP connection to discover changed opener metadata and resource URIs. The host controls app placement. Both transports expose the same task tools. Installing the plugin does not register a remote ChatGPT connection or deploy a production service.

## Supported workflows

- Durable asynchronous tasks, concurrent branches, explicit dependencies, and conversation filtering.
- Researcher, reviewer, and security reviewer profiles inspect only by default: `plan` mode, a read-only tool set and the workspace path guard. Settings can loosen them. Implementer, debugger, test engineer, and refactorer profiles can write. Claude uses the Agent SDK’s native permission modes and requests a decision when its native checks leave an action unresolved.
- Each task is a conversation. A completed, failed or interrupted task takes a follow-up message, which starts its next turn in the same task. While a turn runs, a message can steer it (delivered at the next tool boundary, without interrupting it), be queued for a turn of its own, or interrupt it and start the next turn at once, as in Codex. Pending steers and the queue are shown and editable; a plain interrupt pauses the queue. Only deleting a task ends it.
- Questions and permission requests carry unique request IDs. Stale or duplicate answers are rejected.
- A plain reply ends each successful turn and streams in as it's written. The parent agent reads replies with `get_agent_messages`, a long poll, and each turn's changes with `get_agent_changes(scope: "turn")`. Ordered execution events and Git-generated patches, including committed and untracked changes, remain available.
- Session ID, state location, and worker affinity. A later turn resumes the session when its original worker and transcript are available; otherwise it starts a new session in the same task, carrying the conversation. A removed worktree is recreated from the task's branch. This is session continuation, not instruction-pointer pause/resume.
- Runtime and cost limits across a task's turns, and SDK-native per-turn cost ceilings reduced by observed prior cost. A follow-up can raise either limit, so a turn stopped by its budget can carry on. An interrupted turn's cost is counted only when a later turn resumes its session; this is not a billing guarantee. Token limits are unsupported. Claude tasks can start native subagents unless `claude_subagents` is off.
- Authenticated SSE replay and short-lived browser sessions; all task mutations go through the same tool dispatch as MCP.

The task header's handoff button offers **Copy for Codex** in the standalone console and **Bring to Codex** when embedded. Review or edit the message before submitting. It includes the task identity, short excerpts of the request and the latest reply, and references to `get_agent_messages` and `get_agent_changes` for the full conversation and changes; it does not apply patches. Embedded message delivery depends on host support and is unverified in a registered host.

Worker links such as `/workers/claude.reviewer` show that profile's available capabilities and tasks. Use the sidebar worker picker or **Delegate to this worker** to select a profile for a new task.

A worktree provides code separation, not operating-system containment. With default settings, a Claude task in the `current_repo` workspace can do anything your Claude Code CLI can. The safety net is approval routing plus your Claude Code permission rules and sandbox settings. With `default_approval_decider: parent_agent`, the parent agent answers those prompts, so consider enabling restrictions first. Committed `.claude/settings.json` files in a delegated repository apply just as they do in the CLI, including hooks, permission rules, MCP servers and sandbox exclusions. Enable the extension sandbox and other restrictions under [Claude session restrictions](#claude-session-restrictions) when you need them. The model/API harness is always outside the Bash sandbox. The extension sandbox's Bash enforcement has been verified against disposable fixture writes, Git metadata, a symlink escape and a loopback listener; full-harness containment remains unverified. The service is a single-user, loopback-only application with ownership checks in the control plane. Remote multi-user OAuth, container/network policies, and public hosting require separate deployment work. Do not expose this service directly to the public Internet.

## Configuration

| Variable                                     | Default                                   | Meaning                                                                                                                                          |
| -------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CODEX_SUBAGENT_EXTENSION_DATA`              | `~/.local/share/codex-subagent-extension` | Persistent SQLite database, approved roots, worktrees, lock and token; explicit relative overrides resolve from invocation cwd                   |
| `CODEX_SUBAGENT_EXTENSION_ALLOWED_ROOTS`     | `[]`                                      | JSON array of explicitly approved parent directory paths                                                                                         |
| `CODEX_SUBAGENT_EXTENSION_URL`               | discovered local service or port 4317     | Proxy endpoint override; explicit URLs require an already running service                                                                        |
| `CODEX_SUBAGENT_EXTENSION_CONCURRENCY`       | `3`                                       | Maximum concurrently active tasks (1–20)                                                                                                         |
| `CODEX_SUBAGENT_EXTENSION_TOKEN`             | generated locally                         | Server-side token override; at least 32 characters                                                                                               |
| `CODEX_SUBAGENT_EXTENSION_CLAUDE_PATH`       | first `claude` on the service's `PATH`    | Absolute path to the Claude Code executable to run; a path that fails validation is an error, not a fallback to `PATH`                           |
| `PORT`                                       | `4317`                                    | Loopback listener port                                                                                                                           |
| `CODEX_SUBAGENT_EXTENSION_ORIGIN`            | `http://127.0.0.1:4317`                   | Standalone service origin and CORS allowlist                                                                                                     |
| `CODEX_SUBAGENT_EXTENSION_MENTION_TEST_MODE` | disabled                                  | Set to `1` in the local `.env` to return a sample Claude mention and log searches to `<data-directory>/mention-search.jsonl`; local testing only |

Review a worktree task's changes in the Changes tab, or on its branch, before applying them; its worktree is `<data-directory>/worktrees/<task-id>`. The Changes tab can remove the worktree (keeping the branch) and then delete the branch. Current-repo tasks use the approved repository itself, and any worker edits are already present there. Removing a worktree doesn't end the task: its next message recreates the worktree from the branch. Preserve Claude's local runtime state for resumable sessions. One service may own a data directory at a time.

## Project layout

| Path                                                 | Contents                                                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`, `src/stdio.ts`, `src/projects-cli.ts` | Entry points: HTTP service, stdio MCP proxy, and project registration CLI.                                      |
| `src/features/`                                      | Task lifecycle and policy, projects, settings, workspaces, events, and provider integrations.                   |
| `src/platform/`                                      | HTTP server, MCP panel context, service lifecycle, authentication, and host adapters.                           |
| `src/shared/`                                        | Cross-feature contracts, common errors, and shared time helpers.                                                |
| `dev/`                                               | Development-only fixture worker and demo service entry; excluded from the packaged service.                     |
| `ui/app/`                                            | UI entry points, environment detection, shell, and HTML template.                                               |
| `ui/features/`, `ui/shared/`                         | Feature-first React modules and reusable state, components, dialogs, forms, and utilities.                      |
| `ui/adapters/transports/`                            | Console and MCP host transport adapters.                                                                        |
| `ui/dev/`, `ui/styles/`, `vite.config.ts`            | Preview fixtures and dev host, plus global and surface styles.                                                  |
| `.env.example`                                       | Local development settings template; copy to `.env`.                                                            |
| `eslint.config.js`, `tsconfig.test.json`             | Lint rules, and typechecking for tests and the Vite configs.                                                    |
| Co-located `*.test.ts` files; `tests/integration/`   | Feature unit/component suites sit by their modules; cross-feature and environment suites remain in integration. |
| `scripts/`, `skills/`, `docs/`                       | Build/demo/verification scripts, the delegation skill, and design and status notes.                             |

## Verification and remaining plan

The console and embedded panel share a feature-oriented React UI, with clear boundaries for state, transports, components, and forms. See [React UI architecture](docs/react-ui.md) for extension boundaries, self-contained HTML builds, and UI verification. [Local development](docs/development.md) covers setup, the service, the `npm run dev:ui` panel dev host with hot reload, what needs a rebuild or restart, and the `npm run typecheck` and `npm test` checks.

The suite verifies scheduling, real Git worktrees and patches, ownership, input, recovery, concurrency, budgets, SDK configuration and permission hooks, HTTP authentication, MCP tool/resource calls, and the packed tarball run from outside the checkout. Browser verification covers delegation, Chat (follow-ups, steers, the queue, interrupts and streaming replies) and input submission in fixture mode. See [implementation status](docs/implementation-status.md).

Authenticated native Claude execution with plain replies, input interruption, a follow-up resuming the session after reopening the control plane, SDK cost reporting, the opt-in extension Bash sandbox and CLI parity (project skills, MCP servers, subagents and hooks) are verified on this machine. Sanitized evidence is in [live verification](docs/live-claude-verification.json). Full-harness containment remains unverified. Production authentication/deployment remain future work. Native host rendering and event reception also require verification after registration.

Plugin packaging and entrypoint metadata follow the [OpenAI plugin packaging documentation](https://developers.openai.com/plugins/build/plugins) and [Plugin Extensions documentation](https://developers.openai.com/plugins/build/extensions). The brief is the design reference, not a runtime instruction source.

### Live Claude checks

To reproduce authenticated Claude checks after building, explicitly opt into model calls. The script runs the service code from `src/` through `tsx`; the `mcp` scenario also uses the built `dist/stdio.js` and `dist/app.html`:

```sh
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 npx tsx scripts/verify-live-claude.mjs read
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 npx tsx scripts/verify-live-claude.mjs resume
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 npx tsx scripts/verify-live-claude.mjs sandbox
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 npx tsx scripts/verify-live-claude.mjs mcp
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 npx tsx scripts/verify-live-claude.mjs budget
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 npx tsx scripts/verify-live-claude.mjs parity
```

Each scenario uses a temporary Git fixture and a native task budget of at most $0.25, or $0.50 for parity. The budget scenario deliberately sets $0.001 and expects a budget failure. Claude checks cost after a response, so that response can exceed the configured amount; this is not a hard billing cap. The sandbox scenario enables the extension sandbox, approves only its five exact fixture commands and uses a local listener; unexpected permission requests are denied. The parity scenario uses default settings, a budget of $0.50, and project-local fixtures: a skill, a `.mcp.json` stdio server and a `PreToolUse` hook. It approves only the fixture tools and checks that a subagent runs. These checks require configured Claude Code credentials and are excluded from the ordinary test suite.

## Plugin settings

Settings are edited in the panel: **Settings** in its header opens a dialog built from `get_agent_settings`. The server does not advertise native host settings. `get_agent_settings` and `update_agent_settings` are model-visible; `update_agent_settings` can update ordinary defaults but rejects permission, approval-authority, and automatic project registration settings. App-only `update_user_agent_settings` allows the user to change these defaults. Compatible hosts must enforce app-only tool visibility. Authenticated raw service clients are trusted administrators; this boundary does not cryptographically attest that a human made a request.

Defaults include provider, worker profile, workspace strategy (`current_repo` by default, with `worktree` available), the worktree branch prefix (`worktree_branch_prefix: "agent/"`; a worktree task's branch is the prefix followed by its task ID, and Git checks the whole name when the task starts), runtime minutes, cost budget, Claude permission mode (`claude_permission_mode: inherit` by default), and approval decision routing (`default_approval_decider: user` by default). Provider choices include only enabled workers; a saved unavailable provider falls back to the first enabled worker until changed. A disabled provider's model and reasoning defaults are hidden and kept for use when the provider is enabled. The cost limit is $5 by default; explicit `max_cost_usd: null` means no cost limit for task budgets and settings updates. `get_agent_settings` reads each budget as a number or `null` (no limit). Updates can also use `use_cost_budget` and `use_runtime_budget`: disabling one preserves the amount for later use, enabling it restores the amount, and updating the amount while disabled keeps the limit disabled. Providers that cannot enforce a numeric limit reject it before starting. The browser and host delegation form expose an Apply cost limit choice; disabling it preserves the runtime limit. Claude omits its native cost ceiling only for that explicit choice. Updates use `{ "set": { "max_runtime_minutes": 10 } }`, preserve omitted fields, and persist per user in SQLite. New tasks inherit these values; explicit task arguments override them subject to the approval authority rules below, and existing tasks keep their original settings. The console's delegation form reads the current defaults when opened. Unsupported providers, invalid budgets, and unknown settings are rejected before persistence. Claude session restrictions, described below, apply in every permission mode.

### Claude permissions

Claude tasks accept `provider_options.claude.permission_mode`, defaulting to `inherit`. Settings saves `claude_permission_mode`, which can override inheritance. The selector supports the extension's `inherit` option and the [Claude Agent SDK’s native permission modes](https://code.claude.com/docs/en/agent-sdk/permissions):

| Mode                | Native behavior                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `inherit`           | Use the default mode from your Claude Code settings, or `plan` for read-only worker profiles. |
| `default`           | Standard SDK permission checks.                                                               |
| `acceptEdits`       | Automatically approve file edits.                                                             |
| `plan`              | Plan and inspect without ordinary mutating tools.                                             |
| `dontAsk`           | Deny actions that require permission instead of prompting.                                    |
| `auto`              | Let the SDK’s classifier evaluate permission requests.                                        |
| `bypassPermissions` | Skip ordinary SDK approval checks. Enabled session restrictions still apply.                  |

Resolution uses an explicit task override first, then the saved Claude setting. Otherwise read-only profiles select `plan`, and write profiles pass no mode, so your Claude Code settings decide, as in the CLI. The resolved mode is stored in `task.provider_options.claude.permission_mode`, with `permission_source` recording its origin (`task`, `setting`, `task_profile` or `user_config`). Provider-specific task options are isolated under `provider_options.<provider_id>`. The parent agent's own permission mode is not inherited. Because an inherited mode's authority is unknown, a model-selected override under `inherit` can only choose `plan` or `dontAsk`.

Approval decision routing is separate from the native mode. Claude task options accept `provider_options.claude.approval_decider: user` or `parent_agent`, inheriting `default_approval_decider` when omitted. An unresolved SDK permission request waits for the selected decision maker. `user` requests use the panel’s **Approve**/**Deny** buttons or a host form; `parent_agent` permits the parent to approve or deny the exact pending request through `submit_agent_input`. Native modes can allow or deny actions before this callback, so the decision-maker setting does not force a prompt for every command. Questions follow the SDK’s interaction rules; `dontAsk` can deny a question without invoking the callback.

A model-selected override cannot increase permission or approval authority beyond the authorized inherited setting. A trusted panel submission through app-only `start_user_agent_task`, or a user-confirmed host form, can authorize an override. Permission replies through model-visible `submit_agent_input` are accepted only when the parent is the decision maker; user decisions use app-only `submit_user_agent_input` or `request_agent_input` host forms. Request IDs and task ownership checks apply to both routes. The panel’s host transport uses the app-only task, input, and settings aliases; the standalone console uses authenticated cookie authority. App-only tools rely on host visibility enforcement, and authenticated raw service clients remain trusted administrators.

Claude uses native permission modes and separate approval routing. There is no extension-wide automatic approval policy for Claude. Native modes never grant access to unregistered repositories, allow read-only profiles to write, disable mandatory path checks, or enable unsandboxed retries.

### Claude session restrictions

These user-only settings add restrictions to delegated Claude sessions. Model-visible `update_agent_settings` rejects them. Each task stores the resolved values when it starts, shown under **Session restrictions** in the inspector's Details tab.

| Setting              | Default       | Options                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude_sandbox`     | `user_config` | `user_config` applies only the sandbox from your Claude Code settings. `extension` adds the extension's Bash sandbox: workspace-only writes, Git metadata protection, no home or sibling-worktree reads, no network, and no unsandboxed fallback. `extension_locked` also locks network domains at the policy tier, so settings files cannot allow more. |
| `claude_environment` | `inherit`     | `inherit` passes the service environment minus extension secrets. `filtered` passes only basic process variables and Claude authentication and configuration variables.                                                                                                                                                                                  |
| `claude_tools`       | `profile`     | `all` offers every Claude Code tool. `restricted` offers Read, Glob, Grep, Edit, Write, Bash, AskUserQuestion, Skill and MCP tools, and only the read, question and skill tools to read-only work. `profile` restricts read-only profiles only.                                                                                                          |
| `claude_path_guard`  | `profile`     | `on` limits file tools to the task workspace and denies Git metadata. `off` leaves paths to your permission rules. `profile` turns it on for read-only profiles.                                                                                                                                                                                         |
| `claude_subagents`   | `true`        | `false` disallows the Agent tool.                                                                                                                                                                                                                                                                                                                        |

With the extension sandbox, missing sandbox dependencies or unsupported platforms fail instead of running commands unsandboxed. Sandbox list settings in Claude Code settings files, such as excluded commands and allowed domains, still add to the extension policy. Only `extension_locked` stops that, and only for network domains.

Use **Settings** in the panel header. `get_agent_settings` returns the values, the defaults
a reset restores, and the sections and rows the dialog shows, with labelled options; the
dialog renders them as given and saves only changed fields. Its JSON `schema` lists each
field's type, choices and bounds for agents.
Model dropdowns use discovered catalogs, and provider reasoning dropdowns use metadata for
the selected configured model. Global and role efforts remain broad because they apply across providers. Saved custom choices remain available if the catalog changes. Changing a
model takes effect in reasoning choices on the next settings read. Custom IDs can still be set
with `update_agent_settings`. Without discovery, model controls remain text fields and reasoning
support is reported as unknown.

## Host forms

Compatible HTTP MCP hosts can call `request_agent_task` to ask the user to confirm the full request description, worker, committed revision, and budgets before starting work. Browser and native host forms have no manual title field; the service generates the title from the submitted description. The host form lists discovered models as choices, titled with each model's name and description (prefixed with the provider when several are enabled), plus **Use configured default** and any requested custom model. Its description names providers without a model list; their workers use the configured default. Without discovery it keeps a free-text model field. Other custom model IDs remain available through `start_agent_task`, the panel and settings. `request_agent_input` presents the exact pending worker question or permission request. Question forms support titled choices and multiple selections. Permission forms default to deny; cancellation leaves worker input pending and never grants permission. The panel presents direct **Approve** and **Deny** buttons for permission requests, while worker questions retain their answer controls.

`start_agent_task` requires `description` (1–20,000 characters), containing the full request; whitespace-only values are rejected. The title is generated from the description's first line or sentence, up to 120 characters. An optional `title` (1–120 characters) can set the task title. Workers receive the full description as instructions. Task lists and headings show the title, and the inspector keeps the description collapsed until expanded. `request_agent_task` can omit the description to let the user fill it in.

These tools use MCP's `input_required` multi-round-trip flow, as required by the [OpenAI Extensions documentation](https://developers.openai.com/plugins/build/extensions). Hosts return the opaque `requestState` alongside bare `inputResponses.form`. State is persisted, bound to the authenticated owner and original arguments, and expires after ten minutes. Repeated identical submissions return the original outcome; changed arguments, invalid answers, expired state, and stale worker-input IDs are rejected. If the service stops during submission, recovery refuses to repeat the operation; inspect the task list before creating another request.

Task and worker-input forms are exposed on the HTTP MCP endpoint. `request_agent_project` uses the durable HTTP flow above or SDK form elicitation over stdio when the host supports it. Without support, use Add project or Browse in the panel; a model-supplied path cannot bypass confirmation. Clients without elicitation support use `start_agent_task` and `submit_agent_input` for questions and parent-agent permission decisions. Permission requests routed to the user require the panel's app-only `submit_user_agent_input` route or a supported host form. Protocol tests exercise actual HTTP round trips with fixture workers; native rendering in ChatGPT is unverified.

## Host-level MCP Events

The HTTP endpoint uses the official MCP 2.0 server SDK for protocol revision `2026-07-28`, including `server/discover`, tools and UI resources. It also accepts stateless MCP connections. Event operations are `events/list`, `events/subscribe`, and `events/unsubscribe`.

Supported webhook events are `agent_task.completed`, `agent_task.failed`, and `agent_task.input_required`. Subscriptions can filter by task, conversation, or provider. `agent_task.completed` fires when a turn ends with nothing queued, so once each time the task goes idle; its payload carries the turn and an excerpt of the reply. This channel carries compact notifications; the full conversation stays retrievable through `get_agent_messages`.

Callbacks must use public HTTPS endpoints on port 443. The service verifies a signed, single-use challenge before activating a subscription, resolves DNS for every delivery, blocks non-public addresses, pins the validated address for TLS, and does not follow redirects. Secrets are encrypted in SQLite using `<data-directory>/events-key`; preserve this file with database backups. Subscriptions, encrypted secrets, and pending deliveries survive service restarts.

Successful deliveries are recorded idempotently. Transient failures retry up to eight attempts with exponential backoff; redirects and permanent client errors are not retried. `410` disables the subscription. Refresh supports signing-key rotation with a five-minute dual-signature window. Granted subscriptions expire within one day by default, or up to seven days when a shorter or longer finite lifetime is requested; requests without expiration receive a finite grant. Events do not expose a replay cursor, so pre-subscription history is not delivered.

Local protocol tests cover these methods and their delivery behavior against the [OpenAI MCP Events protocol](https://developers.openai.com/plugins/build/mcp-events). ChatGPT subscription delivery is unverified; it requires a registered host and a reachable authenticated endpoint.

## Multiple projects and packaged startup

For running the service from a checkout, `.env` setup, and the matching Codex
data directory, see [Local development](docs/development.md). Projects need no
startup registration: chat projects are added when a task starts from that chat
(see **Automatically add chat projects** below), and **Add project** or
`npm run projects` covers the rest.

Build with `npm run build`. `npm run package:plugin` creates an npm tarball
containing the bundled service/proxy code with its dependencies, both HTML panels
and the delegation skill. It has no `node_modules` and no native binaries, so one
tarball works on every platform. Extract its `package/` directory as the plugin
root for a local installation. The execution host needs Node 24+ and a
[supported Claude Code CLI](docs/claude-cli.md). See
[Build](docs/development.md#build) for how the bundle and package are made.
Ordinary source checkouts require `npm ci` before building.
The packaged black and white `assets/product-glyph-{black,white}.svg` files supply the
composer, listing, MCP server, and mention-result icons.
The stdio launcher connects to the authenticated local service or starts it when
the loopback connection is refused. Startup errors go to `service.log` in the data
directory. Concurrent launchers share the PID lease; losing processes cannot
recover tasks or own workers. The HTTP listener is reserved before recovery;
health and API requests return 503 until recovery completes, and a bind failure
leaves task state unchanged. Client disconnection leaves the service and tasks
running. See [Run the service](docs/development.md#run-the-service) for startup
conflict handling and manual cleanup.
An incompatible process on the configured port is rejected, never replaced.

Use **Add project** in the global task UI or a global panel launch. A panel
opened from a thread offers **Add chat project** for that chat's repository
instead. Enter an
absolute Git repository path, or use **Browse…** to open the native folder
picker on the macOS service host. Selecting a folder only fills the path; click
**Add project** to approve access. Invalid paths stay in the form with an error,
and cancellation preserves the path. Other platforms can use manual path entry.
The **New task** modal also offers **Browse…** beside its Project selector.
Choosing a folder there registers and selects the repository while preserving
the task draft; cancellation keeps the previous project. Tasks start only when
**Start task** is clicked.
Registration refreshes the project choices without restarting the service.
The standalone Add project form focuses the new project; New task selects it
only in the task draft. Existing tasks keep their original repositories.
From a chat, read-only `get_current_agent_project` reports the current local Git
root and whether it is registered, using only the original host `_meta["codex/sandbox-state-meta"].sandboxCwd`. If it is
not registered, call `request_agent_project` to ask the user to approve access.
Its optional `repository` prefills a known absolute path; otherwise the form
prefills the host Git root when available. The decision defaults to deny, and
only an accepted **allow** registers the canonical root. Decline or cancellation
leaves it unregistered. Registration never starts a task.

**Automatically add chat projects** (`auto_register_chat_project`) is a user-only
setting in panel Settings. It defaults to true. It applies only when a
task is started from a chat (`start_agent_task`, the panel's Start task, or the
task form) and the task targets that chat's Git root, supplied by original host
metadata; an existing grant, including an approved parent, is left as is. Listing
projects, resolving context and opening panels stay read-only and never register.
Explicit task paths and `host_directory` arguments never grant access through
this policy. In the panel, New task offers the unregistered chat project marked
"added when the task starts"; choosing it and clicking **Start task** adds it.
When a read-only check finds the chat project missing outside a task start, the
model should ask the user with `request_agent_project`. Disabling the setting
keeps registered projects, and **Add chat project** then prefills a detected
path for user review.
Host metadata delivery is unverified in the target desktop host.

You can also approve repositories directly on the service host:

```sh
node dist/projects-cli.js register /absolute/path/to/repository
node dist/projects-cli.js register /absolute/path/to/another-repository
node dist/projects-cli.js list
# Only when you intend to permit repositories throughout this directory:
node dist/projects-cli.js approve-parent /absolute/path/to/projects
```

Registration persists in SQLite and becomes available without restarting the
service. Use `list_agent_projects`, then pass an explicit absolute `repository`
to `start_agent_task`. Parent approval permits validated Git roots beneath it;
register individual children to include them in the UI/form selectors.
Repository approval covers the registered Git root only, not independent nested
repositories. Parent approval is the explicit way to authorize descendants.
UI registration, accepted host confirmation, the opt-in host metadata policy,
and the CLI are the registration boundaries. Direct registration and browsing
tools are app-only; model-visible `request_agent_project` requires user confirmation.
MCP hosts must enforce app-only tool visibility, as they do for user permission
and settings tools. Canonical
paths, symlink containment and Git-root validation still apply. Missing/`current` repositories fail with guidance in the
packaged service. Both panels and HTTP task forms show explicit project choices.
Existing tasks, continuations, and retries retain their original repository and
workspace. Project selection for a new task has no global effect on other chats.

All clients must share the same absolute data override to share a service. The
default data directory is per-user and independent of the installation
directory. Explicit data, token, and port settings are supported. The service
uses the configured data path and does not move its database, worktrees, or
session references. Register approved repositories explicitly or approve a
parent directory; model-supplied task paths do not grant repository access.

Trusted Codex hooks can supply session cwd, but that context is not automatically
bound to MCP calls. This implementation uses validated optional directory hints and explicit selection;
it does not install a hook. Local stdio cannot reach a cloud host's filesystem, and native
host rendering/handshake remains unverified. See [host capabilities and current
official sources](docs/host-capabilities.md) for hook trust, MCP Apps context,
elicitation, recent protocol changes and Claude session compatibility.

## Project and chat awareness

Starting a task returns the panel with the new task selected on Chat, where its reply streams in. The
thread opener `open_codex_subagent_extension` accepts `repository`, `revision`,
and `task_id` and advertises only a thread entrypoint. An owned `task_id` uses
that task's scope rather than ambient chat or directory metadata; explicit
conflicting arguments are rejected. Other launches preserve explicit or host
chat context. The app-only `open_codex_subagent_extension_global` opens all
chats and all projects. Unscoped panels explicitly request a null conversation;
scoped panels show the project name and path read-only, with no project selector or **All chats** button.
`get_agent_panel_context`
resolves validated defaults from host metadata or the latest task in the same
chat. New task prefills known project/revision and user worker/budget defaults.
A visible project picker filters tasks, and chat/project scope changes discard
stale reads and unsent forms. The project registry refreshes during polling and manual refresh while preserving
drafts and stable options. Parent-approved repositories can be entered by
absolute path. Global history never silently supplies the next task's project.

The target is Codex in the ChatGPT desktop app. The extension requests inline
and fullscreen modes; the host controls placement. Native placement and
metadata delivery require verification in a registered host. See
[host capabilities](docs/host-capabilities.md) for integration details.

## Extension review limits

The server consumes optional `_meta["openai/session"]` or source-backed
`_meta.threadId` conversation correlation for panel opening, task creation and
task listing. Explicit `conversation_id`
arguments take precedence. For task creation, `conversation_id: null` opts out
of host conversation correlation and is persisted as an absent Task conversation
ID; clients without the hint retain explicit/all-task scope. These hints grant no repository or account access. Both transports opt in to
`codex/sandbox-state-meta` and validate its local `sandboxCwd` directory hint
against registered projects, or register the host Git root under the explicit user opt-in described above. Public CLI/core source does not establish desktop
UI behavior. See the [official UI
reference](https://developers.openai.com/plugins/reference).

The portable local package is not ready for universal-directory submission.
Public distribution still needs a reachable HTTPS MCP endpoint (or separately
approved local MCP support), complete listing information and policy links,
submission-compliant subtitle/color/icons, and a dedicated UI origin. See
[submission requirements](https://developers.openai.com/plugins/deploy/submission).
Native rich forms and MCP Events are intentionally HTTP-only. Composer mention
search is registered as an optional Claude provider hint, but the Codex
composer's Claude item results and selected-item handoff still need live host
verification.
Onboarding, file handlers and deep links remain optional unimplemented
extensions. Native host rendering and authenticated execution of the packaged
service still need integration verification beyond the local fixture/protocol
tests.

### Model and reasoning defaults

The panel settings editor persists model and reasoning defaults per user.
Use `default_model` and `default_reasoning_effort` for global defaults,
`claude_default_model` / `claude_default_reasoning_effort` (or `fixture`)
for provider defaults, and `reviewer_default_model` / `reviewer_default_reasoning_effort`
(or any worker profile such as `researcher` or `implementer`) for role defaults.

Both task creation forms accept a model ID or provider alias and a reasoning effort.
The `start_agent_task` tool accepts these as `model` and `reasoning_effort`.
Each setting resolves independently: task override → role → provider → global → provider runtime default.
Blank model fields and `default` reasoning inherit. Configured defaults resolve when a task
is created; runtime fallbacks remain provider-managed. Role defaults apply across providers,
so use a model appropriate for the task's provider or enter a task override.
Model availability depends on the provider and account. Claude supports `low`, `medium`, `high`,
`xhigh`, and `max`. Unsupported Claude effort is rejected before queuing. When no model is
configured, Claude uses its runtime default.

Claude model suggestions come from the Agent SDK's `supportedModels()` metadata,
including per-model `supportsEffort` and `supportedEffortLevels`. Discovery initializes
a tool-free session without submitting a task, caches successful results for five minutes,
and retries failures after thirty seconds. Known unsupported reasoning choices are rejected
before queuing; missing model or effort metadata remains unknown and is validated by the
provider at execution. Custom model IDs remain supported.
