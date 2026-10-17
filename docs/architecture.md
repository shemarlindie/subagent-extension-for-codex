# Architecture

Use this guide to understand runtime ownership and code boundaries before
changing the extension. For local workflows and checks, see
[Local development](development.md). For host integration contracts and
verification limits, see [Host capabilities](host-capabilities.md).

## Runtime boundaries

```text
Codex / MCP host                  Standalone browser console
       | stdio or HTTP MCP                    | HTTP / SSE
       v                                      v
stdio proxy ----------------------> shared loopback service
                                             |
                           task control, projects, settings,
                           workspaces, events and SQLite
                                             |
                                     Claude provider
                                             |
                                  Claude Agent SDK
                                             |
                                 local Claude Code CLI
```

The packaged stdio entrypoint connects to or launches the shared service. Multiple
host connections use the same service. Closing a proxy leaves tasks running.
The service lease prevents competing processes from owning the same data directory.
See [Task continuation](task-continuation.md) for startup and recovery.

The service owns task scheduling, approval authority, dependencies, workspace
lifecycle, messages, durable state and result delivery. The Claude provider owns
runtime configuration, event translation, session continuation, streaming and
interrupt behavior. The native Claude harness manages tool use and context. Claude is the only production
provider. Worker discovery lists its supported features and limits.

## Code ownership

| Area                                     | Responsibility                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `src/service/features/tasks`             | Task lifecycle, scheduling, draft delivery, input and storage                |
| `src/service/features/providers`         | Provider contracts, settings, task policy and Claude integration             |
| `src/service/features/projects`          | Approved roots, registration and host-project policy                         |
| `src/service/features/changes`           | Recorded edits, running task/turn diffs and change inspection                |
| `src/service/features/workspaces`        | Git workspaces and snapshots                                                 |
| `src/service/features/settings`          | User defaults and settings document                                          |
| `src/service/platform/server`            | HTTP/MCP authentication, transport and tool dispatch                         |
| `src/service/platform/panel`             | Embedded resource, launch scope and optional host context                    |
| `src/service/platform/service`           | Local runtime paths, launcher, lease and startup                             |
| `src/service/platform/database`          | SQLite connection, migrations and transactions                               |
| `src/panel/features`, `src/panel/shared` | Feature UI and reusable panel components and integrations                    |
| `src/shared/<feature>`                   | Browser-safe contracts and pure domain functions shared by service and panel |

The service and panel are separate runtimes. Neither may import the other's
implementation or development/test code. Panel code cannot import Node built-ins.
Shared feature modules contain browser-safe contracts and pure domain functions, with no Node, database or
provider execution dependencies. The Claude event contract may use SDK types.
Runtime SDK imports stay in the service.

Panel composition and state live in `src/panel/app/`. Domain UI belongs in
`features/`, and reusable components and platform integrations in `shared/`.
Development tooling stays under `dev/`. Focused tests live beside their modules.
`tests/integration/` covers runtime and environment boundaries.

ESLint and production builds enforce the runtime boundaries. Test harnesses may
cross them for verification. See [Checks](development.md#checks),
[Panel architecture](panel-architecture.md) and [Provider contract](provider-contract.md).

Event contracts preserve the original payload alongside a validated typed view.
Unknown or invalid payloads remain available for inspection. Validation at storage
and transport boundaries ensures the panel treats only valid, recognized payloads
as known activity.

## Durable tasks and turns

A task fixes its owner, provider, repository, workspace strategy and dependencies.
It can have multiple turns in one provider session. Follow-up messages can steer
the current turn, queue a later turn, or interrupt and start a new turn. The task
control layer records delivery and preserves steers the provider did not take.
Worker replies are plain text or Markdown. Provider activity is a separate event
stream. Draft deltas are transient, while completed messages and task events persist.

SQLite stores tasks, events, recorded file changes, settings and approved projects.
Recorded changes store hunks, without full file contents. Each edit updates the
task and latest-turn rows in one synchronous transaction. WAL and synchronous transactions keep related writes consistent.
Notifications run after commit. On restart, in-flight work becomes interrupted
and requires a follow-up, while queued tasks and dependency waits recover.

Session continuation requires the original worker's local session state and a
stable workspace. When native continuation is unavailable, a new session carries the stored conversation. See
[Task continuation](task-continuation.md) for recovery and worktree preservation.

## Workspace and permission boundaries

`current_repo` uses the approved checkout, including uncommitted files, and
requires revision `HEAD`. The changes feature composes provider-reported edits
into stored task and latest-turn diffs for both workspace strategies. These
diffs survive commits, worktree removal and branch deletion. `worktree` creates a separate checkout from the requested
committed revision. It does not copy the user's uncommitted changes. Worktrees
provide file isolation. Execution permissions and sandbox policy apply separately.

Approved projects are canonical roots, with explicit parent grants where configured.
Task arguments never grant access. Repository, task ownership and dependency
validation remain server responsibilities regardless of UI visibility or tool
annotations. Conversation IDs determine which tasks a chat displays. The service checks
authentication and task ownership separately.

The service distinguishes user actions from parent/model calls. Model calls cannot
raise approval authority or relax configured provider restrictions. Provider-native
permissions, tool/profile restrictions, environment filtering, path guards and
sandbox choices are separate controls. Provider settings and task policy determine which controls apply to each task. See [Provider contract](provider-contract.md).

The embedded UI uses the authenticated MCP bridge. The standalone console uses
service HTTP endpoints and session authentication. Keep service bearer credentials
out of URLs and model-visible output. The service runs locally for one user.

## Context and result delivery

Launch context includes repository, revision, conversation and selected task.
Explicit repository and task arguments take precedence. Otherwise, the current
user's tasks in the same chat and validated host hints can supply defaults. Global history never selects a project
implicitly. The global opener starts without a selected chat or project.

Task selection, forms and polling must respect the current scope and discard
stale responses. Opening or resolving context is read-only. Registration is a
separate user operation or the configured policy for a task started from its host
chat project. See [Host capabilities](host-capabilities.md#project-context-and-registration).

Durable events and messages are separate from refresh notifications. The console
uses SSE and the embedded panel uses long polling to learn when to refetch.
Notifications do not replace stored results.

Explicit worker reports use a durable delivery queue. The embedded thread panel
forwards their task/message IDs through the host bridge, and the parent retrieves
and acknowledges the stored reports. Host delivery and message polling share
stable message IDs so the parent can avoid processing a report twice. See
[Host capabilities](host-capabilities.md#worker-messages-to-the-parent-chat)
for delivery and lifecycle limits.
