# Architecture

Use this guide to understand runtime ownership and code boundaries before
changing the extension.

- [Local development](development.md) covers workflows and checks.
- [Host capabilities](host-capabilities.md) covers host integration contracts
  and verification limits.

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

One local service serves every host connection for one user. A data-directory
lease stops other processes from owning the same state. Closing a host
connection leaves tasks running.

The packaged stdio proxy connects to the service or launches it. It answers the
MCP handshake from its own tool definitions and connects in the background, so a
cold service start can't exceed the host's MCP startup timeout.

- Tool calls wait up to 60 seconds for the connection.
- When a call finds the service gone, the proxy starts a new one. It sends the
  call again when the service can't have received it, or when the call is
  read-only. See `src/service/platform/service/service-client.ts`.
- A new service that loses the lease to one still stopping starts again once the
  lease is free.
- When another program holds the port and no service owns the data directory,
  the proxy starts the service on the next free port. The service records its
  origin in `service.json`, where later proxies find it. A port set with `PORT`,
  `CODEX_SUBAGENT_EXTENSION_ORIGIN` or `CODEX_SUBAGENT_EXTENSION_URL` never
  moves, and startup reports the conflict instead.
- After a plugin update, the proxy asks an older service it started to drain.
  See [Updates and service handoff](task-continuation.md#updates-and-service-handoff).

[Task continuation](task-continuation.md) covers startup and recovery.

| Layer               | Owns                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Service             | Scheduling, approval authority, dependencies, workspace lifecycle, messages, durable state and results |
| Claude provider     | Runtime configuration, event translation, session continuation, streaming and interrupts               |
| Claude Code harness | Tool use and context                                                                                   |

Claude is the only production provider. Worker discovery lists its supported
features and limits.

## Code ownership

| Area                                     | Responsibility                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `src/service/features/tasks`             | Task lifecycle, scheduling, draft delivery, input and storage                |
| `src/service/features/providers`         | Provider contracts, settings, task policy and Claude integration             |
| `src/service/features/projects`          | Approved roots, registration and host-project policy                         |
| `src/service/features/workspaces`        | Git worktree lifecycle and prompt snapshots                                  |
| `src/service/features/changes`           | Recorded edits, running task and turn diffs, and change inspection           |
| `src/service/features/settings`          | User defaults and settings document                                          |
| `src/service/platform/server`            | HTTP and MCP authentication, transport and tool dispatch                     |
| `src/service/platform/panel`             | Embedded resource, launch scope and optional host context                    |
| `src/service/platform/service`           | Local runtime paths, launcher, lease and startup                             |
| `src/service/platform/database`          | SQLite connection, migrations and transactions                               |
| `src/service/platform/logging`           | Structured logs, crash logs and runtime metrics                              |
| `src/panel/app`                          | Panel composition, navigation and application state                          |
| `src/panel/features`, `src/panel/shared` | Feature UI and reusable panel components and integrations                    |
| `src/panel/transports`                   | Host bridge and standalone console transports                                |
| `src/shared/<feature>`                   | Browser-safe contracts and pure domain functions shared by service and panel |
| `dev/`                                   | Development tooling, the panel dev host and fixtures                         |

[Panel architecture](panel-architecture.md) covers the panel's internal layout.

### Import rules

ESLint and production builds enforce these boundaries. Test harnesses may cross
them for verification.

- The service and panel are separate runtimes. Neither imports the other's
  implementation or development and test code.
- Panel code can't import Node built-ins.
- Shared feature modules have no Node, database or provider execution
  dependencies. The Claude event contract may use SDK types, but runtime SDK
  imports stay in the service.

See [Checks](development.md#checks) and
[Provider contract](provider-contract.md).

### Tests

Focused tests live beside their modules, including feature integration tests
named `*.integration.test.ts`. `tests/integration/` covers runtime and
environment boundaries. See
[Choosing test coverage](development.md#choosing-test-coverage).

### Event payloads

Event contracts keep the original payload alongside a validated typed view.
Unknown or invalid payloads stay available for inspection. The panel treats a
payload as known activity only after it passes validation at the storage and
transport boundaries.

## Durable tasks and turns

A task fixes its owner, provider, repository, workspace strategy and
dependencies. It can run multiple turns in one provider session. A follow-up
message can steer the current turn, queue a later turn, or interrupt and start a
new one. Task control records delivery and keeps steers the provider didn't
take.

Worker replies are plain text or Markdown. Provider activity is a separate event
stream. Draft deltas are transient, while completed messages and task events
persist.

SQLite stores tasks, events, recorded file changes, settings and approved
projects. Recorded changes store hunks without full file contents. Related
writes commit in one transaction, and notifications run after commit. See
[Transactions and notifications](database.md#transactions-and-notifications).

On restart, in-flight turns become interrupted and need a follow-up. Queued tasks
and dependency waits recover.

Session continuation needs the original worker's local session state and a
stable workspace. When native continuation is unavailable, a new session carries
the stored conversation. See [Task continuation](task-continuation.md).

## Workspace and permission boundaries

| Strategy       | Workspace                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `current_repo` | The approved checkout, including uncommitted files. Requires revision `HEAD`.                   |
| `worktree`     | A separate checkout from the requested committed revision, without the user's uncommitted work. |

For both strategies, the changes feature stores provider-reported edits as task
and latest-turn diffs. See [Recorded changes](mcp-reference.md#recorded-changes).
Worktrees isolate files only. Execution permissions and sandbox policy apply
separately.

Approved projects are canonical roots, with explicit parent grants where
configured. Task arguments never grant access. The server validates
repositories, task ownership and dependencies whatever the UI shows or tool
annotations say. Conversation IDs decide which tasks a chat displays, and the
service checks authentication and task ownership separately.

The service distinguishes user actions from parent and model calls. Model calls
can't raise approval authority or relax configured provider restrictions.
Provider-native permissions, tool and profile restrictions, environment
filtering, path guards and sandbox choices are separate controls. Provider
settings and task policy decide which apply to each task. See
[Provider contract](provider-contract.md).

The embedded panel uses the authenticated MCP bridge. The standalone console
uses service HTTP endpoints and session authentication. Keep service bearer
credentials out of URLs and model-visible output.

## Context and result delivery

Launch context includes repository, revision, conversation and selected task.
Resolving it is read-only.
[Project context and registration](host-capabilities.md#project-context-and-registration)
owns precedence and registration rules. Task selection, forms and polling
respect the current scope and discard stale responses.

Refresh notifications only tell clients when to refetch durable events and
messages. The console uses SSE and the embedded panel uses long polling.

Explicit worker reports go through a durable delivery queue, and the parent
retrieves and acknowledges them by stable message ID. See
[Provider messages to the parent](mcp-reference.md#provider-messages-to-the-parent)
for the contract and
[Worker messages to the parent chat](host-capabilities.md#worker-messages-to-the-parent-chat)
for host delivery limits.
