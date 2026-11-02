# Fixture provider scenarios

Use the fixture provider to test task controls and provider presentation without
model calls. Start it with the [demo](development.md#demo), then add markers to
a task description or follow-up. One message can combine several markers.

The fixture simulates tools and permissions. It does not run Claude or enforce
host isolation. Its code lives in `dev/service/` and does not ship in the
package.

## Prompt markers

| Marker                                             | Use it to                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| `[fixture:question count=2]`                       | Ask questions and wait for answers. Omit `count` for one question.     |
| `[fixture:question-form]`                          | Ask single-choice, multiple-choice and text questions in one request.  |
| `[fixture:permission tool=Edit]`                   | Request approval for a simulated tool. The default tool is `Bash`.     |
| `[fixture:tool name=Read]`                         | Show a successful tool call. Use `tool-error` for a failed result.     |
| `[fixture:content type=image]`                     | Show a content block. `role=user` changes the sender.                  |
| `[fixture:thinking]`                               | Show a thinking block.                                                 |
| `[fixture:assistant-error type=rate_limit]`        | Show an SDK assistant error without failing the turn.                  |
| `[fixture:change]`                                 | Write and record a sample file. Requires a worktree task.              |
| `[fixture:subagent count=2]`                       | Show child-worker lifecycles. Add `outcome=error` for failed children. |
| `[fixture:restriction name=path_guard]`            | Show a synthetic restriction denial.                                   |
| `[fixture:activity type=status status=compacting]` | Show an SDK activity event.                                            |
| `[fixture:stream]`                                 | Show a complete streaming-message lifecycle.                           |
| `[fixture:reply lines=40 pace=30]`                 | Add reply paragraphs and stream each word after `pace` ms.             |
| `[fixture:session state=invalid]`                  | Make the next continuation start a fresh session.                      |
| `[fixture:cost usd=0.25]`                          | Add a deterministic cost to the session total.                         |
| `[fixture:wait ms=15000]`                          | Keep a turn running for steering or interruption checks.               |
| `[fixture:slow]` / `[fixture:late]`                | Take steers over several checkpoints, or leave them for the next turn. |
| `[fixture:fail stage=before-reply]`                | Fail at a selected boundary. Without `stage`, fail after the reply.    |
| `[fixture:completion subtype=error_max_turns]`     | Emit a failed SDK result and fail the turn.                            |

Limits:

- Questions, permissions and tool calls accept `count` up to 5.
- Child lifecycles stop at 4.
- Waits last at most 60 seconds.
- Reply `lines` and `pace` stop at 200.

`dev/service/fixture-scenarios.ts` lists the accepted arguments and aliases.

## SDK event and message scenarios

Use `key=value` to override event fields, dots for nested fields and URL
encoding for spaces. For example:

```text
[fixture:activity type=rate_limit_event rate_limit_info.status=rejected]
[fixture:content type=image source.data=ZmFrZQ==]
[fixture:stream frame=content_block_delta delta=thinking text=Fixture%20thought]
```

Activity fixtures go through the shared presentation mapper. They skip Claude's
SDK and the provider event normalizer. Their type maps cover the installed SDK
variants. `dev/service/fixture-events.ts` and the modules beside it hold the
variants and default payloads. Unknown activity or content types show the
generic fallback.

Content markers support assistant/user text, thinking, image, document, tool,
empty and error content. `type=tool_use outcome=running` leaves a started tool
without a result. Use `outcome=error` to show a failed tool result.

A turn can succeed even when it contains an assistant error or a failed tool or
child worker. Add a completion marker to check a terminal failure:

```text
[fixture:assistant-error type=rate_limit]
[fixture:completion subtype=error_during_execution]
```

`[fixture:completion subtype=success is_error=true]` checks a result with a
successful subtype and an error flag.

## Permission and worker-policy scenarios

Choose the task's simulated permission mode and approval decision maker in the
ordinary task form, then use `[fixture:permission]`:

| Mode                        | Simulated behavior                                            |
| --------------------------- | ------------------------------------------------------------- |
| `inherit`                   | Resolve the saved `providers.claude.permission_mode`.         |
| `default`                   | Follow the fixture execution approval mode.                   |
| `plan`, `dontAsk`           | Deny.                                                         |
| `acceptEdits`               | Allow edit tools. Use the execution approval mode for others. |
| `auto`, `bypassPermissions` | Allow.                                                        |

Set `providers.claude.subagents` to `false` to check the blocked subagent path.
Select a read-only worker profile to check its policy. These checks cover
routing and presentation only. Use the
[live Claude checks](claude-verification.md#live-claude-checks) for native
permission and sandbox behavior.

Readiness and model discovery happen before a task runs. Configure them, and
provider failures, with environment variables when you start the demo:

| Variable                                                  | Values                                       |
| --------------------------------------------------------- | -------------------------------------------- |
| `SUBAGENT_EXTENSION_FOR_CODEX_FIXTURE_READINESS`          | `ready` (default), `unavailable`, `error`    |
| `SUBAGENT_EXTENSION_FOR_CODEX_FIXTURE_READINESS_DELAY_MS` | Delay from 0 to 60000 ms                     |
| `SUBAGENT_EXTENSION_FOR_CODEX_FIXTURE_MODELS`             | `default`, `empty`, `error`, `error-once`    |
| `SUBAGENT_EXTENSION_FOR_CODEX_FIXTURE_MODELS_DELAY_MS`    | Delay from 0 to 60000 ms                     |
| `SUBAGENT_EXTENSION_FOR_CODEX_FIXTURE_DELETE_SESSION`     | `error` fails provider-side session deletion |
| `SUBAGENT_EXTENSION_FOR_CODEX_FIXTURE_CLOSE`              | `error` fails provider shutdown              |

For example:

```sh
SUBAGENT_EXTENSION_FOR_CODEX_FIXTURE_READINESS_DELAY_MS=1500 \
SUBAGENT_EXTENSION_FOR_CODEX_FIXTURE_MODELS=error-once npm run demo
```

The fixture keeps sessions and costs in memory. After a demo restart, old
sessions are gone and the service continues their tasks in fresh sessions.

## Queue, scheduling, and task-control scenarios

These scenarios exercise real task controls with the fake worker. See
[Chat](panel-guide.md#chat-tab) for the queue and steering controls.

| Check              | Procedure and expected result                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scheduler capacity | Start the demo with `SUBAGENT_EXTENSION_FOR_CODEX_CONCURRENCY=1`, then start two tasks with `[fixture:wait ms=15000]`. The second remains queued until capacity opens.                     |
| Dependencies       | Start B with `depends_on: [A.task_id]` while A waits. A successful turn releases B. `[fixture:fail]` on A fails B. An interrupted A can complete a later turn to release B.                |
| Queue and steer    | Send messages during a wait. `[fixture:slow]` takes steers at checkpoints. `[fixture:late]` leaves them for the next turn. Unconsumed steers precede queued messages.                      |
| Pause and resume   | Queue messages, then interrupt. A plain interrupt pauses the queue. **Interrupt and send now** starts the next turn. **Resume**, **Clear**, and a new idle-task message exercise recovery. |
| Queue editing      | Queue several messages during a wait, then edit, drag or remove them. Once a message starts, the service must reject those actions.                                                        |
| Pending input      | Use `[fixture:question]` or `[fixture:permission]`. A steer must reject while input is pending. After resolving it, submitting its old request ID must also reject.                        |

Eligibility, dependencies and concurrency decide when tasks run. Queue order
decides the order of messages within a task.

## Provider failure scenarios

| Check              | Procedure and expected result                                                                                                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Readiness          | Set readiness to `unavailable` or `error`. Discovery reports the problem and task creation rejects before persistence. Add a delay to inspect loading.                                                                        |
| Model discovery    | Use `empty`, `error` or `error-once` to inspect free-text fallback and retry. `error-once` succeeds on the next lookup.                                                                                                       |
| Model validation   | Choose `fixture-fast` with effort `high`. Creation rejects because that model has no effort support.                                                                                                                          |
| Failure boundaries | Use `[fixture:fail stage=start]`, `before-input`, `after-input`, `after-tools` or `before-reply`. The selected boundary ends the turn as failed.                                                                              |
| Runtime budget     | Set a `0.01` minute budget and `[fixture:wait ms=60000]`. The service aborts with `Runtime budget exhausted`.                                                                                                                 |
| Cost budget        | Set a small cost limit and `[fixture:cost usd=0.25]`, then continue. The service rejects continuation once stored cost reaches the limit. Use `error_max_budget_usd` as a completion subtype to preview the SDK-native error. |
| Workspace setup    | A nonexistent worktree revision fails during workspace creation. A non-`HEAD` revision for `current_repo` rejects at submission.                                                                                              |
| Session recovery   | Complete `[fixture:session state=invalid]`, then continue. The task starts a fresh session. Restarting the demo exercises process-local session loss.                                                                         |
| Session deletion   | Set the deletion error variable, then delete a task and its provider session. Local task/worktree data remains on failure. Restart without the variable and retry.                                                            |
| Shutdown           | Set the close error variable and stop gracefully. Shutdown reports the provider error.                                                                                                                                        |

## Service validation and authority scenarios

Use real tool calls to check the authority boundaries documented in
[Configuration](configuration.md) and [MCP reference](mcp-reference.md):

- Start in an unapproved repository, request an unsupported token budget, or
  submit invalid task or provider options. The service must reject each request
  before saving a task.
- As the parent, request approval authority above the user's saved policy or try
  to answer a user-routed permission. Use the panel to resolve the permission.
- Queue a user message, then try to remove it with the parent tool. Only the
  user-authorized tool can remove another sender's message.
- Try lowering an existing budget, replacing an unlimited budget with a finite
  limit, or raising a budget while the task runs.
- Remove a worktree while busy, delete its branch while still attached, or
  remove a project or task with surviving dependants. Each must be rejected
  until you resolve the condition.
- Complete `[fixture:change]` and remove the worktree without force. It must
  report uncommitted files and preserve them. Use force only to check explicit
  discard in the disposable demo repository.

The demo has a single owner, so service tests check app-only tool access and
cross-owner isolation. Task control and approval tests and
`src/service/platform/server/conversation-tools.integration.test.ts` cover
ownership, permission routing, stale input and queue controls.
