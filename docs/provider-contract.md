# Built-in provider contract

Providers implement `Provider` in `src/features/providers/types.ts`. Registration is explicit in `src/features/providers/config.ts`; this is an internal contract, not a dynamic plugin API.

The shared control plane owns queues, dependencies, concurrency, workspace creation and snapshots, budget checks, task ownership, persistence, input serialization, and the conversation: messages, pending steers, the queue and drafts. Providers own model discovery, native execution, session creation/deletion, and native permissions.

## A turn

A task is a conversation of turns, and `Provider.run(context, prompt)` runs one turn. The prompt is the whole first-turn prompt for a new session, or only the messages a resumed session hasn't received. A successful turn returns `{ reply }`, the plain text that ended it; the service records it as an `agent.reply` event. An interrupted or failed turn throws and records no reply.

While a turn runs, `RunContext` connects it to the conversation:

- `signal` aborts to interrupt the turn. Claude interrupts through `Query.interrupt({ cancelQueued: true })`, which ends the turn with an interrupted result and keeps the session; it stops the process only if the interrupt doesn't end the turn within ten seconds.
- `acceptSteers(sink)` registers where steers go. Control sends each steer there, including any sent before the provider registered, and the sink returns `false` once the turn can't take one. `steerTaken(id)` reports one the turn took. A steer the turn never takes is moved to the front of the task's queue. Claude runs each turn in streaming input mode and sends a steer as a `priority: "next"` user message; the CLI's `command_lifecycle` frames show when it was taken. Because the CLI runs a steer left at the end of a turn as a turn of its own, Claude withdraws untaken steers with `cancelAsyncMessage` as the final message ends.
- `delta(messageId, text)` streams the main worker's text as it's written. Deltas aren't stored: Control keeps a draft per running task in memory and clears it when the whole message, the reply or the end of the turn is stored.
- `emit("agent.completed", { cost_usd })` reports the session's cumulative cost; Control adds only the part a resumed session hadn't reported before.

## Lifecycle policy

`Provider.taskPolicy` is required and describes native behavior used by `Control`:

- `prepareStart` validates provider-specific options and authority, then returns resolved options to persist with the task. Claude resolves native modes and restrictions at this point, so later settings changes cannot broaden a running task's authority.
- `decideInput` can approve or deny execution requests under provider policy. Returning `undefined` queues an interactive request. Questions always remain interactive.
- `parentMayApprove` selects whether the parent can answer an unresolved permission request. Claude uses its independent approval decider; whole-execution providers use their execution approval policy.
- `inputKind` classifies provider tool names as questions or permissions. The persisted kind lets forms and presentation use a common distinction.
- Optional `validateSession` checks provider-owned session state before a later turn resumes it. A session it rejects, or one owned by another service worker, gives way to a new session in the same task, whose prompt carries the earlier conversation.

`executionTaskPolicy` resolves whole-execution approval defaults from user settings and supplies the existing approval behavior. Native policies resolve their own defaults; presentation metadata does not select lifecycle policy. Claude supplies a native policy. A new built-in supplies its own policy without editing lifecycle branches in `Control`.

## Presentation and settings

`Provider.metadata` is serializable metadata exposed by worker discovery. Delegation forms use it for native permission controls, effort choices, and budget help. Provider-owned settings definitions contribute schemas and sections while retaining existing persisted setting names. Providers whose settings are unsupported remain excluded from settings defaults.

Providers emit common activity events and normalized presentation details for shared rendering. Native event payloads remain available for inspection. Activity rendering reads explicit presentation metadata; Claude SDK decoding happens in the Claude provider.

## Stored provider state

New providers can validate and resolve their isolated `provider_options.<provider_id>` namespace without adding fields to the shared task schema. Native input descriptions and approval labels can be supplied through the optional presentation argument to `RunContext.input`.

Provider-owned settings retain their existing persisted names. Claude tasks persist native permission mode, approval routing, permission source, and resolved session restrictions under `provider_options.claude`. The shared `approval_mode` remains for providers using whole-execution approval. Execution default updates do not change Claude native defaults. Pending input has an explicit kind.
