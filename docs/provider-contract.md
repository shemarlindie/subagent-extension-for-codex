# Built-in provider contract

Use this guide when implementing or changing provider execution. It defines
provider responsibilities and lifecycle behavior. For configurable permissions
and session restrictions, see [Configuration](configuration.md). For execution
checks, see [Claude execution verification](claude-verification.md).

Implement the internal `Provider` contract in `src/service/features/providers/types.ts` and register the provider in `src/service/features/providers/config.ts`.

The shared control plane owns scheduling, dependencies, workspaces, recorded diffs, budget checks, task ownership and persistence. It also manages conversation messages, steers, drafts and input serialization. Providers own model discovery, native execution, session creation and deletion, and native permissions.

## A turn

`Provider.run(context, prompt)` runs one turn. The task conversation layer
assembles prompts: new sessions receive the original request, workspace and
dependency context, and bounded conversation history. Resumed sessions receive
unsent messages and any workspace reminder. Providers return
the final reply on success and throw on failure or interruption. Only successful
turns produce a recorded reply.

During a turn, the provider must distinguish accepted steers from steers the
worker actually consumed. Unconsumed steers return to the front of the task's
queue. Claude uses native streaming input and cancels untaken messages at turn
end so the CLI cannot execute them as an extra turn. Interrupting ends the
current turn while preserving the session where possible.

Text deltas are transient drafts. Completed messages and the final reply are
durable. Report cumulative session cost with `agent.completed`. The control
plane accounts for the increase across resumed turns.

The optional `messageParent` callback sends immediate blocker updates or holds
one completion report until the turn succeeds. Failed and interrupted turns
discard that completion report. Claude exposes it through the injected
`codex_parent.send_message` tool, independently of file/execution restrictions.
The provider approves this tool in its `PreToolUse` hook, including in `dontAsk`
mode. Native ask/deny rules and stronger hook decisions still apply, as described
in [Claude's hook decision rules](https://code.claude.com/docs/en/hooks#pretooluse-decision-control).
SDK `allowedTools` stays unset to avoid shadowing `canUseTool`.
Queueing a report does not confirm host delivery, and providers cannot
acknowledge it for the parent. See [parent message delivery](mcp-reference.md#provider-messages-to-the-parent)
for retrieval and acknowledgement, and the `RunContext` interface for callback
signatures.

## Recording file edits

Report each successful text edit through `RunContext.fileChanged(edit)`. `FileEdit`
contains the tool-reported `path`, unified-diff `hunks` against the file just before
that edit, optional `created` and `deleted` flags, and `source: "tool" | "command"`.
Use `editUnrecorded(path, source)` when the changed file is known but its hunks
are unavailable. Pass `"tool"` for an edit tool so an incomplete capture keeps
its provenance. The optional source defaults to `"command"`. Omit the path when
a command changed files it could not name.

The control plane resolves paths through `realpath`, including deleted files
through their parent directory, and drops paths outside the task workspace or
inside `.git`. It composes each edit into durable task and latest-turn diffs
immediately. Turn start clears only latest-turn rows. Steers the CLI executes as
extra turns stay attributed to the current service turn. Failed and interrupted
turns retain their edits. Providers must close execution at turn end so background
subagents cannot keep editing between turns.

Claude records edits in a `PostToolUse` hook alongside its permission hook. The
hook maps `tool_response` through the pure `claudeFileEdits` function, including
subagent calls. Main-worker stream results support fixture replay, but subagent
stream results lack the response data needed for recording. Recording errors are
logged and never block or deny a tool.

The mapper reads `Write` and `Edit` structured patches, computes patches for
notebook JSON and writes without patches, and reads Bash `bashEditDiff` entries.
Claude runs with the `bashEditDiffEnabled` flag setting. Errored results and staged
writes are skipped, as are no-op edits. Patch computation uses three context lines
and discards full text after producing hunks. Git-relative `gitDiff` status does
not determine whether an edit created a file.

Claude maps Bash responses with `bashEditDiff.unavailable` or
`bashEditDiff.skipped` to an unknown-files warning. A skipped diff can represent
a real checkout edit, such as `git restore file.txt`. Other Git command forms
can provide precise hunks or no edit data, so the provider follows the reported
response fields instead of inferring changes from the command text.

The changes feature owns composition and persistence. A contradictory or missing
edit makes that file incomplete and clears its hunks. Later edits cannot restore
that scope's diff. See [change tools](mcp-reference.md#recorded-changes) for reads
and recording limits.

## Lifecycle policy

Each provider supplies `taskPolicy`. The control plane must not branch on
provider identity. The policy resolves and validates options at task creation,
decides native permission requests, selects their approver and classifies
questions separately. Questions remain interactive. Resolved restrictions are
persisted so later settings changes cannot broaden an existing task's authority.

Native policies own their defaults. Providers without per-tool native
permissions can use `executionTaskPolicy` for whole-execution approval.
Presentation metadata never selects policy.

A provider may validate local session state before resuming. Rejected state or
a different service worker causes a fresh session in the same task, with the
earlier conversation carried in its prompt. See `ProviderTaskPolicy` in
`src/service/features/providers/task-policy.ts` for the interface.

## Presentation and settings

Worker discovery exposes serializable `Provider.metadata` for delegation forms, including native permission controls, effort choices and budget help. Providers also define their settings schemas and sections.

Use typed `RunContext.emit` for known project events and `emitOpaque` for
provider-owned or future event names. Keep native decoding in the provider and
normalize activity and rate-limit windows for consumers. Preserve raw payloads
for inspection, including unfamiliar or incomplete events. The shared event
validation boundary is described in [Architecture](architecture.md#code-ownership).

## Stored provider state

Store and validate provider-specific options under `provider_options.<provider_id>` to keep them out of the shared task schema.

Claude tasks persist native permission mode, approval routing, permission source, and resolved session restrictions under `provider_options.claude`. The shared `approval_mode` remains for providers using whole-execution approval. Execution default updates do not change Claude native defaults.

## Provider lifecycle methods

`capabilities` declares supported task features and limits. The control plane
rejects unsupported budgets before execution. Capability discovery advertises
workspace and runtime features. Presentation metadata supplies UI controls and
help.

The optional `readiness()` method checks the local runtime and can block new
tasks while leaving the worker visible. Authentication and network failures
can still occur during execution. The optional `models()` method supplies
model and effort suggestions. Custom model IDs are still accepted.

When a native session is created, call `RunContext.session(id, stateRef)` so
the service can store its identity, host owner and state reference.
`deleteSession(task)` deletes provider state only when task deletion requests
it. An already absent session must not fail deletion. A deletion error retains
the local task resources for retry. `close()` releases provider resources during
service shutdown.

The development-only fixture provider implements this contract for deterministic
checks. See [Fixture scenarios](fixture-scenarios.md). It is excluded from
production registration and bundles.
