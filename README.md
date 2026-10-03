# Codex subagent extension

A local MVP for Codex to delegate Claude coding tasks through MCP. Claude executes through the Claude Agent SDK and native Claude Code harness. One service owns the durable task database and creates worktrees for isolated tasks; MCP clients never become workers.

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

Run the command from the project root; the target path is relative to that directory. The target must be a Git repository root with at least one commit. Use a committed repository or the disposable demo fixture. By default, a task runs directly in the approved repository with `workspace_strategy: "current_repo"` and `revision: "HEAD"`, including staged, unstaged, and untracked files. Set `workspace_strategy: "worktree"` to start from a specified **committed revision** in a detached worktree; the service never automatically merges worktree changes. The browser and host delegation forms offer the same Workspace choice. Review profiles remain read-only; write profiles edit the current checkout directly, so preserve unrelated user changes. Choose a worktree for isolated or parallel edits. Current-repo tasks receive a starting diff for review, and their diff artifacts include pre-existing changes as well as any worker edits. The checkout stays live during execution; changes made by another task or by the user can also appear in those diffs.

The service writes a login token to `<data-directory>/admin-token` with owner-only permissions. Use it to sign into the local console. The token stays server-side for MCP proxy requests; browsers receive an HttpOnly session cookie valid for one hour. Restarting invalidates browser sessions. Data and worktrees persist.

Stop the fixture service before starting Claude on the same port. Provider availability is explicit: fixture workers are disabled by default.

## Connect Codex

The packaged stdio launcher connects to or starts the local service when enabled. Configure a stdio MCP server with paths to `dist/stdio.js` and the service's data directory. Replace `<checkout-root>` in this example with the full path to your local checkout; the MCP client may start with a different working directory:

```toml
[mcp_servers.codex_subagent_extension]
command = "node"
args = ["<checkout-root>/dist/stdio.js"]
```

The proxy and service share the per-user data default. If you set `CODEX_SUBAGENT_EXTENSION_DATA` for the service, set the same absolute value in `[mcp_servers.codex_subagent_extension.env]`.

The proxy reads the service token locally and forwards requests to the running service. It does not create another scheduler. `CODEX_SUBAGENT_EXTENSION_URL` changes its loopback URL. The portable plugin manifest, MCP configuration, and delegation skill are also included; build the package before configuring it. The service starts when the host launches the packaged stdio server; installation alone does not execute it.

For MCP App hosts, connect to the authenticated HTTP endpoint `/mcp`. The delegation panel uses the MCP resource `ui://codex-subagent-extension/app-v6` over the authenticated MCP bridge, with empty network allowlists. The standalone web console retains its existing routes. The panel uses portable MCP Apps calls; Codex-specific sidebar behavior remains subject to host verification.

The standalone web console uses token login, HttpOnly session cookies, HTTP tools and live SSE. The stdio proxy provides tools and the separate `app-v6` delegation panel through the portable MCP Apps bridge. HTTP and stdio share the panel's schemas, resources, and separate global/thread openers. Panel HTML is read from `dist` on each resource request, so rebuilt UI changes can appear without a service restart. Server code changes require a service restart; reload the MCP connection to discover changed opener metadata and resource URIs. Actual panel placement is controlled by the host. Existing task tools remain available. Installing the plugin does not register a remote ChatGPT connection or deploy a production service.

## Supported workflows

- Durable asynchronous tasks, concurrent branches, explicit dependencies, and conversation filtering.
- Researcher, reviewer, and security reviewer profiles inspect only. Implementer, debugger, test engineer, and refactorer profiles can write in the selected workspace; every shell command requires a separate approval.
- Start, inspect, steer, interrupt, continue, cancel, and retry. Steering interrupts and starts a new SDK turn with the instruction; retry creates a new task.
- Questions and permission requests carry unique request IDs. Stale or duplicate answers are rejected.
- Structured results, ordered execution events, reports, and Git-generated patches including committed and untracked changes.
- Session ID, state location, and worker affinity. Continuation checks the original worker and transcript availability. Worktrees and Claude runtime state must remain on that machine. This is session continuation, not instruction-pointer pause/resume.
- Runtime limits across turns and SDK-native per-turn cost ceilings reduced by observed prior cost. Costs incurred during forcibly interrupted turns may not be reported by the SDK; this is not a billing guarantee. Token limits and optional native subagent features are explicitly unsupported in the current deployment.
- Authenticated SSE replay and short-lived browser sessions; all task mutations go through the same tool dispatch as MCP.

A worktree provides code separation. Claude tasks also require the SDK's native Bash sandbox: missing dependencies or unsupported platforms fail instead of running commands unsandboxed. Every Bash command still requires approval; unsandboxed retries are disabled. The policy configures selected workspace writes, Git metadata protection, restricted sensitive/sibling-worktree reads and no allowed outbound domains. Native Read/Edit/Write tools retain mandatory path checks. The model/API harness is outside the Bash sandbox, and Bash enforcement has been verified against disposable fixture writes, Git metadata, a symlink escape and a loopback listener; full-harness containment remains unverified. The service is a single-user, loopback-only application with ownership checks in the control plane. Remote multi-user OAuth, container/network policies, and public hosting require separate deployment work. Do not expose this service directly to the public Internet.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `CODEX_SUBAGENT_EXTENSION_REPOSITORY` | unset | Explicit legacy repository registration at service startup |
| `CODEX_SUBAGENT_EXTENSION_DATA` | `~/.local/share/codex-subagent-extension` | Persistent SQLite database, approved roots, worktrees, lock and token; explicit relative overrides resolve from invocation cwd |
| `CODEX_SUBAGENT_EXTENSION_ALLOWED_ROOTS` | `[]` | JSON array of explicitly approved parent directory paths |
| `CODEX_SUBAGENT_EXTENSION_URL` | discovered local service or port 4317 | Proxy endpoint override; explicit URLs require an already running service |
| `CODEX_SUBAGENT_EXTENSION_CONCURRENCY` | `3` | Maximum concurrently active tasks (1–20) |
| `CODEX_SUBAGENT_EXTENSION_TOKEN` | generated locally | Server-side token override |
| `PORT` | `4317` | Loopback listener port |
| `CODEX_SUBAGENT_EXTENSION_ORIGIN` | `http://127.0.0.1:4317` | Standalone service origin and CORS allowlist |
| `CODEX_SUBAGENT_EXTENSION_FIXTURE` | disabled | Set `1` to add fixture workers for testing |
| `CODEX_SUBAGENT_EXTENSION_PROVIDER` | Claude | Set `fixture` for fixture-only mode |

Review `<data-directory>/worktrees/<task-id>` or download returned patches before applying worktree changes. Current-repo tasks use the approved repository itself, and any worker edits are already present there. Cancellation never deletes a worktree. Preserve Claude's local runtime state for resumable sessions. One service may own a data directory at a time.

## Verification and remaining plan

The console and embedded panel share a modular React UI, with separate controller, transport, component, and form layers. See [React UI architecture](docs/react-ui.md) for extension boundaries, fixture preview, self-contained HTML builds, and UI verification.

```sh
npm run typecheck
npm test
```

`npm test` builds the project first through its `pretest` script.

The suite verifies scheduling, real Git worktrees and patches, ownership, input, recovery, concurrency, budgets, SDK configuration and permission hooks, HTTP authentication, and MCP tool/resource calls. Browser verification covers delegation, live completion, interruption, continuation, input submission, and artifacts in fixture mode. See [implementation status](docs/implementation-status.md).

Authenticated native Claude read/report execution, input interruption, session continuation after reopening the control plane, SDK cost reporting and the tested Bash restrictions are verified on this machine. Sanitized evidence is in [live verification](docs/live-claude-verification.json). Interrupted-turn cost accounting and full-harness containment remain incomplete. The opt-in Codex provider still needs authenticated verification; recovery of surviving executor process groups is verified locally. Production authentication/deployment remain future work. Native host rendering and event reception also require verification after registration.

Plugin packaging and entrypoint metadata follow the [OpenAI plugin packaging documentation](https://developers.openai.com/plugins/build/plugins) and [Plugin Extensions documentation](https://developers.openai.com/plugins/build/extensions). The brief is the design reference, not a runtime instruction source.

## Plugin settings

The server advertises `extensions["openai/settings"]` with `get_agent_settings` and `update_agent_settings`. Compatible ChatGPT hosts can render its native settings schema and layout. The same tools are available through the local stdio proxy and authenticated HTTP tool API.

Defaults include provider, worker profile, workspace strategy (`current_repo` by default, with `worktree` available), runtime minutes, and cost budget. Provider choices include only enabled workers; a saved unavailable provider falls back to the first enabled worker until changed. The cost limit remains $5 by default; explicit `max_cost_usd: null` means no cost limit for task budgets and legacy settings updates. Native settings expose `use_cost_budget` and a numeric `max_cost_usd` because the host settings schema supports scalar fields. Disabling the toggle preserves the amount for later use; enabling it restores the amount. Updating the amount while disabled keeps the limit disabled. Providers that cannot enforce a numeric limit reject it before starting. The browser and host delegation form expose an Apply cost limit choice; disabling it preserves the runtime limit. Claude omits its native cost ceiling only for that explicit choice. Updates use `{ "set": { "max_runtime_minutes": 10 } }`, preserve omitted fields, and persist per user in SQLite. New tasks inherit these values; explicit task arguments override them, and existing tasks keep their original settings. The console's delegation form reads the current defaults when opened. Unsupported providers, invalid budgets, and unknown settings are rejected before persistence. Approval policy remains enforced by the worker, rather than configurable through these defaults.

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

Each native execution turn requires explicit permission before session creation or executor startup. Permission covers shell execution inside the stated sandbox for that turn; individual commands do not have separate approval prompts. Read-only profiles cannot write the selected workspace. The macOS sandbox protects Git metadata and limits network access to an authenticated local CONNECT proxy for documented executor hosts. Runtime directories must be outside the worktree and Git metadata. Native authenticated proxy compatibility and containment of descendants that escape the process group remain unverified.

The provider persists its session and coordinator turn, uses native SDK streaming and function handlers for questions, validates the selected turn's saved final report, and awaits executor shutdown before returning. Launch reservations, PID, process birth time, user/group identity, session/environment mapping and lifecycle state persist in SQLite outside the worker runtime. Recovery validates a surviving executor against its unique launch marker and saved process identity before signaling its group; startup reservations without a saved PID are recovered only when one matching owned process is found. When local shutdown and remote turn state can both be confirmed, it restores an interrupted task for explicit continuation. Unknown outcomes keep controls locked and defer artifacts. Legacy records without process identity, ambiguous launches, and live groups whose leader has disappeared remain locked. Descendants that escape the process group are not proven terminated. The HTTP listener is reserved before recovery; health and API requests return 503 until recovery completes. A bind failure leaves task state unchanged.

All local contract, orchestration, journal and sandbox checks pass. SDK tests inject HTTP responses, and executor lifecycle tests use local test processes. No authenticated Codex model run has been performed. Native Claude verification is recorded separately; native ChatGPT rendering remains unverified.

## Host-level MCP Events

The HTTP endpoint uses the official MCP 2.0 server SDK for protocol revision `2026-07-28`, including `server/discover`, tools and UI resources. The same endpoint retains stateless legacy MCP compatibility for existing Codex clients. Event operations are `events/list`, `events/subscribe`, and `events/unsubscribe`.

Supported webhook events are `agent_task.completed`, `agent_task.failed`, and `agent_task.input_required`. Subscriptions can filter by task, conversation, or provider. This channel carries compact notifications; tool output stays in the authenticated console stream and full results remain retrievable through tools.

Callbacks must use public HTTPS endpoints on port 443. The service verifies a signed, single-use challenge before activating a subscription, resolves DNS for every delivery, blocks non-public addresses, pins the validated address for TLS, and does not follow redirects. Secrets are encrypted in SQLite using `<data-directory>/events-key`; preserve this file with database backups. Subscriptions, encrypted secrets, and pending deliveries survive service restarts.

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

## Multiple projects and packaged startup

For the current local manual test setup, run:

```sh
bash scripts/build-and-start.sh
```

This builds the project, registers this checkout and the sibling
`../ig-image-splitter` repository, and starts the service in the foreground.
Both repositories must exist and be Git roots. The script defaults to
`<checkout-root>/.codex-subagent-extension/live`; configure the same absolute
`CODEX_SUBAGENT_EXTENSION_DATA` in Codex's MCP environment. Stop the service
with Ctrl-C. Existing provider, token, port, and data overrides are preserved.

Pass repository paths to replace the two defaults, for example:

```sh
bash scripts/build-and-start.sh /absolute/path/to/repository
```

These are development-script defaults; packaged stdio startup uses the per-user
data default described below.

Build with `npm run build`. `npm run package:plugin` creates an npm tarball
containing compiled service/proxy code, both HTML panels, the delegation skill and bundled production
dependencies, including installed native Claude runtime assets. Extract its
`package/` directory as the plugin root for a local installation. Node 24+ must
be available on the execution host. Native assets match the build host; build
on the destination OS/architecture rather than copying a native bundle between
platforms. Ordinary source checkouts require `npm ci` before building.
The stdio launcher connects to the authenticated local service or starts it when
the loopback connection is refused. Startup errors go to `service.log` in the data
directory. Concurrent launchers share the PID lease; losing processes cannot
recover tasks or own workers. Client disconnection leaves the service and tasks
running. Stop the PID recorded in `service.pid` gracefully with SIGTERM when needed.
An incompatible process on the configured port is rejected, never replaced.

Approve repositories directly on the service host:

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
register individual children to include them in the UI/form selectors. Repository approval covers the registered Git root only, not independent nested
repositories. Parent approval is the explicit way to authorize descendants. The CLI
is the user approval boundary; there is no model-callable tool that grants an
arbitrary requested path access. Canonical paths, symlink containment and Git-root
validation still apply. Missing/`current` repositories fail with guidance in the
packaged service. Both panels and HTTP task forms show explicit project choices.
Existing tasks, continuations, and retries retain their original repository and
workspace. Project selection for a new task has no global effect on other chats.

All clients must share the same absolute data override to share a service.
The new default is independent of the installation directory. For compatibility,
an existing `console.sqlite` under the installation's old
`.codex-subagent-extension` directory is used in place; that fallback remains
installation-dependent. Existing explicit data/repository/token/port overrides
continue to work. Data is not copied automatically: keep the old absolute DATA
override when upgrading, especially because worktree and session references are
absolute. Legacy approved repositories must be supplied via the repository env
or registered explicitly; historical model-supplied task paths are not access grants.
The development start script accepts repository arguments and
honors environment overrides instead of hardcoding another project.

Trusted Codex hooks can supply session cwd, but that context is not automatically
bound to MCP calls. This implementation uses validated optional directory hints and explicit selection;
it does not install a hook. Local stdio cannot reach a cloud host's filesystem, and native
host rendering/handshake remains unverified. See [host capabilities and current
official sources](docs/host-capabilities.md) for hook trust, MCP Apps context,
elicitation, recent protocol changes and Claude session compatibility.

## Project and chat awareness

Starting a task returns the panel with the new task selected on Activity. The
thread opener `open_codex_subagent_extension` accepts `repository`, `revision`,
and `task_id` and advertises only a thread entrypoint. An owned `task_id` uses
that task's scope rather than ambient chat or directory metadata; explicit
conflicting arguments are rejected. Other launches preserve explicit or host
chat context. The app-only `open_codex_subagent_extension_global` opens all
chats and all projects. Unscoped panels explicitly request a null conversation;
scoped panels offer **All chats**, retaining the repository/revision filter.
`get_agent_panel_context`
resolves validated defaults from host metadata or the latest task in the same
chat. New task prefills known project/revision and user worker/budget defaults.
A visible project picker filters tasks, and chat/project scope changes discard
stale reads and unsent forms. The project registry refreshes during polling and manual refresh while preserving
drafts and stable options. Parent-approved repositories can be entered by
absolute path. Global history never silently supplies the next task's project.

The [saved implementation plan](docs/project-thread-integration-plan.md) and
[research report](docs/project-thread-integration-research.md) compare current
and legacy docs, public Codex core/app-server contracts, and alternative
integrations. The desktop UI is closed source. Native placement remains a
host-controlled behavior; metadata and browser fixture checks do not prove it.

The target is Codex inside the ChatGPT desktop app; the user has confirmed its
thread-specific panel works. The extension implements inline/fullscreen. The
official developer reference also documents PiP, while the linked extension
specification excludes it, so PiP availability needs a host capability check.
The [display-mode and native-surface notes](docs/host-capabilities.md#display-modes-and-native-extension-surfaces)
record the conflicting sources and the absence of a documented extension point
for the host's right pinned summary.

## Extension review limits

The server consumes optional `_meta["openai/session"]` or source-backed
`_meta.threadId` conversation correlation for panel opening, task creation and
task listing. Explicit `conversation_id`
arguments take precedence. For task creation, `conversation_id: null` opts out
of host conversation correlation and is persisted as an absent Task conversation
ID; clients without the hint retain explicit/all-task scope. These hints grant no repository or account access. Both transports opt in to
`codex/sandbox-state-meta` and validate its local `sandboxCwd` directory hint
against registered projects. Public CLI/core source does not establish desktop
UI behavior. See the [official UI
reference](https://developers.openai.com/plugins/reference).

The portable local package is not ready for universal-directory submission.
Public distribution still needs a reachable HTTPS MCP endpoint (or separately
approved local MCP support), complete listing information and policy links,
submission-compliant subtitle/color/icons, and a dedicated UI origin. See
[submission requirements](https://developers.openai.com/plugins/deploy/submission).
Native rich forms and MCP Events are intentionally HTTP-only. Onboarding,
mentions, file handlers and deep links remain optional unimplemented extensions.
Native host rendering and authenticated execution of the packaged service still
need integration verification beyond the local fixture/protocol tests.
