# Codex subagent extension

A local MVP for Codex to delegate Claude coding tasks through MCP. Claude executes through the Claude Agent SDK and native Claude Code harness. One service owns the durable task database and worktrees; MCP clients never become workers.

For manual setup, staged verification, and continuing in a new thread, see [Setup and resume guide](SETUP-AND-RESUME.md).

## Try the console

Requires Node.js 24+ and Git.

```sh
npm ci
npm run demo
```

Open http://127.0.0.1:4317 and enter `local-demo-only`. This explicit fixture mode uses a disposable sample repository and makes **no model calls**. Add `[input]` to a fixture task to exercise human input, interruption, and continuation. Fixture results identify themselves as fixtures.

## Run real Claude tasks

Configure Claude Agent SDK authentication on the service host (`ANTHROPIC_API_KEY` in the service environment, or an existing supported Claude Code login). Do not put provider credentials in MCP arguments, browser code, or this repository. The Claude harness receives only basic process variables and Claude authentication/configuration variables; service tokens, other-provider credentials, SSH agent access, cloud credentials, Node preload options and inherited proxies are excluded. Custom proxy/cloud-provider environments are not passed through by this adapter. This environment filtering does not provide OS filesystem or network containment.

```sh
npm run build
CODEX_SUBAGENT_EXTENSION_REPOSITORY=../target-repository npm start
```

Run the command from the project root; the target path is relative to that directory. The target must be a Git repository root with at least one commit. This project started as a notes-only directory; use an existing repository or the demo until it is initialized. A task starts from the specified **committed revision**, not uncommitted files. The service creates a detached worktree per task and never automatically merges changes.

The service writes a login token to `.codex-subagent-extension/admin-token` with owner-only permissions. Use it to sign into the local console. The token stays server-side for MCP proxy requests; browsers receive an HttpOnly session cookie valid for one hour. Restarting invalidates browser sessions. Data and worktrees persist.

Stop the fixture service before starting Claude on the same port. Provider availability is explicit: fixture workers are disabled by default.

## Connect Codex

Run the service first. Configure a stdio MCP server with paths to `dist/stdio.js` and the service's data directory. Replace `<checkout-root>` in this example with the full path to your local checkout; the MCP client may start with a different working directory:

```toml
[mcp_servers.codex_subagent_extension]
command = "node"
args = ["<checkout-root>/dist/stdio.js"]

[mcp_servers.codex_subagent_extension.env]
CODEX_SUBAGENT_EXTENSION_DATA = "<checkout-root>/.codex-subagent-extension"
```

The proxy reads the service token locally and forwards requests to the running service. It does not create another scheduler. `CODEX_SUBAGENT_EXTENSION_URL` changes its loopback URL. The portable plugin manifest, MCP configuration, and delegation skill are also included; build the package before configuring it. Installing a plugin does not start the service automatically.

For MCP App hosts, connect to the authenticated HTTP endpoint `/mcp`. The delegation panel replaces the previous `app-v3` MCP resource with `ui://codex-subagent-extension/app-v4` over the authenticated MCP bridge, with empty network allowlists. The standalone web console retains its existing routes. The panel uses portable MCP Apps calls; Codex-specific sidebar behavior remains subject to host verification.

The standalone web console uses token login, HttpOnly session cookies, HTTP tools and live SSE. The stdio proxy provides tools and the separate `app-v4` delegation panel through the portable MCP Apps bridge. HTTP and stdio share the panel's schemas, resources, and global/thread entrypoint metadata. Reload the MCP connection after rebuilding so the host discovers updated tool metadata. Actual panel placement is controlled by the host; declaring both entrypoints does not redirect sidebar clicks into the active chat. Existing task tools remain available. Installing the plugin does not register a remote ChatGPT connection or deploy a production service.

## Supported workflows

- Durable asynchronous tasks, concurrent branches, explicit dependencies, and conversation filtering.
- Researcher, reviewer, and security reviewer profiles inspect only. Implementer, debugger, test engineer, and refactorer profiles can write in the worktree; every shell command requires a separate approval.
- Start, inspect, steer, interrupt, continue, cancel, and retry. Steering interrupts and starts a new SDK turn with the instruction; retry creates a new task.
- Questions and permission requests carry unique request IDs. Stale or duplicate answers are rejected.
- Structured results, ordered execution events, reports, and Git-generated patches including committed and untracked changes.
- Session ID, state location, and worker affinity. Continuation checks the original worker and transcript availability. Worktrees and Claude runtime state must remain on that machine. This is session continuation, not instruction-pointer pause/resume.
- Runtime limits across turns and SDK-native per-turn cost ceilings reduced by observed prior cost. Costs incurred during forcibly interrupted turns may not be reported by the SDK; this is not a billing guarantee. Token limits and optional native subagent features are explicitly unsupported in the current deployment.
- Authenticated SSE replay and short-lived browser sessions; all task mutations go through the same tool dispatch as MCP.

A worktree provides code separation. Claude tasks also require the SDK's native Bash sandbox: missing dependencies or unsupported platforms fail instead of running commands unsandboxed. Every Bash command still requires approval; unsandboxed retries are disabled. The policy configures worktree writes, Git metadata protection, restricted sensitive/sibling-worktree reads and no allowed outbound domains. Native Read/Edit/Write tools retain mandatory path checks. The model/API harness is outside the Bash sandbox, and Bash enforcement has been verified against disposable fixture writes, Git metadata, a symlink escape and a loopback listener; full-harness containment remains unverified. The service is a single-user, loopback-only application with ownership checks in the control plane. Remote multi-user OAuth, container/network policies, and public hosting require separate deployment work. Do not expose this service directly to the public Internet.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `CODEX_SUBAGENT_EXTENSION_REPOSITORY` | current directory | Allowed Git repository root |
| `CODEX_SUBAGENT_EXTENSION_DATA` | `.codex-subagent-extension` | Persistent SQLite database, worktrees, service lock, token |
| `CODEX_SUBAGENT_EXTENSION_CONCURRENCY` | `3` | Maximum concurrently active tasks (1–20) |
| `CODEX_SUBAGENT_EXTENSION_TOKEN` | generated locally | Server-side token override |
| `PORT` | `4317` | Loopback listener port |
| `CODEX_SUBAGENT_EXTENSION_ORIGIN` | `http://127.0.0.1:4317` | Standalone service origin and CORS allowlist |
| `CODEX_SUBAGENT_EXTENSION_FIXTURE` | disabled | Set `1` to add fixture workers for testing |
| `CODEX_SUBAGENT_EXTENSION_PROVIDER` | Claude | Set `fixture` for fixture-only mode |

Review `.codex-subagent-extension/worktrees/<task-id>` or download returned patches before applying them. Cancellation never deletes a worktree. Preserve Claude's local runtime state for resumable sessions. One service may own a data directory at a time.

## Verification and remaining plan

```sh
npm run typecheck
npm run build
npm test
```

The suite verifies scheduling, real Git worktrees and patches, ownership, input, recovery, concurrency, budgets, SDK configuration and permission hooks, HTTP authentication, and MCP tool/resource calls. Browser verification covers delegation, live completion, interruption, continuation, input submission, and artifacts in fixture mode. See [implementation status](docs/implementation-status.md).

Authenticated native Claude read/report execution, input interruption, session continuation after reopening the control plane, SDK cost reporting and the tested Bash restrictions are verified on this machine. Sanitized evidence is in [live verification](docs/live-claude-verification.json). Interrupted-turn cost accounting and full-harness containment remain incomplete. The opt-in Codex provider still needs authenticated verification; recovery of surviving executor process groups is verified locally. Production authentication/deployment remain future work. Native host rendering and event reception also require verification after registration.

Plugin packaging and entrypoint metadata follow the [OpenAI plugin packaging documentation](https://developers.openai.com/plugins/build/plugins) and [Plugin Extensions documentation](https://developers.openai.com/plugins/build/extensions). The brief is the design reference, not a runtime instruction source.

## Plugin settings

The server advertises `extensions["openai/settings"]` with `get_agent_settings` and `update_agent_settings`. Compatible ChatGPT hosts can render its native settings schema and layout. The same tools are available through the local stdio proxy and authenticated HTTP tool API.

Defaults include provider, worker profile, worktree strategy, runtime minutes, and cost budget. The cost limit remains $5 by default; explicit `max_cost_usd: null` means no cost limit. Providers that cannot enforce a numeric limit reject it before starting. The browser and host delegation form expose an Apply cost limit choice; disabling it preserves the runtime limit. Claude omits its native cost ceiling only for that explicit choice. Updates use `{ "set": { "max_runtime_minutes": 10 } }`, preserve omitted fields, and persist per user in SQLite. New tasks inherit these values; explicit task arguments override them, and existing tasks keep their original settings. The console's delegation form reads the current defaults when opened. Unsupported providers, invalid budgets, and unknown settings are rejected before persistence. Approval policy remains enforced by the worker, rather than configurable through these defaults.

Native host discovery and tool envelopes are covered by local protocol tests. Actual rendering in ChatGPT remains unverified until host registration.

## Host forms

Compatible HTTP MCP hosts can call `request_agent_task` to ask the user to confirm a task, worker, committed revision, and budgets before starting work. `request_agent_input` presents the exact pending worker question or permission request. Question forms support titled choices and multiple selections. Shell permissions default to deny; cancellation leaves worker input pending and never grants permission.

These tools use MCP's `input_required` multi-round-trip flow, as required by the [OpenAI Extensions documentation](https://developers.openai.com/plugins/build/extensions). Hosts return the opaque `requestState` alongside bare `inputResponses.form`. State is persisted, bound to the authenticated owner and original arguments, and expires after ten minutes. Repeated identical submissions return the original outcome; changed arguments, invalid answers, expired state, and stale worker-input IDs are rejected. If the service stops during submission, recovery refuses to repeat the operation; inspect the task list before creating another request.

Forms are exposed on the HTTP MCP endpoint. Clients without elicitation support, including the local stdio proxy, continue using `start_agent_task` and `submit_agent_input`. Protocol tests exercise actual HTTP round trips with fixture workers; native rendering in ChatGPT remains unverified.

## Codex worker implementation

The native provider uses the official OpenAI SDK and [Agents API](https://developers.openai.com/api/docs/guides/agents-api/overview), with a self-hosted `codex exec-server`. It is disabled by default and requires macOS. To opt in, configure these environment variables before starting the service:

| Variable | Value |
| --- | --- |
| `CODEX_SUBAGENT_EXTENSION_CODEX` | `1` adds Codex alongside Claude |
| `CODEX_SUBAGENT_EXTENSION_PROVIDER` | Optional `codex` selects Codex only; `fixture` always keeps live providers disabled |
| `CODEX_SUBAGENT_EXTENSION_CODEX_MODEL` | An explicit model available to your API account |
| `CODEX_SUBAGENT_EXTENSION_CODEX_EXECUTABLE` | Absolute native CLI path, available from `command -v codex` |
| `OPENAI_API_KEY` | Application key for session management and inference |
| `OPENAI_EXECUTOR_API_KEY` | A separate key restricted to environment connections |

Keep credentials outside source control. [Self-hosted environments](https://developers.openai.com/api/docs/guides/agents-api/environments/self-hosted) require the application key to stay outside the worker environment. Configuration rejects identical keys, but their actual permission scopes must be configured in your account. Select **No cost limit** for Codex; this adapter rejects cost and token limits it cannot enforce. Runtime limits remain active.

Each native execution turn requires explicit permission before session creation or executor startup. Permission covers shell execution inside the stated sandbox for that turn; individual commands do not have separate approval prompts. Read-only profiles cannot write the worktree. The macOS sandbox protects Git metadata and limits network access to an authenticated local CONNECT proxy for documented executor hosts. Runtime directories must be outside the worktree and Git metadata. Native authenticated proxy compatibility and containment of descendants that escape the process group remain unverified.

The provider persists its session and coordinator turn, uses native SDK streaming and function handlers for questions, validates the selected turn's saved final report, and awaits executor shutdown before returning. Launch reservations, PID, process birth time, user/group identity, session/environment mapping and lifecycle state persist in SQLite outside the worker runtime. Recovery validates a surviving executor against its unique launch marker and saved process identity before signaling its group; startup reservations without a saved PID are recovered only when one matching owned process is found. When local shutdown and remote turn state can both be confirmed, it restores an interrupted task for explicit continuation. Unknown outcomes keep controls locked and defer artifacts. Legacy records without process identity, ambiguous launches, and live groups whose leader has disappeared remain locked. Descendants that escape the process group are not proven terminated. Startup recovery finishes before the HTTP listener opens.

All local contract, orchestration, journal and sandbox checks pass. SDK tests inject HTTP responses, and executor lifecycle tests use local test processes. No authenticated Codex model run has been performed. Native Claude verification is recorded separately; native ChatGPT rendering remains unverified.

## Host-level MCP Events

The HTTP endpoint uses the official MCP 2.0 server SDK for protocol revision `2026-07-28`, including `server/discover`, tools and UI resources. The same endpoint retains stateless legacy MCP compatibility for existing Codex clients. Event operations are `events/list`, `events/subscribe`, and `events/unsubscribe`.

Supported webhook events are `agent_task.completed`, `agent_task.failed`, and `agent_task.input_required`. Subscriptions can filter by task, conversation, or provider. This channel carries compact notifications; tool output stays in the authenticated console stream and full results remain retrievable through tools.

Callbacks must use public HTTPS endpoints on port 443. The service verifies a signed, single-use challenge before activating a subscription, resolves DNS for every delivery, blocks non-public addresses, pins the validated address for TLS, and does not follow redirects. Secrets are encrypted in SQLite using `.codex-subagent-extension/events-key`; preserve this file with database backups. Subscriptions, encrypted secrets, and pending deliveries survive service restarts.

Successful deliveries are recorded idempotently. Transient failures retry up to eight attempts with exponential backoff; redirects and permanent client errors are not retried. `410` disables the subscription. Refresh supports signing-key rotation with a five-minute dual-signature window. Granted subscriptions expire within one day by default, or up to seven days when a shorter or longer finite lifetime is requested; requests without expiration receive a finite grant. Events do not expose a replay cursor, so pre-subscription history is not delivered.

These methods and their delivery behavior are verified locally against the [OpenAI MCP Events protocol](https://developers.openai.com/plugins/build/mcp-events). Actual ChatGPT subscription delivery remains a separate host verification gate requiring registration and a reachable authenticated endpoint. No callback was contacted during development tests.


The task detail offers **Copy for Codex** in the standalone console and **Send to conversation** when embedded. Review or edit the message before submitting. It includes the task identity, short task/result excerpts and references to tools for retrieving full evidence; it does not apply patches. Embedded message delivery depends on host support and has not yet been verified in a registered host.

Worker links such as `/workers/claude.reviewer` show that profile's available capabilities and tasks. Use the sidebar worker picker or **Delegate to this worker** to select a profile for a new task.

To reproduce authenticated Claude checks after building, explicitly opt into model calls:

```sh
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 node scripts/verify-live-claude.mjs read
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 node scripts/verify-live-claude.mjs resume
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 node scripts/verify-live-claude.mjs sandbox
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 node scripts/verify-live-claude.mjs mcp
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 node scripts/verify-live-claude.mjs budget
```

Each scenario uses a temporary Git fixture and a native task budget of at most $0.25. The budget scenario deliberately sets $0.001 and expects a budget failure. Claude checks cost after a response, so that response can exceed the configured amount; this is not a hard billing cap. The sandbox scenario approves only its five exact fixture commands and uses a local listener; unexpected permission requests are denied. Interrupted-turn costs may not be fully captured in the final task record. These checks require a usable Claude login or API key and are excluded from the ordinary test suite.
