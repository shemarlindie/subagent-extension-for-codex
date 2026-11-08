# Built-in provider contract

Use this guide when you implement or change a provider. It defines what a
provider owns and how it behaves across a task's lifecycle.

- [Configuration](configuration.md) covers user-facing permissions and session
  restrictions.
- [Claude execution verification](claude-verification.md) covers live execution
  checks.

Implement the `Provider` interface in `src/service/features/providers/types.ts`
and register the provider in `src/service/features/providers/config.ts`.

| Owner                | Responsibilities                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared control plane | Scheduling, workspaces, recorded diffs, budget checks, task ownership, persistence, conversation messages, steers, drafts and input serialization. |
| Provider             | Model discovery, native execution, session creation and deletion, and native permissions.                                                          |

## A turn

`Provider.run(context, prompt)` runs one turn. It returns the final reply on
success and throws on failure or interruption. Only successful turns record a
reply.

Throw `RunError(code, details?)` for a failure with a machine-readable code.
Budget failures use `cost_budget_exhausted` or `runtime_budget_exhausted`. The
task and its `task.failed` event retain `error_code` and any raw provider
details in `error`. Clients map the code to display text. Failures without
details save only the code.

The task conversation layer builds the prompt. A new session receives the
original request, workspace context and bounded conversation history. A resumed
session receives unsent messages and any workspace reminder.

During a turn, the provider must tell accepted steers apart from steers the
worker actually consumed. Unconsumed steers return to the front of the task's
queue. Claude uses native streaming input and cancels untaken messages at turn
end, so the CLI cannot run them as an extra turn. An interrupt ends the current
turn and keeps the session where possible.

Text deltas are transient drafts. Completed messages and the final reply are
durable. Report the cumulative session cost with `agent.completed`, and the
control plane accounts for the increase across resumed turns.

## Recording file edits

Report each successful text edit through `RunContext.fileChanged(edit)`. A
`FileEdit` contains:

- `path`, as the tool reported it.
- `hunks`, a unified diff against the file just before that edit.
- Optional `created` and `deleted` flags.
- `source`, either `"tool"` or `"command"`.

Call `editUnrecorded(path, source)` when you know the changed file but not its
hunks. Pass `"tool"` for an edit tool so the incomplete diff keeps its source.
The source defaults to `"command"`. Omit the path when a command changed files
it could not name.

The control plane resolves paths through `realpath`, including deleted files
through their parent directory. It drops paths outside the task workspace or
inside `.git`, and composes each edit into the durable task and latest-turn
diffs immediately.

- Turn start clears only the latest-turn rows.
- Steers the CLI runs as extra turns stay attributed to the current service
  turn.
- Failed and interrupted turns keep their edits.
- Providers must close execution at turn end so background subagents cannot keep
  editing between turns.

The changes feature owns composition and persistence. A contradictory or missing
edit marks that file incomplete and clears its hunks, and later edits cannot
restore that diff. See [Recorded changes](mcp-reference.md#recorded-changes) for
reads and recording limits.

### Claude edit recording

Claude records edits in a `PostToolUse` hook beside its permission hook,
including subagent calls. The hook maps `tool_response` through the pure
`claudeFileEdits` function. Main-worker stream results support fixture replay,
but subagent stream results lack the data recording needs. Recording errors are
logged and never block or deny a tool.

The mapper handles each response this way:

- `Write` and `Edit` use their structured patches.
- Notebook edits and writes without a patch get computed patches with three
  context lines. Full file text is discarded after the hunks are produced.
- Bash uses `bashEditDiff` entries. Claude runs with the `bashEditDiffEnabled`
  flag setting.
- Errored results, staged writes and no-op edits record nothing.
- Git-relative `gitDiff` status does not decide whether an edit created a file.

A Bash response with `bashEditDiff.unavailable` or `bashEditDiff.skipped` maps
to an unknown-files warning. A skipped diff can hide a real checkout edit, such
as `git restore file.txt`. Other Git commands can report precise hunks or no
edit data, so the provider follows the reported fields and never infers changes
from the command text.

Claude Code omits `bashEditDiff` outside a Git work tree. For a task with
`no_git`, a Bash response without it maps to the same warning, because absence
can't show that the command edited nothing.

## Lifecycle policy

Each provider supplies a `taskPolicy`, and the control plane never branches on
provider identity. The policy:

- Resolves and validates options at task creation.
- Decides native permission requests and selects their approver.
- Classifies questions separately. Questions stay interactive.

Resolved restrictions are stored with the task, so later settings changes cannot
broaden an existing task's authority. Native policies own their defaults. A
provider without per-tool native permissions can use `executionTaskPolicy` for
whole-execution approval. Presentation metadata never selects policy.

A provider may validate local session state before resuming. If it rejects the
state, or a different service worker owns the session, the task starts a fresh
session that carries the earlier conversation in its prompt. See
`ProviderTaskPolicy` in `src/service/features/providers/task-policy.ts`.

## Presentation and settings

Worker discovery exposes serializable `Provider.metadata` for delegation forms,
including native permission controls, effort choices and budget help. Providers
also define their settings schemas and sections.

The approval decision maker is shared by every provider. A provider whose native
checks leave permission requests open sets `nativePermissions.approvalDecider`,
and its task policy defaults the task's decider to the `approvals.decider`
setting.

A provider's own settings form one block under `providers.<id>`, registered in
`src/shared/providers/settings.ts`. Settings there are user-only. Metadata names
the block's permission mode by path in `nativePermissions.permissionSetting`.

Use the typed `RunContext.emit` for known project events and `emitOpaque` for
provider-owned or future event names. Keep native decoding in the provider and
normalize activity and rate-limit windows for consumers. Preserve unfamiliar or
incomplete event data for inspection. See
[Architecture](architecture.md#code-ownership) for the shared event validation
boundary.

Claude omits original responses by default. Enable
[full-event recording](configuration.md#environment-variables) to retain them
for diagnostics and fixture recording. In that mode, every event derived from
one received response carries the same unique `response_ref`, and only the first
also carries the response as `raw_response`. The store keeps that original
outside the event data and drops `raw_response` from any event without a
`response_ref`.

Claude events also omit file contents by default. Read, Write, Edit and
NotebookEdit calls keep their paths and options in `tool.started.input`, without
`content`, `old_string`, `new_string` or `new_source`. A successful result's
`tool.completed.content` reads "File content isn't stored." and a failed result
keeps its error text. Approval prompts and the Changes tab read their own
copies, so they keep full file contents. Full-event recording keeps file
contents in the events.

## Stored provider state

Store and validate provider-specific options under
`provider_options.<provider_id>` so they stay out of the shared task schema.

Claude tasks store their native permission mode, permission source, approval
decision maker and resolved session restrictions under
`provider_options.claude`. The shared `approval_mode` serves providers with
whole-execution approval. Changing the execution approval default does not
change Claude's native defaults.

A session can run with less than a task asked for, such as when org policy rules
out its mode. Requested values stay as they were. `RunContext.effectiveOptions`
stores what differs under `provider_options.<provider_id>.effective`, replacing
the earlier values, and an `agent.limited` event gives each new difference with
a sentence for the user. Claude compares the turn's first `init` with the
request.

A provider that ends a turn before sending its prompt calls
`RunContext.promptHeld`, so the next turn sends those instructions again.

## Provider lifecycle methods

| Method                                 | Purpose                                                                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `capabilities`                         | Declares supported task features and limits. The control plane rejects unsupported budgets before execution.                                    |
| `readiness()`                          | Optional. Checks the local runtime and can block new tasks while the worker stays visible. Authentication and network failures can still occur. |
| `models(settings)`                     | Optional. Supplies model and effort suggestions using the requesting user's settings. Custom model IDs are still accepted.                      |
| `policy(settings)`                     | Optional. What org policy limits for new tasks. Nothing means nothing known, never that everything is allowed, so checks continue as tasks run. |
| `deleteSession(task, expectedVersion)` | Optional. Removes the confirmed session resources. Rejects a changed version.                                                                   |
| `sessionDeletionStatus(task)`          | Required for session deletion. Lists the verified resources and their version for confirmation.                                                 |
| `close()`                              | Optional. Releases provider resources during service shutdown.                                                                                  |

When the provider creates a native session, it calls
`RunContext.session(id, stateRef)` so the service stores the session's identity,
host owner and state reference. Record a state reference only after locating the
session's data.

Offer session deletion only when the provider can identify the recorded files.
Show those files before confirmation and reject deletion if their locations or
identities change. Remove only the confirmed resources, including data left by
earlier failed attempts. Succeed when those resources are already absent. A
deletion error keeps the local task resources available for retry.

The development-only fixture provider implements this contract for deterministic
checks. Production registration and bundles exclude it. See
[Fixture scenarios](fixture-scenarios.md).
