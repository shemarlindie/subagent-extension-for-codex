# Built-in provider contract

Use this guide when you implement or change a provider. It defines what a
provider owns and how it behaves across a task's lifecycle.

- [Configuration](configuration.md) covers user-facing permissions and session
  restrictions.
- [Claude execution verification](claude-verification.md) covers live
  execution checks.

Implement the `Provider` interface in `src/service/features/providers/types.ts`
and register the provider in `src/service/features/providers/config.ts`.

| Owner                | Responsibilities                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared control plane | Scheduling, dependencies, workspaces, recorded diffs, budget checks, task ownership, persistence, conversation messages, steers, drafts and input serialization. |
| Provider             | Model discovery, native execution, session creation and deletion, and native permissions.                                                                        |

## A turn

`Provider.run(context, prompt)` runs one turn. It returns the final reply on
success and throws on failure or interruption. Only successful turns record a
reply.

The task conversation layer builds the prompt. A new session receives the
original request, workspace and dependency context, and bounded conversation
history. A resumed session receives unsent messages and any workspace reminder.

During a turn, the provider must tell accepted steers apart from steers the
worker actually consumed. Unconsumed steers return to the front of the task's
queue. Claude uses native streaming input and cancels untaken messages at turn
end, so the CLI cannot run them as an extra turn. An interrupt ends the current
turn and keeps the session where possible.

Text deltas are transient drafts. Completed messages and the final reply are
durable. Report the cumulative session cost with `agent.completed`, and the
control plane accounts for the increase across resumed turns.

### Messages to the parent

The optional `messageParent` callback sends a blocker update immediately, or
holds one completion report until the turn succeeds. Failed and interrupted
turns discard the completion report. See the `RunContext` interface for
signatures.

Claude exposes the callback through the injected `codex_parent.send_message`
tool, whatever the file and execution restrictions. The provider approves this
tool in its `PreToolUse` hook, including in `dontAsk` mode. Native ask and deny
rules and stronger hook decisions still apply, as described in
[Claude's hook decision rules](https://code.claude.com/docs/en/hooks#pretooluse-decision-control).
SDK `allowedTools` stays unset so it cannot shadow `canUseTool`.

Queueing a report does not confirm host delivery, and providers cannot
acknowledge it for the parent. See
[Provider messages to the parent](mcp-reference.md#provider-messages-to-the-parent)
for retrieval and acknowledgement.

## Recording file edits

Report each successful text edit through `RunContext.fileChanged(edit)`. A
`FileEdit` contains:

- `path`, as the tool reported it.
- `hunks`, a unified diff against the file just before that edit.
- Optional `created` and `deleted` flags.
- `source`, either `"tool"` or `"command"`.

Call `editUnrecorded(path, source)` when you know the changed file but not its
hunks. Pass `"tool"` for an edit tool so the incomplete capture keeps its
source. The source defaults to `"command"`. Omit the path when a command
changed files it could not name.

The control plane resolves paths through `realpath`, including deleted files
through their parent directory. It drops paths outside the task workspace or
inside `.git`, and composes each edit into the durable task and latest-turn
diffs immediately.

- Turn start clears only the latest-turn rows.
- Steers the CLI runs as extra turns stay attributed to the current service
  turn.
- Failed and interrupted turns keep their edits.
- Providers must close execution at turn end so background subagents cannot
  keep editing between turns.

The changes feature owns composition and persistence. A contradictory or
missing edit marks that file incomplete and clears its hunks, and later edits
cannot restore that diff. See [Recorded changes](mcp-reference.md#recorded-changes)
for reads and recording limits.

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

## Lifecycle policy

Each provider supplies a `taskPolicy`, and the control plane never branches on
provider identity. The policy:

- Resolves and validates options at task creation.
- Decides native permission requests and selects their approver.
- Classifies questions separately. Questions stay interactive.

Resolved restrictions are stored with the task, so later settings changes
cannot broaden an existing task's authority. Native policies own their
defaults. A provider without per-tool native permissions can use
`executionTaskPolicy` for whole-execution approval. Presentation metadata never
selects policy.

A provider may validate local session state before resuming. If it rejects the
state, or a different service worker owns the session, the task starts a fresh
session that carries the earlier conversation in its prompt. See
`ProviderTaskPolicy` in `src/service/features/providers/task-policy.ts`.

## Presentation and settings

Worker discovery exposes serializable `Provider.metadata` for delegation forms,
including native permission controls, effort choices and budget help. Providers
also define their settings schemas and sections.

Use the typed `RunContext.emit` for known project events and `emitOpaque` for
provider-owned or future event names. Keep native decoding in the provider and
normalize activity and rate-limit windows for consumers. Preserve raw payloads
for inspection, including unfamiliar or incomplete events. See
[Architecture](architecture.md#code-ownership) for the shared event validation
boundary.

## Stored provider state

Store and validate provider-specific options under
`provider_options.<provider_id>` so they stay out of the shared task schema.

Claude tasks store their native permission mode, permission source, approval
decision maker and resolved session restrictions under
`provider_options.claude`. The shared `approval_mode` serves providers with
whole-execution approval. Changing the execution approval default does not
change Claude's native defaults.

## Provider lifecycle methods

| Method                | Purpose                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `capabilities`        | Declares supported task features and limits. The control plane rejects unsupported budgets before execution.                                    |
| `readiness()`         | Optional. Checks the local runtime and can block new tasks while the worker stays visible. Authentication and network failures can still occur. |
| `models(settings)`    | Optional. Supplies model and effort suggestions using the requesting user's settings. Custom model IDs are still accepted.                      |
| `deleteSession(task)` | Optional. Deletes provider state only when task deletion asks for it.                                                                           |
| `close()`             | Optional. Releases provider resources during service shutdown.                                                                                  |

When the provider creates a native session, it calls
`RunContext.session(id, stateRef)` so the service stores the session's
identity, host owner and state reference. Deleting a session that is already
gone must succeed. A deletion error keeps the local task resources so the user
can retry.

The development-only fixture provider implements this contract for
deterministic checks. Production registration and bundles exclude it. See
[Fixture scenarios](fixture-scenarios.md).
