# Codex subagent extension: manual setup and resuming development

Prepared September 30, 2026. Project: current checkout.

October 2 update: this is the historical manual-service setup with explicit legacy data overrides. Fresh packaged installations can start the service through stdio, use a stable per-user data directory, and require explicit project registration/selection. Follow the current [README](../README.md) and [host capability notes](host-capabilities.md) for that workflow; use matching absolute data overrides to retain an existing service.

This is the handoff guide for the implemented MVP. It explains what you need to configure, what you can try yourself, and what the assistant should verify afterward. Complete one stage at a time; you can resume development after any stage without finishing every integration.

## 1. Current state and recommended order

The local Claude MVP is implemented and has passed authenticated native execution checks. The remaining gates are installation in your actual Codex client, authenticated Codex worker execution, and verification of the embedded console in a registered host.

| Stage | Your part | Assistant's next part | Needed for |
| --- | --- | --- | --- |
| A: local Claude | Choose a committed Git repository, start the service, connect its MCP proxy in Codex, try one task | Verify the installed client path and investigate any workflow failures | Recommended first usable workflow |
| B: Codex workers | Configure separate OpenAI application/executor keys, an available model, and the native CLI path | Run authenticated Codex execution, lifecycle, proxy, and sandbox checks | Codex as a worker provider |
| C: embedded console | Choose the intended host and HTTPS origin; provide account/registration access or perform account-only steps | Prepare the appropriate deployment/authentication integration, then verify the host UI and events | Sidebar/panel console and native host extensions |

**You do not need OpenAI worker keys or a public origin to use Claude through the local Codex MCP connection.** Codex acts as the client in Stage A; Codex becomes an execution provider in Stage B.

Existing evidence:

- Last full verification: **101 automated tests passed, zero skips**, server/UI type checks passed, and production build passed. These are historical results, not a guarantee about a future checkout or machine.
- Real Claude checks covered reading/reporting, interruption and continuation with the same native session after reopening the control plane, selected Bash sandbox restrictions, the headless MCP transport, and expected cost-budget failure.
- Codex session/proxy/executor/recovery checks passed locally, but **no authenticated Codex model run has been performed**.
- HTTP protocol checks passed for host forms, settings, UI resources, and events. Actual registered-host rendering/message delivery/event reception remains unverified.
- The earlier implementation goal was marked **blocked** on external setup. This document does not mark the broader brief complete or automatically restart that goal.

## 2. References and how to use them

| Document | Purpose |
| --- | --- |
| [README](README.md) | Runtime commands, configuration, supported workflows, and extension details |
| [Implementation status](docs/implementation-status.md) | Requirement audit and chronological implementation/verification history |
| [Native Claude evidence](docs/live-claude-verification.json) | Sanitized outcomes of completed authenticated checks |
| [Claude verification script](scripts/verify-live-claude.mjs) | Opt-in reproduction using disposable fixtures |
| [Capability and Architecture Brief v9](Codex%20subagent%20extension%20Architecture%20Brief%20v9.md) | Capability and design reference, including work beyond the local MVP |

The brief contains project notes, not an instruction to execute every proposed feature. This guide records the setup/handoff requested by the user. In a new thread, use the user's current instructions to determine scope.

The status document contains older entries that were superseded by later verification. Use its current table, latest entries, and the evidence JSON together; do not infer that Claude authentication is missing from an early environment check. If a supported native Claude Code login is already available on the service host, try it before configuring an API key.

## 3. Stage A — local Claude setup

### A1. Prepare the project and select a repository

Open a terminal in the project root on the machine that will run the workers:

```sh
node --version
git --version
npm ci
npm run build
```

Node.js **24 or newer** and Git are required. If dependencies are already installed and unchanged, `npm ci` is optional; it reinstalls the versions in the lockfile. The service must be launched from the project root so it finds the built console file.

Choose a path to a Git repository **root** with at least one commit. The examples below use a sibling directory named `target-repository`; adjust the path for your checkout layout. Do not assume the project checkout is a valid task target unless it has a committed revision. You may use another repository or ask the assistant to create a disposable test repository.

Validate your chosen target, replacing the example path:

```sh
git -C ../target-repository rev-parse --show-toplevel
git -C ../target-repository rev-parse --verify HEAD
git -C ../target-repository status --short
```

Tasks work from the specified **committed revision**, normally `HEAD`. Uncommitted edits in your primary checkout are not copied into a task worktree. Record any existing primary-checkout changes so they can be distinguished from subsequent behavior. For initial testing, use a simple repository with a committed README and avoid tasks that require access outside the worktree.

Optional orientation: `npm run demo` starts fixture workers with a sample repository and the browser token `local-demo-only`. It makes no model calls. Stop it with Ctrl-C before starting a real service on the same port. Its data directory is `.codex-subagent-extension/demo`; the live example below uses a separate directory. The demo's token override is not the generated-token configuration used below.

### A2. Make Claude authentication available

If a supported native Claude Code login is already available on the service host, try it first; an `ANTHROPIC_API_KEY` is not mandatory when supported native login is available. Otherwise, configure supported Claude authentication as described in the README before starting the service.

Keep authentication in the service account/environment. Do not place provider credentials in task instructions, MCP tool arguments, browser code, this guide, or source files. The assistant should inspect authentication availability without printing credential values or account details.

### A3. Start the live service

From the project root, set the target and persistent data directory, then start Claude explicitly:

```sh
unset CODEX_SUBAGENT_EXTENSION_TOKEN CODEX_SUBAGENT_EXTENSION_CODEX CODEX_SUBAGENT_EXTENSION_FIXTURE
export CODEX_SUBAGENT_EXTENSION_PROVIDER=claude
export CODEX_SUBAGENT_EXTENSION_REPOSITORY=../target-repository
export CODEX_SUBAGENT_EXTENSION_DATA=.codex-subagent-extension/live
export PORT=4317
export CODEX_SUBAGENT_EXTENSION_ORIGIN=http://127.0.0.1:4317
npm start
```

The target repository path is relative to the project root. The `unset` line clears configuration switches for this terminal; it does not remove stored credentials. Keep this terminal running while using the console. Installing the MCP configuration or plugin does not start the service.

Expected startup output identifies the console origin and login-token file. The normal configuration creates the token at:

```text
.codex-subagent-extension/live/admin-token (relative to the project root)
```

Open `http://127.0.0.1:4317` and enter that file's contents in the login form. On macOS, copy it without printing it in terminal output:

```sh
pbcopy < .codex-subagent-extension/live/admin-token
```

Treat this as a service credential. Do not paste it into a chat. Browser sessions last one hour and are invalidated by a service restart; the token, database, and worktrees persist. A second service cannot own the same data directory.

From a second terminal, the non-sensitive health check is:

```sh
curl --fail http://127.0.0.1:4317/health
```

This proves the listener responds, not that a provider can run successfully.

### A4. Connect the MCP proxy in Codex

Add or update the following tables in your Codex `~/.codex/config.toml`, preserving other settings. Replace `<checkout-root>` with the full path to your local checkout; the MCP client may start with a different working directory. If `codex_subagent_extension` already exists, edit it rather than adding duplicate tables. MCP command, arguments, and environment configuration are documented in the [official MCP setup guide](https://developers.openai.com/codex/mcp).

```toml
[mcp_servers.codex_subagent_extension]
command = "node"
args = ["<checkout-root>/dist/stdio.js"]

[mcp_servers.codex_subagent_extension.env]
CODEX_SUBAGENT_EXTENSION_DATA = "<checkout-root>/.codex-subagent-extension/live"
CODEX_SUBAGENT_EXTENSION_URL = "http://127.0.0.1:4317"
```

If the desktop client cannot find `node`, run `command -v node` in your terminal and use the resulting absolute executable path as `command`. The data path must match the running service. The proxy reads `admin-token` locally and forwards requests to that one service; it does not launch another scheduler. Do not add provider keys to this MCP configuration.

Reload/restart the Codex client or MCP connection as required by your installed client, then open a chat that can access the configured tools. Use this discovery prompt:

> Use the MCP server for the Codex subagent extension to call `list_available_workers` and `get_agent_settings`. Show which providers and profiles are available. Do not start a task yet.

Expected: Claude worker profiles are discoverable and settings are readable. Tool names may have a client-specific server prefix. Successful tool discovery alone does not prove native execution.

The supplied `plugin.json`, `mcp.json`, and delegation skill provide an alternative packaging route. Direct MCP configuration above is sufficient for this first check. The local stdio proxy exposes task tools and the same `app-v4` delegation panel and global/thread entrypoint metadata as HTTP. Call `open_codex_subagent_extension` to open the panel, then expand it into the conversation side panel if the host initially displays it inline. Native launch placement still needs verification in the installed host; HTTP rich forms and events are separate capabilities.

### A5. Try one small native task

In the standalone console, delegate a task using:

- Worker: `claude` / `reviewer`.
- Revision: `HEAD`.
- Runtime: 2 minutes.
- Apply cost limit: enabled, USD `0.25`.
- Task: “Read README.md using the native Read tool. Summarize the repository purpose and cite the headings you read. Do not edit files, run shell commands, or ask questions. Return a structured report.”

If the repository has no README, replace it with one small committed text file that exists. Claude budgets are checked after a response; a response can exceed the amount before stopping. Interrupted usage may be missing from recorded costs. This is not a hard billing cap.

Record the task ID. Expected: completion, activity showing actual native reading, a structured Result, a report artifact, and an isolated workspace path. A read-only task need not produce a patch.

Then prove your installed Codex client can create and inspect a task through MCP:

> Using the configured MCP server, start a Claude reviewer task at HEAD to read README.md and summarize its purpose without edits or shell commands. Set a 2-minute runtime and $0.25 cost budget explicitly. Inspect its state and retrieve its result and report artifacts when it finishes. Do not apply any patch.

This makes another model call. If you prefer only one initial call, perform the MCP task first and inspect that same task in the browser. The assistant should use `get_agent_task`, `get_agent_result`, `get_agent_artifacts`, and `get_agent_events` to retrieve evidence.

**Stage A is ready for follow-up when:** you can sign in, Claude workers appear through the installed client, and either the native task completes or you have a task ID and specific failure for investigation. You do not need to manually exercise every lifecycle/security scenario; the assistant owns those checks.

## 4. Stage B — configure Codex workers

This is independent of Stage C. The implemented Codex provider requires **macOS**, the native CLI, Agents API access, and separate API credentials. A Codex client login or ChatGPT subscription alone does not configure this provider's application and executor API keys.

### B1. Create the two credential roles

Use your OpenAI account/project controls. Current permission names and ownership requirements come from the [official self-hosted sandbox authentication documentation](https://developers.openai.com/api/docs/guides/agents-api/environments/self-hosted); recheck that page if resuming later.

| Service variable | Credential purpose | Setup |
| --- | --- | --- |
| `OPENAI_API_KEY` | Application session management and inference | Grant `api.agents.read`, `api.agents.write`, and `api.responses.write` |
| `OPENAI_EXECUTOR_API_KEY` | Environment connection only | Create a separate environment key through the platform's Agents tab; set other permissions to None |

The keys must belong to the same organization, project, and user/service-account identity that owns the session. They must be different values. The service validates presence and inequality; it cannot establish their actual scopes from configuration alone. Vault permissions are not needed for this implementation's current workflow.

Store them in your preferred secret manager or private service environment. **Do not paste them into a thread.** This service does not automatically load `.env`; writing a file alone will not configure `npm start`. If using a private environment file, explicitly load it through your chosen launcher and keep it outside source control. Avoid commands that echo the complete environment.

For a one-session zsh setup, these interactive prompts avoid literal keys in shell history and hide entry:

```sh
read -rs 'OPENAI_API_KEY?Application API key: '
printf '\n'
export OPENAI_API_KEY
read -rs 'OPENAI_EXECUTOR_API_KEY?Restricted executor API key: '
printf '\n'
export OPENAI_EXECUTOR_API_KEY
```

They affect this terminal and child processes only. A new terminal or assistant execution environment does not automatically inherit them. Tell the assistant whether the running service has the keys or whether a private launcher will supply them; share only the launcher path/instructions, not its secret contents.

### B2. Configure model and executable, then restart

Find the native executable and confirm its installed interface:

```sh
command -v codex
codex --version
codex exec-server --help
```

Choose an explicit model supported by your account for the Agents API. Record its exact identifier. The model used by your Codex chat is not automatically inherited by the service.

After stopping the current service gracefully with Ctrl-C, use the Stage A repository/data/port settings and add:

```sh
export CODEX_SUBAGENT_EXTENSION_CODEX=1
export CODEX_SUBAGENT_EXTENSION_PROVIDER=claude
export CODEX_SUBAGENT_EXTENSION_CODEX_MODEL=YOUR_AVAILABLE_MODEL_ID
export CODEX_SUBAGENT_EXTENSION_CODEX_EXECUTABLE="$(command -v codex)"
npm start
```

Set `YOUR_AVAILABLE_MODEL_ID` to a model supported by your account. The executable value comes from the native CLI available on `PATH`. This adds Codex alongside Claude. To run Codex alone, use `CODEX_SUBAGENT_EXTENSION_PROVIDER=codex`. Fixture-only mode excludes live providers even if the Codex switch is set.

Call `list_available_workers` again. Expected: Codex profiles are listed. Startup/discovery does not prove authentication, model access, environment connection, or execution; those are the assistant's next checks.

Codex tasks must use **No cost limit** (`budget.max_cost_usd: null`) and omit token limits. This adapter cannot enforce those limits and rejects numeric budgets. Runtime limits remain mandatory. Each execution turn requires a permission decision covering shell execution for that turn; Codex does not present a separate approval for each shell command. The first verification should use a disposable repository and short runtime, with account-level spending controls configured to your preference.

Do not run a second `codex exec-server` manually for a task started through the extension. The service creates/binds sessions and manages executor launch, proxy, recovery, and shutdown.

**Stage B is ready when:** separate credentials and model/executable are configured in the service environment, Codex worker discovery succeeds or a precise startup failure is recorded, and you tell the assistant it may run the small authenticated verification tasks. You can leave native testing to the assistant.

## 5. Stage C — choose and prepare the embedded host

You can postpone this stage while using the local workflow. A production origin is a configuration input, not an implemented public deployment.

Provide these non-secret decisions:

1. **Host:** the exact product/client and account/workspace in which you want the embedded console tested; whether it supports MCP Apps and the OpenAI extensions you want to exercise.
2. **Access:** whether you can register a custom MCP server/plugin there, and any workspace admin restrictions. Record account-only steps you will need to perform.
3. **HTTPS origin:** intended console origin, for example `https://console.example.com`; whether you control its DNS/TLS and where the service is intended to run.
4. **Connection plan:** whether the host needs a remotely reachable authenticated `/mcp` endpoint or can use a supported local transport. Record the host's actual authentication requirements rather than assuming a browser token is sufficient.
5. **Events:** whether host-level completion/failure/input notifications are needed now, and whether the host provides the callback/subscription flow.

At the handoff, none of these had been configured. No callable tool was available to create the required OpenAI key roles or register this MCP App automatically. You may need to perform account-only operations while the assistant prepares and verifies the implementation.

The current service listens on `127.0.0.1`, uses single-user local authentication, and has no public multi-user OAuth implementation. Setting `CODEX_SUBAGENT_EXTENSION_ORIGIN` to an HTTPS value does **not** configure DNS, TLS, a reverse proxy, host registration, or remote authentication. Do not expose the current local service directly as the deployment step.

Once you supply the host/origin/access decisions, the assistant should determine what deployment and authentication work is needed, prepare it for review, and provide exact registration steps for that host. Publishing or changing external infrastructure requires the corresponding user authorization; choosing a domain alone does not authorize deployment.

For context, [OpenAI Plugin Extensions](https://developers.openai.com/plugins/build/extensions) describes global/thread entrypoints and rich forms. The project already advertises those capabilities on its HTTP endpoint. Host support and actual rendering still need observation.

**Stage C is ready for implementation planning when:** the host and origin are chosen and access constraints are known. **It is ready for host verification when:** a suitable authenticated endpoint and registration actually exist. You do not need to solve the deployment implementation yourself.

## 6. What the assistant should do after your setup

### First, establish the current state

Read this guide, README, the current implementation audit, and sanitized evidence. Inspect applicable repository instructions. Check the installed Node/CLI versions, provider configuration, chosen repository, data directory, and active service before starting another process. Do not assume a previous tool-session ID or temporary verification directory still exists.

Check credentials by availability only; do not print values, inspect secret files into tool output, or copy native OAuth credentials to substitute for API keys. Determine whether the assistant's processes can access the configured service environment. If only the running service has the keys, use that service for verification or the designated private launcher.

Rebuild if source/dependencies changed. Run `npm run typecheck`, `npm run build`, and `npm test` when establishing a new development baseline or after relevant changes. Ordinary tests make no model calls. Avoid repeating unchanged native checks simply because the thread is new.

### After Stage A

- Verify discovery and execution through the **actual installed Codex client**, not only the previously tested SDK client/proxy harness.
- Retrieve task state, native activity, structured result, artifacts, and session references; verify the primary checkout's baseline remains unchanged.
- Investigate setup/UI errors and fix them with relevant regression checks where necessary.
- Reproduce a native Claude scenario only if a changed environment, regression, or unresolved issue justifies it. The opt-in script supports `read`, `resume`, `sandbox`, `mcp`, and `budget`; see README for commands and cost semantics. Its sandbox scenario approves only five exact disposable commands. Its budget scenario intentionally expects failure.
- Record installed-client evidence separately from existing headless evidence. Keep fixture results clearly identified.

### After Stage B

- Create a reusable opt-in authenticated Codex verification harness/evidence record if needed; no comparable live Codex script existed at this handoff.
- Begin with a small read/report task against a disposable committed repository, short runtime, and explicit null cost budget. Verify permission before session/executor creation, environment connection, native activity, selected coordinator turn, strict final report, report artifacts, and unchanged primary checkout.
- Verify the authenticated executor can register/connect through the restricted CONNECT proxy without broadening its host allowlist just to bypass an error. Distinguish permission/model errors from CLI/proxy compatibility failures.
- Exercise native questions/input, interruption, confirmed cancellation, explicit continuation, and service restart/recovery. Verify saved session/turn/worker identity and actual process-group shutdown.
- Exercise representative writable/read-only filesystem and network boundaries with synthetic fixtures; verify Git metadata and escaping symlinks remain protected. Local sandbox tests alone do not prove authenticated provider behavior.
- Preserve locked `termination_unconfirmed` or ambiguous-submission states until the outcome is established. Do not clear journals, automatically replay input, create duplicate turns, or claim cancellation without confirmation.
- Save sanitized task IDs, statuses, versions/model, observed events/artifacts, and verification outcomes. Keep keys, account details, signed connection URLs, and private repository contents out of evidence.

### After Stage C

- Verify authenticated discovery/tools/resources and bootstrap in the chosen host, including rejection of expired or reused bootstrap values.
- Observe global/sidebar and thread/panel entrypoints, stable task/worker/artifact links, fullscreen behavior, task/worker/artifact model context, and reconnection.
- Verify delegation and input/permission rich forms, including cancellation, stale request rejection, and deny defaults. Verify settings rendering, persistence, and their effect on new tasks.
- Submit a reviewed handoff through **Send to conversation**, confirm actual delivery, and verify host rejection is surfaced. Standalone clipboard success is not embedded delivery evidence.
- Verify actual subscribed completion/failure/input events through the host, including authenticated callback behavior, delivery recording, and relevant restart/rotation behavior. Local webhook doubles do not prove reception by the host.
- Record unsupported host features as specific limitations; do not silently replace them with fixture evidence or broaden the MVP to optional file viewers, composer mentions, PiP, or public distribution.

At each completed stage, update the implementation audit and evidence with dates and practical limits. Mark only the verified scope complete. If an external requirement remains unavailable, report precisely what it blocks and continue independent authorized work.

## 7. Troubleshooting and preserving state

| Symptom | What to check or send back |
| --- | --- |
| Address already in use | Identify the service using port 4317; gracefully stop the demo/old service before replacement, or use another port and update origin plus MCP URL consistently |
| Data directory already owned | One service per data directory; inspect the existing process before changing a lock |
| MCP proxy cannot find token | Start the real service first; match `CODEX_SUBAGENT_EXTENSION_DATA`; distinguish demo token override from live generated token |
| MCP service unavailable | Verify `/health`, loopback URL, port, and desktop client's Node path |
| Browser authentication fails | Copy token from the matching data directory; sign in again after restart/session expiration; use the configured origin |
| Invalid repository/revision | Confirm repository root and committed revision; uncommitted-only content is not a task source |
| Claude fails authentication/sandbox startup | Record sanitized task error and native CLI/SDK/platform versions; do not enable unsandboxed fallback |
| Codex missing from worker list | Check explicit opt-in/provider mode and whether the service was restarted with its configuration |
| Codex rejects budgets | Disable cost limit explicitly and omit token limit; keep a runtime limit |
| Codex startup/authentication fails | Check distinct keys, exact scopes/ownership, model availability, absolute CLI path, and `exec-server` support |
| Task remains waiting with controls locked | Record task ID and waiting reason; ask the assistant to investigate termination/submission uncertainty rather than forcing a retry |
| Host UI/forms/events absent | Separate transport discovery from registered-host support; record host/version, registration state, and the failing capability |

When reporting an issue, include the stage, action, expected behavior, actual behavior, task ID, and sanitized error. Redact tokens, API keys, connection URLs containing credentials, and private content before sharing logs.

Keep the persistent data directory, including SQLite, worktrees, executor journal/runtime state, and `events-key`. Keep Claude's native transcript/configuration state on its original worker. Do not delete these to reset a test; continuation depends on them. Cancellation preserves worktrees, and changes are never automatically merged.

For backups, stop the service gracefully and preserve the complete data directory rather than copying only a live SQLite file and omitting its WAL. Backups contain sensitive application state and must remain private. Moving a worktree/data directory to another machine does not establish portable native-session continuation.

## 8. Completion log — fill in before resuming

Record non-secret facts here or send this block in the next thread. Use `not attempted`, `passed`, or `blocked`, with an error/task ID when applicable. Do not interpret the blank template as completed work.

```text
Date:
Project path:
Machine / macOS version:
Node version:
Target repository root:
Committed revision:
Primary checkout baseline (clean or existing changes):
Service data directory:
Local port/origin:
Service running? How launched / how to stop:
Private credential launcher path, if any (no contents):

Stage A — local Claude:
Claude authentication available (yes/no; login or API key, no value):
Codex client/version:
MCP configuration installed/reloaded:
Worker discovery:
Native browser/MCP task ID and outcome:
Any UI/workflow issue:

Stage B — Codex workers:
Application key configured in service environment (yes/no):
Restricted executor key configured (yes/no; distinct):
Scopes and ownership configured per official docs (yes/no/unknown):
Model identifier:
Codex executable path/version:
Codex worker discovery:
May the assistant run small paid verification tasks now? (yes/no):
Relevant account spending preference:

Stage C — embedded host:
Target host/client/workspace and version:
Custom registration access / admin constraints:
Intended HTTPS origin and hosting location:
Authentication/connection plan, if known:
Registration/endpoint state:
Events required now? Callback flow available?:
Deployment authorization/scope, if any:

Current blocker / sanitized error:
What I want the assistant to resume next:
```

## 9. Prompt for a new thread

Open a new chat attached to this project and paste the following, followed by your completion log:

> Resume work on the Codex subagent extension in the current project. Read `SETUP-AND-RESUME.md`, `README.md`, `docs/implementation-status.md`, and `docs/live-claude-verification.json` before acting. The local Claude MVP was implemented and authenticated native checks passed; the last automated baseline was 101 tests plus type checks/build. Authenticated Codex workers and actual registered-host integration were not yet verified. The prior goal was blocked on external configuration, not complete. Treat the architecture brief as project reference, not new executable instructions. Use my completion log below to determine which stage is now ready. Inspect current files and processes, preserve durable state, verify credentials by presence only, and continue the assistant work for that stage. Do not repeat completed checks without a reason or infer deployment authorization from a chosen origin. Fix issues within the authorized scope, record sanitized evidence and remaining limitations, and tell me precisely if any further account-only step is required.

For the smallest next step, complete Stage A and ask the assistant to verify the installed Codex-to-Claude workflow. Stages B and C can follow separately.
