# Codex subagent extension

## Capability and Architecture Brief

### Summary

The Codex subagent extension lets Codex delegate coding work to specialized agents, starting with Claude.

Codex remains the primary coding interface. Delegated agents run tasks independently and can work concurrently.

The system is responsible for:

- starting delegated tasks
- tracking task state
- managing task dependencies
- streaming execution events
- isolating agent workspaces
- interrupting and continuing tasks
- preserving resumable agent session state
- requesting user input when needed
- collecting results and artifacts
- returning findings and code changes to Codex
- exposing a visual task console where the host supports plugin UI

Each task has its own context, permissions, workspace, lifecycle, dependencies, events, session state, and outputs.

---

# 1. Core Terms

**Codex subagent extension**  
The capability for delegating work and inspecting its progress, results, and artifacts.

**Agent**  
A coding worker or agent runtime.

**Task**  
A delegated unit of work executed by an agent.

**Worker Profile**  
A reusable role such as researcher, reviewer, debugger, implementer, refactorer, test engineer, or security reviewer.

**Control Plane**  
The backend responsible for task state, scheduling, dependencies, events, authentication, authorization, permissions, workspaces, session placement, and agent runtime management.

**Provider**  
The adapter between the control plane and an agent runtime, such as Claude Agent SDK or the OpenAI Agents API.

**Workspace**  
The isolated worktree, container, VM, or sandbox associated with a task.

**Artifact**  
An output produced by an agent, such as a diff, commit, report, test result, generated file, or log.

**Session State**  
Provider-specific state required to continue a previously started agent session.

---

# 2. System Model

```text
                         Developer
                            │
                            ▼
                         Codex
                     primary interface
                            │
                      delegate work
                            │
                            ▼
                    Agent Control Plane
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
   ClaudeAgentProvider          CodexAgentProvider
              │                           │
     Claude Agent SDK             OpenAI Agents API
              │                           │
   native Claude Code             Codex agent
        harness                    runtime
```

The Codex subagent extension adds three functions around delegated work.

**Delegation:** start tasks on other agents.

**Observability:** inspect status, dependencies, tools, files, tests, subagents, events, session state, and results.

**Control:** interrupt, continue, redirect, retry, inspect, cancel, or open a task workspace.

---

# 3. Claude Harness Boundary

Claude execution should use the native Claude Code harness through Claude Agent SDK.

```text
Agent Control Plane
        │
        ▼
ClaudeAgentProvider
        │
        ▼
Claude Agent SDK
        │
        ▼
native Claude Code harness
        │
        ├─ agent loop
        ├─ context management
        ├─ Read / Edit / Write
        ├─ Bash
        ├─ MCP
        ├─ permissions
        ├─ hooks
        ├─ subagents
        └─ session state
```

`ClaudeAgentProvider` is responsible for configuring, launching, observing, interrupting, and continuing Claude Agent SDK sessions.

It may configure:

```text
working directory
model
instructions
allowed tools
disallowed tools
MCP servers
permissions
hooks
budgets
subagent limits
```

The Agent Control Plane should not reimplement:

- Claude's agent loop
- Claude's tool-use loop
- Claude Code coding tools
- Claude's context-management behavior
- native Claude subagent orchestration

The control plane wraps the Claude harness rather than replacing it.

Advanced subagent behavior, including dynamic or parallel subagent workflows, should be enabled only where supported by the selected Claude Agent SDK and bundled Claude Code runtime versions.

## Claude Session Durability

Claude Agent SDK session state is associated with local Claude Code runtime state.

A `session_id` alone should not be treated as sufficient to move a resumable Claude task to an arbitrary replacement worker.

For resumable Claude tasks, the control plane should use one of these strategies:

```text
worker affinity
  keep the task on the worker that owns its session state

persistent volume
  place Claude session state on storage mounted by replacement workers

replicated session state
  copy required Claude runtime state into durable storage
  and restore it before continuation
```

The control plane should track the physical or logical location of resumable provider state separately from the provider session identifier.

Conceptually:

```text
session_id
  provider-level session identifier

session_state_ref
  control-plane reference to the state required
  to continue that session

session_owner
  current worker or runtime owner
```

A task should not be reported as resumable on another worker unless the required provider session state is available there.

---

# 4. Example Workflow

A developer asks Codex:

> Implement the permissions migration. Have Claude inspect the current authorization architecture, then independently review the completed implementation.

The resulting work might look like:

```text
Permissions migration

PRIMARY
● Codex · implementation

DELEGATED
✓ Claude · architecture investigation
● Claude · test coverage
○ Claude · final independent review
```

Where dependencies allow it, tasks can run concurrently.

Opening a delegated task might show:

```text
Claude · Test coverage

Status: Running
Workspace: claude-tests-42

✓ Inspect existing tests
✓ Identify missing permission cases
● Run integration suite
  ├─ 127 passed
  └─ 3 failed
○ Investigate failures
○ Produce findings

[Steer] [Interrupt] [Open workspace] [View diff] [Stop]
```

Claude is treated as an execution worker rather than as a separate chat interface.

---

# 5. Architecture

The execution layer and UI layer remain separate.

```text
┌──────────────────────────────────────────────────┐
│ Codex                                            │
│ skills + MCP tools                               │
│                                                  │
│ works without custom plugin UI                   │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────┴───────────────────────────┐
│ ChatGPT                                          │
│ skills + MCP tools + MCP App UI + Extensions     │
└──────────────────────┬───────────────────────────┘
                       │
                       ▼
                 OpenAI Plugin
                       │
                MCP server + skills
                       │
                       ▼
              ┌──────────────────┐
              │  Agent Control   │
              │      Plane       │
              │                  │
              │ tasks            │
              │ scheduling       │
              │ dependencies     │
              │ events           │
              │ auth             │
              │ permissions      │
              │ persistence      │
              │ workspaces       │
              │ session state    │
              └────────┬─────────┘
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
      Claude Agent SDK     OpenAI Agents API
             │                   │
   Claude Code harness      Codex runtime
```

The implementation has five conceptual layers:

1. plugin package and skills
2. MCP server, tools, resources, and events
3. MCP App UI and OpenAI Plugin Extensions
4. Agent Control Plane
5. agent providers

The MCP execution layer must remain usable without the UI layer.

---

# 6. OpenAI Plugin Package

The plugin should follow the current OpenAI plugin packaging model.

A portable package can be organized as:

```text
Extension plugin package

plugin.json

skills/
└── delegation/
    └── SKILL.md

mcp.json

.app.json    # optional OpenAI registered-app mapping
assets/      # optional
```

OpenAI-specific package metadata belongs inside the root `plugin.json` under `extensions.com.openai`.

Conceptually:

```text
plugin.json

name: ...
version: ...

extensions:
  com.openai:
    apps: "./.app.json"   # only if needed
    interface: ...
    hooks: ...
```

Only the OpenAI-specific fields actually used by the implementation should be included.

`.app.json` should only be present when the selected OpenAI integration requires a registered-app mapping.

The MCP server exposes:

```text
MCP server for the Codex subagent extension

├── task tools
├── artifact tools
├── control tools
├── MCP Events
├── MCP resources
└── MCP App UI resources
      └── OpenAI extension metadata
```

The MCP App is not a separate agent runtime or separate backend service.

Its UI resources are registered and served through the MCP integration.

Skills guide Codex and ChatGPT through delegation workflows.

The MCP server provides task operations, resources, subscriptions, and UI resources.

OpenAI-specific extensions attach the MCP App to additional ChatGPT surfaces.

---

# 7. Plugin Extensions Plan

The extension should explicitly target the current OpenAI Plugin Extensions API.

The portable MCP Apps implementation should be built first.

OpenAI-specific extensions should be added where they provide functionality beyond the shared MCP Apps standard.

## Global Entry Point

Register the Codex subagent extension as a global ChatGPT entrypoint.

Purpose:

- view all active tasks
- inspect recently completed tasks
- start delegated work
- inspect artifacts
- manage worker defaults

Conceptual metadata:

```text
ui.resourceUri = "ui://codex-subagent-extension/app"

openai/ui.entrypoints:
  - type: global
```

The global entrypoint opens the extension interface.

## Thread Entry Point

Register a thread entrypoint using the same MCP App.

Purpose:

- show tasks associated with the current conversation
- inspect delegated work without leaving the conversation
- steer active tasks
- inspect results related to the current workflow

Conceptual metadata:

```text
openai/ui.entrypoints:
  - type: thread
```

The global and thread views use the same backend and task model.

## Plugin Settings

Plugin settings can store user-level defaults such as:

```text
default provider
default worker profile
default workspace strategy
default runtime budget
default cost budget
approval policy
notification preferences
```

Project-specific task state should remain in the Agent Control Plane.

## Deep Links

Tasks and artifacts should have stable application routes.

Examples:

```text
/tasks/task_8af72
/tasks/task_8af72/artifacts/diff_31
/workers/claude.reviewer
```

Deep links can open the extension interface directly to a task, result, worker, or artifact where the host supports them.

## Model-App Context

Selected UI state should be synchronized with the model through the portable MCP Apps model-context mechanism when possible.

The preferred portable path is:

```text
ui/update-model-context
```

Example:

```text
User selects:

Claude · Integration Tests
    ↓
Failure #3
```

The app can expose concise state:

```text
selected_task: task_8af72
selected_artifact: test_failure_3
summary: "Session cleanup race reproduced in auth integration tests."
```

Context sharing should be:

- structured
- concise
- scoped to the selected object
- free of unnecessary logs or large artifacts

Large content remains accessible through MCP tools or resources.

OpenAI-specific Model-App Context extensions can be layered on only where the shared MCP Apps mechanism does not cover the required behavior.

## Rich Forms

Rich forms can handle structured actions.

Example:

```text
Delegate task

Worker
○ Claude Reviewer
○ Claude Test Engineer
○ Claude Implementer

Workspace
○ Read-only
○ Git worktree
○ Sandbox

Budget
Runtime: 20 minutes
Cost: $5
```

They can also handle human-input requests:

```text
Claude needs a decision

○ preserve deprecated endpoint
○ add compatibility adapter
○ allow breaking change
```

These interactions map to task tools such as:

```text
submit_agent_input
```

Where the registered-server flow requires multiple round trips, the implementation should use the supported multi-round-trip form pattern.

## File Entry Points

File-specific UI is optional.

Useful artifact types include:

```text
.diff
.patch
.log
.md
test reports
review reports
```

Custom viewers could provide:

- side-by-side diffs
- test output
- review findings
- generated reports

Direct source-code editing through the plugin is not required for the initial implementation.

The task workspace remains the authoritative location for code changes.

---

# 8. Entry Points and Display Modes

Entrypoints and display modes are separate concepts.

## Entry Points

Entrypoints determine where the application appears.

```text
global
  full extension interface

thread
  conversation-scoped extension interface

file
  optional artifact viewer
```

## Display Modes

Display modes determine how a UI resource is presented.

```text
inline
  compact task or result view

fullscreen
  detailed task, artifact, or console view

pip
  optional running-task monitor
```

Picture-in-picture can be useful for a running task that should remain visible while the user continues working elsewhere.

The same task state should back all presentation modes.

---

# 9. Composer Mentions

Composer mentions are optional.

Possible examples using a generic subagent mention:

```text
@subagent task_8af72
@subagent architecture-review
@subagent diff_31
```

They are not required for the first release.

Because extension availability varies by client and feature, the architecture must not depend on composer mentions.

---

# 10. MCP App Networking

The MCP App runs inside a host-controlled UI environment and should declare its network requirements explicitly.

A production UI resource should declare its dedicated origin and Content Security Policy.

Conceptually:

```text
_meta.ui:

  domain:
    https://console.example.com

  csp:
    connectDomains:
      - https://api.example.com

    resourceDomains:
      - https://static.example.com
```

The exact production domains should be stable and narrowly scoped.

`connectDomains` should include only services the UI actually needs to contact.

The UI should not receive direct runtime credentials for Claude or Codex.

## UI-to-Backend Authentication

Authentication for MCP requests and authentication for direct iframe network requests should be treated separately.

The host's MCP authorization context should not be assumed to automatically authenticate arbitrary iframe `fetch`, SSE, or `EventSource` connections to the Codex subagent extension backend.

The UI should establish its own short-lived application session.

Do not expose:

- MCP OAuth access tokens
- Claude credentials
- OpenAI provider credentials
- reusable application bearer credentials

through MCP tool results or model-visible content.

If an authenticated MCP interaction participates in establishing the UI session, it should use an opaque, narrowly scoped bootstrap mechanism rather than returning a reusable credential.

One possible flow is:

```text
ChatGPT
   │
   │ authenticated MCP interaction
   ▼
MCP Server
   │
   ├─ validate identity
   ├─ authorize application access
   └─ create single-use bootstrap state
             │
             ▼
        MCP App iframe
             │
             │ secure bootstrap exchange
             ▼
      Extension API
             │
             ▼
   scoped browser session
             │
             ▼
    authenticated SSE
```

The browser session should be established through a secure application mechanism such as an HttpOnly cookie where appropriate.

The bootstrap mechanism should be:

- opaque
- short lived
- single use where practical
- scoped to the authenticated user
- scoped to permitted tasks or projects
- invalid after successful exchange or expiration

The resulting application session should be:

- short lived
- scoped
- revocable where practical
- protected against cross-site misuse
- unusable as a Claude or OpenAI provider credential

Provider credentials must remain server-side.

---

# 11. UI Architecture

The MCP App should not communicate directly with Claude or Codex runtimes.

```text
Plugin Extension UI
        │
        │ MCP App bridge
        ▼
     MCP Server
        │
        ▼
 Agent Control Plane
        │
   ┌────┴────┐
   ▼         ▼
Claude     Codex
```

The UI operates on provider-neutral task objects.

Task mutations should normally go through MCP tools.

For example:

```text
interrupt_agent_task
continue_agent_task
send_agent_instruction
cancel_agent_task
submit_agent_input
```

This keeps authorization and task semantics in the server rather than in the UI.

---

# 12. Delegation Interface

The MCP server should expose a small provider-neutral tool surface.

```text
start_agent_task
get_agent_task
list_agent_tasks
list_available_workers

send_agent_instruction
interrupt_agent_task
continue_agent_task
cancel_agent_task

submit_agent_input

get_agent_result
get_agent_artifacts
get_agent_events
```

Example:

```text
start_agent_task(
  provider = "claude",
  role = "reviewer",
  task = "Independently review the permissions migration.",
  repository = "current",
  revision = "feature/permissions",
  context = ["diff", "tests"],
  depends_on = ["task_impl_17"],
  workspace_strategy = "worktree",
  budget = {
    max_runtime_minutes: 20,
    max_cost_usd: 5
  }
)
```

Response:

```text
task_id: task_8af72
status: queued
```

Starting a task creates durable asynchronous work.

```text
Codex
  │
  ├─ implement feature
  │
  ├─ start_agent_task(...)
  │        │
  │        └── delegated worker runs independently
  │
  ├─ continue primary work
  │
  └─ retrieve delegated result later
```

---

# 13. Worker Discovery

The control plane can expose available workers.

```text
available_workers

claude.researcher
claude.debugger
claude.implementer
claude.refactorer
claude.reviewer
claude.test_engineer
claude.security_reviewer

codex.worker
```

Claude workers use Claude Agent SDK and the native Claude Code harness.

`codex.worker` can use the OpenAI Agents API.

Both providers map into the same control-plane task model.

A higher-level delegation primitive can map onto the task API.

```text
delegate(
  worker = "claude.reviewer",
  task = "Independently inspect the payment retry changes.",
  context = ["commit", "tests"],
  mode = "async"
)
```

---

# 14. Concurrent Agents

The control plane should support multiple active tasks.

```text
                    Feature request
                          │
             ┌────────────┼────────────┐
             ▼            ▼            ▼
        Architecture   Implementation  Tests
          Claude          Codex       Claude
             │            │            │
             └────────────┼────────────┘
                          ▼
                  Independent review
                        Claude
```

Three common patterns are supported.

## Specialized Parallelism

```text
Claude · Researcher
Claude · Test Engineer
Claude · Security Reviewer
Codex  · Implementer
```

## Independent Verification

```text
Implementation
     │
     ▼
    patch
     │
     ▼
Independent reviewer
     │
     ▼
findings
     │
     ▼
Codex evaluates result
```

The reviewer should receive code, diffs, commits, tests, or artifacts rather than the implementation agent's private reasoning.

## Independent Attempts

```text
                 Same problem
                      │
             ┌────────┴────────┐
             ▼                 ▼
          Codex             Claude
        solution A        solution B
             │                 │
             └────────┬────────┘
                      ▼
               compare / review
```

---

# 15. Runtime Providers

## Claude

`ClaudeAgentProvider` uses Claude Agent SDK as its harness boundary.

```text
Agent Task
    │
    ▼
ClaudeAgentProvider
    │
    ▼
Claude Agent SDK
    │
    ▼
native Claude Code harness
    │
    ├─ Read / Search
    ├─ Edit / Write
    ├─ Bash
    ├─ MCP
    ├─ hooks
    └─ subagents
```

Relevant capabilities include:

- persistent multi-turn sessions on the runtime that owns the required session state
- streamed execution activity
- interruption
- hooks
- MCP
- filesystem access
- command execution
- native coding tools
- subagents

Where supported by the selected Claude Agent SDK and bundled Claude Code runtime versions, the provider can also expose:

- parallel subagent workflows
- dynamic subagent workflows
- configurable subagent concurrency or depth limits

The extension should configure these capabilities rather than reproduce them.

A Claude session should only be considered portable across workers when the session state required by the bundled Claude Code runtime is available to the destination worker.

## Codex

`CodexAgentProvider` can use the OpenAI Agents API.

Relevant capabilities include:

- durable sessions
- asynchronous turns
- event streaming
- webhooks
- steering
- cancellation
- artifacts
- subagents
- hosted or self-hosted execution environments

Both providers map into the same task, event, artifact, and result abstractions.

---

# 16. Task Lifecycle

A task is durable asynchronous work.

```text
             ┌────────┐
             │ Queued │
             └───┬────┘
                 ▼
            ┌─────────┐
            │ Running │
            └────┬────┘
                 │
       ┌─────────┼──────────┐
       ▼         ▼          ▼
    Waiting  Interrupted   Failed
       │         │
       └────┬────┘
            ▼
         Running
            │
            ▼
        Completed
```

Core states:

```text
queued
starting
running
waiting
interrupted
completed
failed
cancelled
```

Waiting reasons:

```text
waiting_for_user
waiting_for_permission
waiting_for_dependency
```

`interrupt` stops the current execution while preserving task or session state where the provider supports that behavior.

`continue` begins another turn using preserved session or task context.

For Claude, continuation also requires access to the Claude Code runtime state associated with the session.

This should not be described as guaranteed instruction-pointer-level pause and resume.

`cancel` terminates the task.

`retry` creates another attempt after failure or cancellation.

---

# 17. Task Dependencies

Task ordering should use explicit dependencies.

```text
task_research
     │
     ├──────────────┐
     ▼              ▼
task_build      task_tests
     │              │
     └──────┬───────┘
            ▼
      task_review
```

Example:

```text
depends_on = [
  "task_build",
  "task_tests"
]
```

`parent_task_id` represents hierarchy or ownership.

`depends_on[]` represents execution ordering.

The scheduler should evaluate dependencies before starting a task.

---

# 18. Live UI Events

The extension UI needs high-frequency progress updates.

These should use a normal application data connection rather than MCP Events.

```text
Agent runtime events
       │
       ▼
 Event Normalizer
       │
       ▼
    Event Store
       │
       ▼
    live stream
       │
       ▼
      SSE
       │
       ▼
 MCP App UI
```

SSE is the preferred initial implementation for live console progress.

It is sufficient for:

- progress updates
- command activity
- live logs
- file-change notifications
- subagent activity
- state transitions

Task mutations should continue to use MCP tools.

WebSocket can be added later if there is a concrete need for a persistent bidirectional application channel.

The MCP App's CSP must permit the chosen live-stream origin.

The SSE endpoint must require the scoped application session described in Section 10.

---

# 19. MCP Events

MCP Events are separate from live console streaming.

They should be used for lower-volume host-level subscriptions such as:

```text
agent_task.completed
agent_task.failed
agent_task.input_required
```

Optional:

```text
agent_task.started
agent_task.interrupted
```

MCP Events should not carry high-volume tool logs or token-by-token execution data.

## Protocol Requirements

The current ChatGPT MCP Events integration should be implemented using the MCP Events protocol expected by OpenAI.

The MCP server should support the required event capabilities and methods, including:

```text
events/list
events/subscribe
events/unsubscribe
```

Event capabilities should be advertised through the server discovery flow.

For the current OpenAI integration, event delivery should use subscribed webhooks.

The implementation should account for the currently required MCP protocol version used by the OpenAI MCP Events integration rather than treating Events as a generic legacy MCP capability.

## Event Catalog

Initial events:

```text
agent_task.completed
agent_task.failed
agent_task.input_required
```

Filters can include:

```text
task_id
project_id
provider
```

A completion event can use an envelope such as:

```text
eventId: evt_456

name:
  agent_task.completed

timestamp:
  2026-09-30T14:05:00Z

data:
  task_id: task_8af72
  provider: claude
  worker_profile: reviewer
  summary: "Review complete with two findings."
  result_available: true

cursor: null
```

The exact event envelope should follow the current MCP Events schema supported by OpenAI.

Large results should not be embedded in event payloads.

The full result remains available through:

```text
get_agent_result(task_id)
get_agent_artifacts(task_id)
```

## Subscription Requirements

Subscriptions should be:

- authenticated
- authorized
- persisted
- scoped to resources visible to the requesting user
- removable
- resilient to reconnects and retries

Webhook delivery should include:

- callback verification
- supported webhook signing
- replay protection where applicable
- retry handling
- idempotent event processing

MCP Event subscriptions must use the same ownership model as the rest of the control plane.

---

# 20. Two Event Channels

The system has two distinct event paths.

```text
                   Agent Control Plane
                           │
             ┌─────────────┴─────────────┐
             │                           │
             ▼                           ▼
       Live App Events              MCP Events
             │                           │
            SSE                       webhook
             │                           │
             ▼                           ▼
       Subagent delegation                       ChatGPT
```

**Live App Events**

Purpose:

- progress bars
- command activity
- live logs
- file changes
- subagent activity

**MCP Events**

Purpose:

- task completion
- task failure
- user input required
- host-level subscriptions and monitoring

---

# 21. Completion Delivery

Completion does not require continuous polling.

There are three delivery paths.

## Pull

```text
get_agent_task(task_id)
get_agent_result(task_id)
```

## Live Progress Updates

The UI receives `task.completed` over the authenticated live SSE stream.

## MCP Event

If the user or host has created a subscription:

```text
agent_task.completed
```

can be delivered through the MCP Events webhook path.

The architecture should not assume that an ordinary MCP tool request can asynchronously inject another model message into an existing Codex conversation after the original request has returned.

---

# 22. Canonical Internal Event Model

Provider-specific activity maps into a common internal event model.

```text
task.started
task.interrupted
task.continued

agent.started
agent.completed

tool.started
tool.completed

command.started
command.completed

file.read
file.changed

subtask.started
subtask.completed

agent.message
agent.input_required

artifact.created

task.completed
task.failed
task.cancelled
```

Example:

```text
type: command.completed
task_id: task_8af72
agent: claude.test_engineer
command: npm test auth
exit_code: 1
timestamp: ...
```

These internal events are more detailed than the public MCP Events catalog.

---

# 23. Task Data Model

```text
AgentTask

id
parent_task_id
conversation_id

depends_on[]

provider
worker_profile

status
waiting_reason

task
context

repository
revision

workspace
workspace_strategy

session_id
session_owner
session_state_ref

budget

created_at
started_at
completed_at

events[]
artifacts[]
children[]

result
error
```

`session_state_ref` is a control-plane reference to any provider state required to continue the session.

For Claude, it may identify:

```text
worker affinity
persistent volume
replicated runtime-state location
```

It should not contain provider credentials.

The control plane should validate that required session state is available before dispatching a continuation to another worker.

## Budget

```text
AgentBudget

max_runtime_minutes
max_cost_usd
max_tokens
```

Enforcement differs by provider.

```text
max_runtime_minutes
  control-plane enforced

max_cost_usd
  provider-native where available
  otherwise monitored by control plane

max_tokens
  provider-dependent
```

Unsupported limits should be exposed through provider capabilities rather than silently ignored.

## Artifact Model

```text
AgentArtifact

id
task_id

type:
  report
  diff
  file
  test_result
  log
  commit

title
path
mime_type
content_reference
created_at
```

Large content should remain in artifacts rather than task records or event payloads.

---

# 24. Result Contract

Agent results should be structured.

```text
AgentResult

status
summary
findings[]
evidence[]
changes[]
tests[]
recommendations[]
artifacts[]
```

Example:

```text
summary:
Session cleanup races with async token refresh.

evidence:
- src/session/refresh.ts:83
- test/session.test.ts:219

tests:
- auth suite: 127 passed, 3 failed

recommendations:
- serialize cleanup behind refresh completion

artifacts:
- investigation report
- test log
```

Implementation workers may return changes and tests.

Research and review workers may return findings and evidence without modifying code.

---

# 25. Worker Profiles

Initial profiles:

```text
Claude · Researcher
Claude · Debugger
Claude · Test Engineer
Claude · Architecture Reviewer
Claude · Security Reviewer
Claude · Reviewer
Claude · Refactorer
Claude · Implementer

Codex · Worker
```

A profile can define:

```text
instructions
model

allowed tools
disallowed tools
MCP servers

permissions
workspace policy

budget
resource limits

result expectations
```

Example:

```text
Architecture Reviewer

Purpose
Read and analyze architecture without changing code.

Allowed
✓ repository reads
✓ search
✓ git history

Disallowed
✗ file modification
✗ destructive commands

Expected result
✓ findings
✓ evidence
✓ recommendations
```

Provider-specific capabilities should determine whether a requested profile can actually be executed.

---

# 26. Workspace Isolation

Concurrent coding agents should not normally modify the same checkout.

```text
repository
 │
 ├─ main workspace
 │    └─ Codex
 │
 ├─ worktree/task-41
 │    └─ Claude · tests
 │
 └─ worktree/task-42
      └─ Claude · alternative implementation
```

Workspace strategies:

```text
current
worktree
container
sandbox
```

For stronger isolation:

```text
Agent task
    │
    ▼
ephemeral container / sandbox
    │
    ▼
repository checkout
    │
    ▼
native agent runtime
    │
    ▼
diff / commit / report
```

Workers should return inspectable changes before those changes affect the primary workspace.

If a workspace also contains provider session state required for continuation, its lifecycle must account for both code isolation and session durability.

---

# 27. Human Input and Control

Useful controls include:

```text
[Steer]
[Interrupt]
[Continue]
[Stop]
[Retry]
[Open workspace]
[View output]
[View diff]
[Send to Codex]
```

A task may wait for a user decision:

```text
Claude needs input

The migration requires one of:

○ preserve deprecated endpoint
○ introduce compatibility adapter
○ break backward compatibility
```

The task enters:

```text
status: waiting
waiting_reason: waiting_for_user
```

The response is submitted through:

```text
submit_agent_input(
  task_id,
  input
)
```

In the ChatGPT extension UI, a rich form can represent this decision where supported.

---

# 28. Provider Abstraction

```text
AgentProvider

start(task)

interrupt(task)
continue(task)
cancel(task)

sendInstruction(task, message)
submitInput(task, input)

streamEvents(task)

getResult(task)
getArtifacts(task)

getCapabilities()
```

Initial providers:

```text
ClaudeAgentProvider
  → Claude Agent SDK
  → native Claude Code harness

CodexAgentProvider
  → OpenAI Agents API
  → Codex agent runtime
```

Capabilities may include:

```text
interrupt
session_continue
session_state_portable
native_pause_resume

interactive_input
subagents
parallel_subagents
dynamic_subagents

filesystem_write
shell
worktree
sandbox

token_budget
cost_budget
runtime_budget
```

Capabilities such as `session_state_portable`, `parallel_subagents`, `dynamic_subagents`, or native execution limits should be advertised only when supported by the selected runtime and deployment configuration.

The control plane validates requested features before starting or continuing a task.

Provider-specific runtime details should remain behind the provider boundary.

---

# 29. Authentication and Ownership

The control plane identifies both the requesting user and the owner of every delegated session.

A task must carry enough ownership information to enforce:

- who can inspect it
- who can steer it
- who can cancel it
- who can access its workspace
- which credentials it can use
- which artifacts it can expose
- which session state it can resume
- which MCP Events it can subscribe to

The runtime should not receive broader credentials than the task requires.

Authorization checks belong in the control plane.

The MCP App UI session should derive its authorization from the same ownership model rather than creating a separate permission system.

Session-state storage must use the same ownership and isolation rules as the associated task.

---

# 30. Console UX

The primary global UI is the extension's task workspace.

```text
┌────────────────────────────────────────────────────┐
│ Subagent work                               + Delegate │
├────────────────────────────────────────────────────┤
│                                                    │
│ Permissions migration                              │
│                                                    │
│ PRIMARY                                            │
│ ● Codex   Implementation                   08:14   │
│                                                    │
│ DELEGATED                                          │
│ ✓ Claude  Architecture review              03:17   │
│ ● Claude  Integration tests                04:52   │
│ ◐ Claude  Security review             interrupted │
│ ○ Claude  Final review                        --   │
│                                                    │
├────────────────────────────────────────────────────┤
│ Claude · Integration tests                         │
│                                                    │
│ ✓ Inspected coverage                               │
│ ✓ Added edge cases                                 │
│ ● Running test suite                               │
│   412 passed · 2 failed                            │
│                                                    │
│ [Workspace] [Diff] [Steer] [Interrupt] [Stop]     │
└────────────────────────────────────────────────────┘
```

The global entrypoint shows the full console.

The thread entrypoint presents a narrower view scoped to the current conversation.

The same provider-neutral task objects back both views.

---

# 31. Security Boundary

```text
Codex / ChatGPT
       │
       ▼
Plugin + MCP
       │
       ▼
Agent Control Plane
       │
       ▼
isolated worker
       │
       ├── Claude Agent SDK
       │     └── Claude Code harness
       │
       └── OpenAI Agents API environment
```

The control plane should enforce:

- authentication
- authorization
- task ownership
- session ownership
- session-state ownership
- workspace isolation
- tool restrictions
- command policies
- scoped credentials
- network policy
- audit logs
- runtime limits
- cost and token budgets where supported
- approvals for sensitive actions
- read-only versus write-capable worker profiles

The MCP App should receive only the permissions required for its UI operations.

Direct UI-to-backend connections should use a short-lived scoped application session, not provider credentials or reusable tokens returned by MCP tools.

MCP Event subscriptions must be authorized against the same ownership model.

---

# 32. Implementation Phases

## Phase 1: Headless Claude Delegation

Implement:

```text
Codex
  ↓
MCP tools
  ↓
Agent Control Plane
  ↓
ClaudeAgentProvider
  ↓
Claude Agent SDK
  ↓
native Claude Code harness
  ↓
isolated worktree
```

Support:

- start task
- inspect task
- live backend events
- interrupt
- continue
- steer
- cancel
- artifacts
- results
- human input
- Claude session-state tracking
- worker affinity or persistent session-state storage

This validates the runtime and task model without depending on custom UI.

## Phase 2: MCP App

Build the portable extension UI through MCP UI resources.

Add:

- task list
- task detail
- live status
- task controls
- artifacts
- diff viewer
- human-input UI
- production UI origin
- CSP declaration
- authenticated SSE connection for live progress
- secure UI session bootstrap
- scoped browser application session

Do not return reusable UI credentials through tool results.

Task mutations continue through MCP tools.

## Phase 3: Plugin Extensions

Add OpenAI-specific extension surfaces:

```text
global entrypoint
thread entrypoint
plugin settings
deep links
Model-App Context
rich forms
display modes
optional file entrypoints
```

Use `ui/update-model-context` as the portable mechanism for model-visible app context where possible.

Composer mentions remain optional.

## Phase 4: MCP Events

Add:

```text
agent_task.completed
agent_task.failed
agent_task.input_required
```

Implement the current OpenAI-supported MCP Events protocol, including:

```text
event capability discovery
events/list
events/subscribe
events/unsubscribe
```

Also implement:

- persistent subscription storage
- subscription authorization
- webhook callback validation
- supported webhook signing
- retry handling
- idempotent processing
- compact event payloads
- full-result retrieval through tools

MCP Events remain separate from high-frequency Codex subagent extension streaming.

## Phase 5: Codex Worker Provider

Add:

```text
CodexAgentProvider
  → OpenAI Agents API
  → Codex runtime
```

Use the same task, artifact, result, dependency, and event abstractions.

## Phase 6: Task Graphs

Add explicit dependencies and parallel branches.

```text
                    User request
                         │
                         ▼
                       Codex
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
          Research     Build       Tests
           Claude      Codex       Claude
              │          │          │
              └──────────┼──────────┘
                         ▼
                  Claude review
                         │
                         ▼
                  Codex synthesis
```

---

# 33. Platform Boundaries

The design must distinguish between portable plugin functionality, ChatGPT-specific extensions, Codex functionality, and provider-specific runtime capabilities.

## ChatGPT and Codex

The core plugin can provide:

```text
skills
MCP tools
provider-neutral task operations
```

These are the foundation of delegation.

## MCP App UI

The UI should use the MCP UI-resource model so that the execution architecture does not depend on OpenAI-specific presentation features.

Portable MCP Apps mechanisms should be preferred when they provide the required behavior.

For model-visible application context, use the shared MCP Apps mechanism such as:

```text
ui/update-model-context
```

where supported.

## OpenAI Plugin Extensions

OpenAI-specific extension capabilities can include:

```text
global entrypoints
thread entrypoints
plugin settings
file viewers and editors
display modes
deep links
Model-App Context
composer mentions
rich forms
```

These are enhancements around the portable MCP layer.

They should not become dependencies of the delegation system.

Extension availability can vary by ChatGPT client and feature.

Composer mentions should therefore be treated as optional rather than as a required navigation mechanism.

## Codex UI

Equivalent rich Plugin Extension surfaces should not be assumed to exist inside Codex unless OpenAI explicitly documents them.

Codex must remain capable of using the extension's MCP tools and skills without rendering the custom console UI.

## Claude

Claude execution should use Claude Agent SDK and the native Claude Code harness.

The extension must not replace Claude's own coding loop or native subagent behavior.

Advanced subagent and orchestration features must be capability-gated according to the installed Agent SDK and bundled Claude Code runtime versions.

Claude session continuation must also account for the locality of Claude Code session state.

---

# 34. Public Distribution

Private, internal, developer-mode, and public distribution have different integration considerations.

If the extension is published as a public plugin, verify compliance with:

- OpenAI plugin publication requirements
- OpenAI rules for third-party integrations
- Anthropic terms applicable to Claude and Claude Code
- authorization requirements for any external provider accounts
- trademark and branding requirements

The plugin should not be presented as an official OpenAI or Anthropic product unless such authorization exists.

A public listing should describe the extension's orchestration and development capabilities, not present it as an unofficial pass-through connector to another provider.

Public submission requirements should be rechecked immediately before distribution because plugin guidelines can change.

---

# 35. Initial Scope

The first implementation should support:

- Codex creating Claude tasks through MCP
- Claude execution through Claude Agent SDK and the native Claude Code harness
- asynchronous Claude execution
- concurrent tasks
- task dependencies
- interruption and continuation
- durable tracking of Claude session-state location
- worker affinity or shared persistence for resumable Claude sessions
- steering and cancellation
- isolated workspaces
- structured results
- artifacts and diffs
- human-input requests
- authenticated live SSE event streaming
- provider-neutral runtime abstraction
- runtime capability detection for optional Claude features

The first UI implementation should use MCP App UI resources and be structured from the beginning for:

- a global Plugin Extension entrypoint
- a thread entrypoint
- deep links
- portable `ui/update-model-context` integration
- rich forms
- plugin settings
- inline, fullscreen, and optional PiP display modes
- a declared production origin
- an explicit UI Content Security Policy
- secure browser-session bootstrapping
- short-lived scoped application sessions for direct UI network connections

MCP Events should be used for low-volume host-level completion, failure, and input-required subscriptions.

High-frequency worker execution activity should remain on the Codex subagent extension's authenticated live application stream.

---

## Terminology Note

“Codex subagent extension” describes the capability for Codex to delegate work to other agents. Refer to it as an extension or delegation capability in prose, not as a separate product.

If offered publicly, identify the publisher and avoid implying OpenAI or Anthropic endorsement unless such endorsement exists.