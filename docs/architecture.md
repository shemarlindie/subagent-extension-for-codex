# Architecture

The extension delegates coding tasks to local Claude Code sessions while Codex
remains the parent interface. This describes the implemented system; host-specific
contracts and verification limits are in [Host capabilities](host-capabilities.md).

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
host connections use the same service; closing a proxy leaves tasks running.
The service lease prevents competing processes from owning the same data directory.
See [Setup and resume](setup-and-resume.md) for operational configuration.

The service owns task scheduling, approval authority, dependencies, workspace
lifecycle, messages, durable state and result delivery. The Claude provider owns
runtime configuration, event translation, session continuation, streaming and
interrupt behavior. It uses the native Claude harness rather than implementing
another tool-use or context-management loop. Claude is the only production
provider; provider discovery reports actual enabled capabilities.

## Code ownership

| Area                                     | Responsibility                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `src/service/features/tasks`             | Task lifecycle, scheduling, draft delivery, input and storage                |
| `src/service/features/providers`         | Provider contracts, settings, task policy and Claude integration             |
| `src/service/features/projects`          | Approved roots, registration and host-project policy                         |
| `src/service/features/workspaces`        | Git workspaces, snapshots and change inspection                              |
| `src/service/features/settings`          | User defaults and settings document                                          |
| `src/service/platform/server`            | HTTP/MCP authentication, transport and tool dispatch                         |
| `src/service/platform/panel`             | Embedded resource, launch scope and optional host context                    |
| `src/service/platform/service`           | Local runtime paths, launcher, lease and startup                             |
| `src/service/platform/database`          | SQLite connection, migrations and transactions                               |
| `src/panel/features`, `src/panel/shared` | Feature UI and reusable panel components and integrations                    |
| `src/shared/<feature>`                   | Browser-safe contracts and pure domain functions shared by service and panel |

Production source lives under `src/`, with separate runtime boundaries:

- `src/service/` owns Node execution, persistence, Git operations and server
  transports. Its entrypoints build the existing `dist/main.js`, `dist/stdio.js`
  and `dist/projects-cli.js` outputs.
- `src/panel/` owns the browser application. Application composition and state
  live in `app/`; domain presentation lives in `features/`; reusable panel
  primitives and helpers live in `shared/`.
- `src/shared/<feature>/` owns browser-safe contracts and pure domain functions
  used by both runtimes. Import these feature modules directly. Shared modules
  must not depend on service execution or panel rendering. Panel and shared
  modules cannot import Node built-ins; shared modules also exclude Claude SDK
  execution and database runtime dependencies.

ESLint enforces these production import boundaries against resolved source
paths, including re-exports, dynamic imports and type imports. Neither runtime
imports development or test code. Colocated tests, and the `*-test-harness.ts`
modules they share, can cross these boundaries for fixtures and verification.
Production builds also reject dependencies from the opposing runtime,
development tooling and tests. See
[Checks](development.md#checks) for the validation commands.

The service task feature groups scheduling and execution in `runtime/`,
questions, permissions and forms in `input/`, durable records in `storage/`,
and draft delivery and message polling in `conversation/`. Input can be answered
by the user or an authorized parent agent. Claude integration groups execution
and session handling in `runtime/`, SDK event translation in `events/`, and
executable selection and policy in `configuration/`. Browser-safe provider
options, settings and presentation remain in `src/shared/providers/`.

Development tooling lives outside production source. `dev/panel/` separates
host controls, scenarios, recording, recorded data and the fixture service.
`dev/service/` owns the demo worker and service, and `dev/database/` owns the
legacy migration utility. Focused tests stay beside their owning modules;
`tests/integration/` covers runtime and environment boundaries.

See [React UI](react-ui.md) for panel architecture,
[Local development](development.md) for tooling and
[Provider contract](provider-contract.md) for adapters.

## Durable tasks and turns

A task fixes its owner, provider, repository, workspace strategy and dependencies.
It can have multiple turns in one provider session. Follow-up messages can steer
the current turn, queue a later turn, or interrupt and start a new turn. The task
control layer records delivery and preserves steers the provider did not take.
Worker replies are plain text or Markdown; provider activity is a separate event
stream. Draft deltas are transient, while completed messages and task events persist.

SQLite stores tasks, events, settings, approved projects and form requests.
WAL and synchronous transactions protect related durable writes;
notifications run after commit. On restart, in-flight work becomes interrupted
and requires a follow-up, while queued tasks and dependency waits recover.
The service does not claim to recover an executing process mid-turn.

Session continuity requires the saved provider session ID, stable workspace,
matching session owner and available local session state. An ID alone cannot
move a resumable task to another machine. The provider receives explicit `cwd`
and `resume`; it does not resume whichever conversation happened to run last.
Removing a worktree retains the task branch for recreation; deleting the branch
removes that recovery route. See [Setup and resume](setup-and-resume.md).

## Workspace and permission boundaries

`current_repo` uses the approved checkout, including uncommitted files, and
requires revision `HEAD`. Change inspection compares Git snapshots to attribute
task and turn changes. `worktree` creates a separate checkout from the requested
committed revision; it does not copy the user's uncommitted changes. Worktrees
isolate files, but are not security sandboxes.

Approved projects are canonical roots, with explicit parent grants where configured.
Task arguments never grant access. Repository, task ownership and dependency
validation remain server responsibilities regardless of UI visibility or tool
annotations. Conversation IDs scope presentation; they are not authentication.

The service distinguishes user actions from parent/model calls. Model calls cannot
raise approval authority or relax configured provider restrictions. Provider-native
permissions, tool/profile restrictions, environment filtering, path guards and
sandbox choices are separate controls. Their effective policy is determined by
provider settings and task policy; do not assume all delegated workers have one
universal sandbox. See [Provider contract](provider-contract.md).

The embedded UI uses the authenticated MCP bridge. The standalone console uses
service HTTP endpoints and session authentication. Keep service bearer credentials
out of URLs and model-visible output. The local service is not a multi-tenant
hosted deployment or a cloud worker scheduler.

## Context and result delivery

Launch context includes repository, revision, conversation and selected task.
Explicit validated context wins; otherwise same-chat owned history and optional
validated host hints can supply defaults. Global history never selects a project
implicitly. The global opener deliberately starts without chat/project scope.

Task selection, forms and polling must respect the current scope and discard
stale responses. Opening or resolving context is read-only. Registration is a
separate user operation or the configured policy for a task started from its host
chat project. See [Host capabilities](host-capabilities.md#project-context-and-registration).

Internal task events support activity and persistence. Console progress uses SSE;
MCP callers retrieve task/message results. Explicit provider parent messages use
a durable queue. The mounted embedded thread panel claims them and forwards their task/message IDs through
the host message bridge. The parent retrieves the stored reports by ID or
through message polling; both paths share stable IDs for duplicate handling. See
[Host capabilities](host-capabilities.md#worker-messages-to-the-parent-chat)
for delivery and lifecycle limits.
