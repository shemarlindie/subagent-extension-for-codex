# Built-in provider contract

Providers implement `Provider` in `src/features/providers/types.ts`. Registration is explicit in `src/features/providers/config.ts`; this is an internal contract, not a dynamic plugin API.

The shared control plane owns queues, dependencies, concurrency, workspace creation and snapshots, budget checks, task ownership, persistence, and input serialization. Providers own model discovery, native execution, session creation/deletion, native permissions, and proof of termination.

## Lifecycle policy

`Provider.taskPolicy` is required and describes native behavior used by `Control`:

- `prepareStart` validates provider-specific options and authority, then returns resolved options to persist with the task. Claude resolves native modes and restrictions at this point, so later settings changes cannot broaden a running task's authority.
- `decideInput` can approve or deny execution requests under provider policy. Returning `undefined` queues an interactive request. Questions always remain interactive.
- `parentMayApprove` selects whether the parent can answer an unresolved permission request. Claude uses its independent approval decider; whole-execution providers use their execution approval policy.
- `inputKind` classifies provider tool names as questions or permissions. The persisted kind lets forms and presentation use a common distinction.
- `retryOptions` extracts accepted start options from a persisted task. Providers that persist resolved restrictions or native turn state implement this hook so a retry keeps selected authority and starts a fresh session. Without the hook, the task options are reused.
- `validateSession` checks provider-owned session state before continuation. Shared task ownership and workspace checks still apply.
- `recoverBeforeInterrupt` requires successful `Provider.recover` before a restarted execution can be marked interrupted. A failure keeps controls locked with `termination_unconfirmed`. The requirement is persisted so disabling the provider cannot unlock an execution.

`executionTaskPolicy` resolves whole-execution approval defaults from user settings and supplies the existing approval behavior. Native policies resolve their own defaults; presentation metadata does not select lifecycle policy. Claude supplies a native policy; Codex adds termination-proof recovery to the execution policy. A new built-in supplies its own policy without editing lifecycle branches in `Control`.

## Presentation and settings

`Provider.metadata` is serializable metadata exposed by worker discovery. Delegation forms use it for native permission controls, effort choices, and budget help. Provider-owned settings definitions contribute schemas and sections while retaining existing persisted setting names. Providers whose settings are unsupported remain excluded from settings defaults.

Providers emit common activity events and normalized presentation details for shared rendering. Native event payloads remain available for inspection. Activity rendering reads explicit presentation metadata; Claude SDK decoding happens in the Claude provider.

## Stored provider state

New providers can validate and resolve their isolated `provider_options.<provider_id>` namespace without adding fields to the shared task schema. Native input descriptions and approval labels can be supplied through the optional presentation argument to `RunContext.input`.

Provider-owned settings retain their existing persisted names. Claude tasks persist native permission mode, approval routing, permission source, and resolved session restrictions under `provider_options.claude`. Codex stores native turn details under `provider_options.codex`. The shared `approval_mode` remains for providers using whole-execution approval, including Codex. Execution default updates do not change Claude native defaults.

Codex's recovery requirement is persisted before recovery runs, including when that provider is disabled. Pending input has an explicit kind, and native turn disclosures are stored with the request. Codex continues to require native turn approval and confirmed executor/session termination, and rejects unsupported numeric cost and token budgets.
