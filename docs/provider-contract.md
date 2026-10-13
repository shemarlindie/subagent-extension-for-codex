# Built-in provider contract

Use this guide when implementing or changing provider execution. Providers implement `Provider` in `src/service/features/providers/types.ts`. Registration is explicit in `src/service/features/providers/config.ts`; this is an internal contract, not a dynamic plugin API.

The shared control plane owns queues, dependencies, concurrency, workspace creation and snapshots, budget checks, task ownership, persistence, input serialization, and the conversation: messages, pending steers, the queue and drafts. Providers own model discovery, native execution, session creation/deletion, and native permissions.

## A turn

A task is a conversation of turns, and `Provider.run(context, prompt)` runs one turn. For a new session, the prompt contains the original request, workspace and dependency context, and any bounded earlier conversation. A resumed session receives unsent messages and, for a shared checkout, a reminder that its files may have changed. `SessionPrompts` in `src/service/features/tasks/conversation/session-prompts.ts` owns this assembly. A successful turn returns `{ reply }`, the plain text that ended it; the service records it as an `agent.reply` event. An interrupted or failed turn throws and records no reply.

While a turn runs, `RunContext` connects it to the conversation:

- `signal` aborts to interrupt the turn. Claude interrupts through `Query.interrupt({ cancelQueued: true })`, which ends the turn with an interrupted result and keeps the session; it stops the process only if the interrupt doesn't end the turn within ten seconds.
- `acceptSteers(sink)` registers where steers go. Control sends each steer there, including any sent before the provider registered, and the sink returns `false` once the turn can't take one. `steerTaken(id)` reports one the turn took. A steer the turn never takes is moved to the front of the task's queue. Claude runs each turn in streaming input mode and sends a steer as a `priority: "next"` user message; the CLI's `command_lifecycle` frames show when it was taken. Because the CLI runs a steer left at the end of a turn as a turn of its own, Claude withdraws untaken steers with `cancelAsyncMessage` as the final message ends.
- `delta(messageId, text)` streams the main worker's text as it's written. Deltas aren't stored: Control keeps a draft per running task in memory and clears it when the whole message, the reply or the end of the turn is stored.
- Optional `messageParent(text)` queues an explicit worker message for the task’s parent conversation and returns its event ID. The mounted embedded panel claims and forwards its task/message ID through the host message bridge. The parent retrieves the stored report with `get_agent_message`; polling exposes the same ID. The parent acknowledges explicit reports after processing through `ack_agent_message`; providers cannot acknowledge on the parent’s behalf. Queueing does not confirm host delivery. Providers can expose this callback as a native tool; Claude injects the in-process `codex_parent` MCP server and permits only its `message_parent` tool independently of file/execution restrictions.
- `emit("agent.completed", { cost_usd })` reports the session's cumulative cost; Control adds only the part a resumed session hadn't reported before.

## Lifecycle policy

`Provider.taskPolicy` is required and describes native behavior used by `Control`:

- `prepareStart` validates provider-specific options and authority, then returns resolved options to persist with the task. Claude resolves native modes and restrictions at this point, so later settings changes cannot broaden a running task's authority.
- `decideInput` can approve or deny execution requests under provider policy. Returning `undefined` queues an interactive request. Questions always remain interactive.
- `parentMayApprove` selects whether the parent can answer an unresolved permission request. Claude uses its independent approval decider; whole-execution providers use their execution approval policy.
- `inputKind` classifies provider tool names as questions or permissions. The persisted kind lets forms and presentation use a common distinction.
- Optional `taskPolicy.validateSession` checks provider-owned session state before a later turn resumes it. A session it rejects, or one owned by another service worker, gives way to a new session in the same task, whose prompt carries the earlier conversation.

`executionTaskPolicy` resolves whole-execution approval defaults from user settings and supplies whole-execution approval behavior. Native policies resolve their own defaults; presentation metadata does not select lifecycle policy. Claude supplies a native policy. A new built-in supplies its own policy without editing lifecycle branches in `Control`.

## Presentation and settings

`Provider.metadata` is serializable metadata exposed by worker discovery. Delegation forms use it for native permission controls, effort choices, and budget help. Provider-owned settings definitions contribute schemas and sections.

Providers emit common activity events and normalized presentation details for shared rendering. Native event payloads remain available for inspection. Activity rendering reads explicit presentation metadata; Claude SDK decoding happens in the Claude provider.

`RunContext.emit` correlates known project event names with their payloads.
Use `emitOpaque` only for provider-owned or future event names that have no
project contract. The service validates known payload fields when it creates
the durable event and preserves the complete original JSON alongside the typed
view. Stored reads and panel activity transports validate their own incoming
data, keeping incomplete payloads and unfamiliar event names available through
the opaque view. Claude's native SDK declarations are reused through a
type-only import in its owning shared provider contract; that exception does
not bring SDK execution code into common or browser code. The panel validates
the normalized event envelope and keeps the full raw response available for
inspection.

Rate-limit presentation exposes reported utilization windows through
`rateLimitWindows`. Claude translates its SDK rate-limit fields at the provider
boundary; consumers read the normalized windows from the presentation.

## Stored provider state

New providers can validate and resolve their isolated `provider_options.<provider_id>` namespace without adding fields to the shared task schema. Native input descriptions and approval labels can be supplied through the optional presentation argument to `RunContext.input`.

Provider-owned settings retain their existing persisted names. Claude tasks persist native permission mode, approval routing, permission source, and resolved session restrictions under `provider_options.claude`. The shared `approval_mode` remains for providers using whole-execution approval. Execution default updates do not change Claude native defaults. Pending input has an explicit kind.

## Provider lifecycle methods

`capabilities` declares supported task features and limits. The control plane
rejects unsupported budgets before execution. Capability discovery advertises
workspace and runtime features; presentation metadata supplies UI controls and
help. Optional `readiness()` checks the local runtime and
can block starting a task without hiding the worker. It does not establish
authentication or network readiness. Optional `models()` supplies model and
effort suggestions; custom model IDs are still accepted.

When a native session is created, call `RunContext.session(id, stateRef)` so
the service can store its identity, host owner and state reference.
`deleteSession(task)` deletes provider state only when task deletion requests
it; an already absent session must not fail deletion. A deletion error retains
the local task resources for retry. `close()` releases provider resources during
service shutdown.

The development-only fixture provider implements this contract for deterministic
checks; see [Fixture scenarios](fixture-scenarios.md). It is excluded from
production registration and bundles.
