# Fixture provider scenarios

The fixture provider and demo service are documented in [Development: Demo](development.md#demo).
This guide lists the message keys, startup options, control paths, and error cases available for
deterministic provider and UI testing. The fixture makes no model calls or real tool execution.

The fixture worker (`dev/service/fixture-provider.ts`) and demo entry
(`dev/service/demo-service.ts`, run through `tsx`) are in `dev/`, excluded from production bundles
and the distributed package. Tests also import the fixture worker. It streams its reply in small
pieces and records the completed reply in its in-memory session history. Add scenario keys anywhere
in a task description or follow-up message. Multiple keys can be combined in one message.

- **Key:** `[fixture:question]` or `[fixture:question count=2]`
  - **Scenario:** Ask one or more questions and wait for answers. `[input]` remains an alias for one
    question.

- **Key:** `[fixture:permission]` or `[fixture:permission tool=Edit]`
  - **Scenario:** Request approval for a fake `Bash` or named tool call. `count=N` repeats the
    request.

- **Key:** `[fixture:tool name=Read]`
  - **Scenario:** Emit a successful fake tool start and result. `count=N` repeats it.

- **Key:** `[fixture:tool-error name=Read]`
  - **Scenario:** Emit a failed fake tool result. `count=N` repeats it.

- **Key:** `[fixture:content]`, `[fixture:thinking]`
  - **Scenario:** Emit content or a thinking block. `content` accepts `type=text`, `thinking`,
    `image`, `document`, `redacted_thinking`, `tool_use`, `tool_result`, `empty`, `error`, or an
    arbitrary block. Use `role=user`, `outcome=running` or `error` for tool content, and dotted
    fields such as `source.type=base64` to override block defaults.

- **Key:** `[fixture:assistant-error type=rate_limit]`
  - **Scenario:** Emit an empty SDK assistant message with an error code. `type` accepts every
    installed `SDKAssistantMessageError` value.

- **Key:** `[fixture:change]`
  - **Scenario:** Create a sample untracked file in the task's isolated worktree and emit
    `files_persisted`; it fails if the task uses the current repository.

- **Key:** `[fixture:subagent count=2]`
  - **Scenario:** Emit parallel child-worker lifecycles. Count is capped at four; `outcome=error`
    fails each child. The selected subagent restriction can block this flow.

- **Key:** `[fixture:restriction name=path_guard]`
  - **Scenario:** Emit a synthetic denial for `sandbox`, `environment`, `tools`, `path_guard`, or
    `subagents`, using the resolved fixture policy in its details.

- **Key:** `[fixture:activity type=status status=compacting]`
  - **Scenario:** Emit a Claude SDK activity event through the same activity presentation function
    used by Claude.

- **Key:** `[fixture:stream]`
  - **Scenario:** Emit a full stream start, content block, delta, stop-reason, and message-stop
    lifecycle.

- **Key:** `[fixture:stream frame=content_block_delta delta=thinking text=Fixture%20thought]`
  - **Scenario:** Emit one stream frame. Frames: `message_start`, `content_block_start`,
    `content_block_delta`, `content_block_stop`, `message_delta`, and `message_stop`. Delta kinds:
    `text`, `thinking`, and `input_json`.

- **Key:** `[fixture:session state=invalid]`
  - **Scenario:** Store an invalid session reference so the next continuation exercises session
    validation and recovery.

- **Key:** `[fixture:cost=0.25]` or `[fixture:cost usd=0.25]`
  - **Scenario:** Report a deterministic cumulative session cost; the default increment is `$0.001`.

- **Key:** `[fixture:wait=30000]` or `[fixture:wait ms=30000]`
  - **Scenario:** Keep a turn running for up to 60 seconds so it can be interrupted or steered.

- **Key:** `[fixture:slow]`, `[fixture:late]`
  - **Scenario:** Take pending steers over several checkpoints, or leave them for the next turn.

- **Key:** `[fixture:fail]`
  - **Scenario:** Fail after producing the reply. Add `stage=start`, `before-input`, `after-input`,
    `after-tools`, or `before-reply` to fail at that point.

- **Key:** `[fixture:completion subtype=error_max_turns]`
  - **Scenario:** Emit a non-success result subtype and fail the turn. `success` keeps it successful
    unless `is_error=true` or `outcome=error` is also set.

## SDK event and message scenarios

`[fixture:activity type=...]` covers the installed Claude Agent SDK `SDKMessage` activity variants.
The system subtypes are:

- `status`, `compact_boundary`, `api_retry`, `control_request_progress`, `model_refusal_fallback`,
  `model_refusal_no_fallback`, and `local_command_output`.
- `hook_started`, `hook_progress`, `hook_response`, `plugin_install`, `task_notification`,
  `task_started`, `task_updated`, and `task_progress`.
- `background_tasks_changed`, `thinking_tokens`, `session_state_changed`, `worker_shutting_down`,
  `commands_changed`, `notification`, and `files_persisted`.
- `memory_recall`, `elicitation_complete`, `permission_denied`, `mirror_error`, and `informational`.

Top-level variants are `tool_progress`, `auth_status`, `tool_use_summary`, `rate_limit_event`,
`prompt_suggestion`, and `conversation_reset`. The presentation fixtures also accept `init`,
`assistant`, `user`, and `stream_event`.

Exhaustive type maps cover the installed SDK activity variants. `typecheck` fails if the SDK adds
one without a fixture case. Each variant has a presentation-focused default payload; unknown strings
use a generic payload to exercise the unknown-event fallback. Override fields with `key=value`,
using dots for nested fields. For example:

```text
[fixture:activity type=rate_limit_event rate_limit_info.status=rejected]
```

URL-encode spaces in values. Activity fixtures run the shared presentation mapper; they do not
invoke Claude's SDK or the provider's event normalizer. The coverage follows the installed SDK's
`SDKMessage`, result, assistant-error, and stream-event types; see Anthropic's
[TypeScript Agent SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript).

The ordinary SDK message branches have dedicated triggers:

- `[fixture:content role=assistant type=text]` and `role=user` exercise assistant and user content.
- `type=image`, `type=document`, and `type=redacted_thinking` emit their matching content blocks.
  Override nested payload fields such as `source.data=ZmFrZQ==`.
- `type=tool_use` and `type=tool_result` exercise tool rows.
- `type=empty` and `type=error` exercise empty and error content.

`[fixture:assistant-error type=rate_limit]` accepts the SDK error codes `authentication_failed`,
`oauth_org_not_allowed`, `account_on_hold`, `verification_required`, `billing_error`, `rate_limit`,
`overloaded`, `invalid_request`, `model_not_found`, `server_error`, `unknown`, `max_output_tokens`,
and `cloud_credential_error`. Pair it with `[fixture:completion subtype=error_during_execution]` to
show a failed final result too.

`[fixture:stream]` emits all six Messages API frames. `[fixture:completion subtype=...]` emits a
result. The installed result error subtypes are `error_during_execution`, `error_max_turns`,
`error_max_budget_usd`, and `error_max_structured_output_retries`. Use
`subtype=success is_error=true` to exercise the SDK's successful subtype with the error flag set.

## Permission and worker-policy scenarios

The fixture advertises the same task-level permission controls as Claude so the delegation form and
approval routing can be exercised. `[fixture:permission]` requests an action; the selected simulated
mode determines whether it waits, allows, or denies:

- `inherit` follows the configured fixture permission mode.
- `default` follows the fixture execution approval mode.
- `plan` and `dontAsk` deny; `acceptEdits` allows edit tools.
- `auto` and `bypassPermissions` allow.

`approval_decider` selects user or parent routing. To make `[fixture:subagent]` take its blocked
branch, set the user setting `claude_subagents` to `false`. Select `researcher`, `reviewer`, or
`security_reviewer` to exercise the read-only worker profile policy.

These are deterministic UI scenarios only: they do not reproduce Claude's permission classifier, run
tools, or apply sandbox, environment, or path isolation. Permission and restriction scenarios do not
create files. `[fixture:change]` is separate: it writes only its generated sample file to an
isolated task worktree to exercise Git change and review surfaces, and refuses to write into the
current repository.

Workspace strategy, worker profile, model, reasoning effort, runtime and cost limits, dependencies,
and task input are the real shared control-plane fields; select them in the ordinary task form. Use
a wait key to inspect runtime limits, a cost key to inspect cost limits, and the permission,
question, tool, and subagent keys to drive their corresponding flows.

Readiness and model discovery happen before a task prompt, so configure them when starting
`npm run demo`. These variables reproduce loading, unavailable, empty-catalog, and error states:

| Variable                                              | Values                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| `CODEX_SUBAGENT_EXTENSION_FIXTURE_READINESS`          | `ready` (default), `unavailable`, or `error`                        |
| `CODEX_SUBAGENT_EXTENSION_FIXTURE_READINESS_DELAY_MS` | Delay from 0 to 60000 ms                                            |
| `CODEX_SUBAGENT_EXTENSION_FIXTURE_MODELS`             | `default` (two in-memory models), `empty`, `error`, or `error-once` |
| `CODEX_SUBAGENT_EXTENSION_FIXTURE_MODELS_DELAY_MS`    | Delay from 0 to 60000 ms                                            |
| `CODEX_SUBAGENT_EXTENSION_FIXTURE_DELETE_SESSION`     | `error` makes provider-side session deletion fail                   |
| `CODEX_SUBAGENT_EXTENSION_FIXTURE_CLOSE`              | `error` makes provider shutdown fail                                |

For example, start the demo with a slow readiness check and a one-time model discovery failure
using:

```sh
CODEX_SUBAGENT_EXTENSION_FIXTURE_READINESS_DELAY_MS=1500 \
CODEX_SUBAGENT_EXTENSION_FIXTURE_MODELS=error-once npm run demo
```

The constructor also accepts initial in-memory model choices and readiness or model behavior for
code that instantiates `FixtureProvider` directly. Sessions and cumulative costs live in memory;
restarting the demo makes old sessions unavailable. Scenario `count` values are capped at five;
subagent lifecycles are capped at four.

For content rows:

- `type=tool_use outcome=running` leaves a started tool row without a result.
- `type=tool_use outcome=error` emits a failed tool result.
- `type=tool_result outcome=error` emits an already-failed result.
- `type=empty` emits an empty message; `type=error` emits an empty-message error activity.
- Any other `type` produces a generic content block so future SDK content can be previewed.

## Queue, scheduling, and task-control scenarios

These are real control-plane paths using the fixture worker. They do not need a prompt marker unless
one is shown below.

- **Task waits in the scheduler queue**
  - **Trigger:** Start two tasks with `[fixture:wait ms=15000]`; set
    `CODEX_SUBAGENT_EXTENSION_CONCURRENCY=1` before `npm run demo` to make the wait visible.
  - **Expected:** The first eligible task runs; the other stays `queued` until capacity opens. The
    default concurrency is 3.

- **Dependency waits, releases, or fails**
  - **Trigger:** Start task A, then start task B with `depends_on: [A.task_id]`. Give A
    `[fixture:wait ms=15000]` to see B wait. Use `[fixture:fail stage=before-reply]` on A to make B
    fail with its dependency; interrupt A and later complete a follow-up to release B.
  - **Expected:** B has `waiting_reason=waiting_for_dependency` while A has not completed a turn; it
    starts after a successful dependency turn or fails after a failed dependency.

- **Queue a follow-up**
  - **Trigger:** While a task is running, press **Enter** in the composer; while waiting for a
    question or permission, press **Enter**. Via MCP call `send_agent_message` with
    `delivery: "queue"`.
  - **Expected:** The message waits for its own turn. A successful turn drains queued messages in
    order.

- **Steer the running turn**
  - **Trigger:** Start with `[fixture:wait ms=15000]`, then use **Cmd/Ctrl+Enter** in the composer
    or `send_agent_message` with `delivery: "steer"`. `[fixture:slow]` gives several opportunities
    to take it; `[fixture:late]` leaves it for the next turn.
  - **Expected:** A steer is delivered at a provider checkpoint; a steer not taken becomes the first
    queued message after the turn ends.

- **Interrupt, interrupt-and-send, and paused queue**
  - **Trigger:** Queue at least one message during `[fixture:wait ms=15000]`. Use **Stop the turn**
    or `interrupt_agent_task`. To carry pending steers straight into the next turn, use **Interrupt
    and send now** or `interrupt_agent_task` with `send_pending: true`.
  - **Expected:** A plain interrupt pauses a non-empty queue; interrupt-and-send starts the next
    turn with pending steers.

- **Rearrange queued messages**
  - **Trigger:** Put at least two unsent messages in the chat queue. Drag a row, or focus it and
    press **Alt+Up/Down**.
  - **Expected:** Only unrecorded queue entries move. Any steer already held by the worker stays
    ahead of them. The zero-based `move_user_agent_queued_message` tool is panel-only.

- **Edit or remove a queued message**
  - **Trigger:** Use the row's **Edit**, **Save**, or **Remove** controls. MCP parent agents can
    call `remove_agent_queued_message` only for messages they queued.
  - **Expected:** Editing is available only before a message starts; users can remove either
    sender's message, while a parent can remove only its own.

- **Resume or clear a paused queue**
  - **Trigger:** Interrupt or fail a turn with queued entries. Select **Resume** or **Clear**, or
    call `resume_user_agent_queue` / `clear_user_agent_queue`.
  - **Expected:** Resume starts the next message when idle; Clear removes all queued entries.
    Sending a new message to an idle task also resumes its queue.

- **Input validation and stale requests**
  - **Trigger:** Create `[fixture:question]` or `[fixture:permission]`. Answer it, then submit the
    old request ID again with `submit_agent_input`; while it is pending, attempt
    `send_agent_message` with `delivery: "steer"`.
  - **Expected:** The old input ID is rejected as stale. A waiting task rejects a steer; queue a
    message or answer the pending request instead.

Task scheduling order is controlled by eligibility, dependencies, and the concurrency limit. The
task list has no manual priority/reorder control; use `depends_on` when one task must wait for
another. Chat message order is rearrangeable as described above.

## Failure scenarios

- **Provider unavailable before start**
  - **Trigger:** Start the demo with `CODEX_SUBAGENT_EXTENSION_FIXTURE_READINESS=unavailable`; try
    to create a task.
  - **Expected:** Worker stays listed as unavailable and task creation is rejected before
    persistence.

- **Readiness check throws or is slow**
  - **Trigger:** Use `CODEX_SUBAGENT_EXTENSION_FIXTURE_READINESS=error` or set
    `CODEX_SUBAGENT_EXTENSION_FIXTURE_READINESS_DELAY_MS=1500`.
  - **Expected:** Worker discovery/start reports the configured error or remains loading for the
    delay.

- **Empty or failing model discovery**
  - **Trigger:** Use `CODEX_SUBAGENT_EXTENSION_FIXTURE_MODELS=empty`, `error`, or `error-once`; use
    `CODEX_SUBAGENT_EXTENSION_FIXTURE_MODELS_DELAY_MS` for loading. Retry after `error-once`.
  - **Expected:** Empty catalog leaves a free-text model; discovery errors expose fallback/free-text
    behavior, and `error-once` succeeds on the next lookup.

- **Invalid model effort**
  - **Trigger:** Choose `fixture-fast` with a non-default reasoning effort such as `high`.
  - **Expected:** Start is rejected before task persistence because that model has no effort
    support.

- **Provider run failure at a boundary**
  - **Trigger:** Use `[fixture:fail stage=start]`, `before-input`, `after-input`, `after-tools`, or
    `before-reply`.
  - **Expected:** The turn ends failed at the selected stage and records one failed completion.

- **SDK result failure**
  - **Trigger:** Use `[fixture:completion subtype=error_during_execution]`, `error_max_turns`,
    `error_max_budget_usd`, or `error_max_structured_output_retries`.
  - **Expected:** The fixture emits the selected non-success completion and fails the turn.

- **SDK assistant API error**
  - **Trigger:** Use `[fixture:assistant-error type=rate_limit]` with any listed SDK assistant error
    code. Pair with `[fixture:completion subtype=error_during_execution]` for the terminal result.
  - **Expected:** The SDK assistant error activity and, when requested, a failed result are both
    visible.

- **SDK success result carrying an error**
  - **Trigger:** Use `[fixture:completion subtype=success is_error=true]`.
  - **Expected:** Provider treats the nominal success subtype as an error, matching its SDK result
    handling.

- **Tool and child-worker errors**
  - **Trigger:** Use `[fixture:tool-error name=Read]` or `[fixture:subagent count=2 outcome=error]`.
  - **Expected:** Tool rows or child lifecycles show errors; these do not by themselves fail the
    parent turn.

- **Runtime budget**
  - **Trigger:** Start with a `0.01` minute runtime budget and `[fixture:wait ms=60000]`.
  - **Expected:** Control aborts the running turn when the budget expires and records
    `Runtime budget exhausted`.

- **Cost budget**
  - **Trigger:** Start with a small cost limit and `[fixture:cost usd=0.25]`, then send a follow-up.
    For the SDK result presentation use `[fixture:completion subtype=error_max_budget_usd]`.
  - **Expected:** The fixture reports cumulative cost. The control plane rejects a continuation once
    stored cost has reached the limit; use the completion marker to display the SDK-native budget
    error subtype.

- **Unsupported token budget**
  - **Trigger:** Start a fixture task with `budget.max_tokens: 1`.
  - **Expected:** The provider rejects it before task persistence because token budgets are
    unsupported.

- **Workspace validation/execution**
  - **Trigger:** Start `current_repo` with a revision other than `HEAD` (rejected at start); or
    start a `worktree` task at a nonexistent revision (queued task fails while creating its
    workspace). `[fixture:change]` requires `worktree`; with `current_repo` it fails the turn.
  - **Expected:** These cover request validation, workspace creation failure, and safe fixture-file
    restrictions.

- **Session validation and restart**
  - **Trigger:** Use `[fixture:session state=invalid]`, wait for completion, then send a follow-up.
    To simulate process loss, restart the demo service and continue an old task.
  - **Expected:** Invalid or process-local sessions start a fresh fixture session and emit
    `task.session_started` with `session_unavailable`.

- **Provider session deletion**
  - **Trigger:** Start the demo with `CODEX_SUBAGENT_EXTENSION_FIXTURE_DELETE_SESSION=error`, create
    a task, then delete it with `delete_agent_task: true`.
  - **Expected:** Provider deletion fails; local task/worktree data is retained. Restart without the
    error variable and retry deletion.

- **Provider shutdown**
  - **Trigger:** Run a direct provider check with
    `new FixtureProvider({ closeError: true }).close()`, or set
    `CODEX_SUBAGENT_EXTENSION_FIXTURE_CLOSE=error` before a graceful service shutdown.
  - **Expected:** Shutdown reports the provider close error.

Other service-level rejections use the real API inputs and task controls:

- **Invalid task request or provider options**
  - **Trigger:** Call `start_agent_task` with a whitespace-only description, or
    `provider_options: { fixture: { permission_mode: "not-a-mode" } }`. For known-model validation,
    choose `fixture-fast` and `reasoning_effort: "high"`.

- **Disabled provider or unsupported budget**
  - **Trigger:** Start a task with `provider: "missing"`, `budget.max_tokens: 1`, or a non-null
    `max_cost_usd` when using a provider whose `cost_budget` capability is false. Fixture supports
    cost/runtime budgets but not token budgets.

- **Parent approval escalation**
  - **Trigger:** With the user default still `ask_user` / `approval_decider: "user"`, call
    `start_agent_task` as the parent with `approval_mode: "parent_agent"` or fixture
    `approval_decider: "parent_agent"`; try `update_agent_settings` as the parent.

- **Unapproved repository**
  - **Trigger:** Call `start_agent_task` with an absolute repository path that is not returned by
    `list_agent_projects`; the demo has only its disposable repository approved. In the panel, ask
    to use **Add project** or **Browse** in the panel.

- **Invalid worktree revision**
  - **Trigger:** Create a worktree task with a revision that does not exist. Creation is accepted
    into the task queue, then workspace setup fails the task. For `current_repo`, use any revision
    other than `HEAD` to reject at start validation.

- **Parent cannot approve a user-routed permission**
  - **Trigger:** Start `[fixture:permission]` with fixture `approval_decider: "user"`, then call
    `submit_agent_input` as the parent with the exact pending `request_id`. Use the user approval
    button to resolve it.

- **Stale permission or question answer**
  - **Trigger:** Start `[fixture:permission]` or `[fixture:question]`, save `pending_input.id`,
    resolve or interrupt it, then submit the saved ID again. The request is rejected as stale.

- **Parent attempts a steer while input is pending**
  - **Trigger:** Start `[fixture:question]`, then call `send_agent_message` with
    `delivery: "steer"`. Use `delivery: "queue"` or submit the input instead.

- **Parent removes a user message**
  - **Trigger:** Call `send_user_agent_message` with `delivery: "queue"` while
    `[fixture:wait ms=15000]` runs, then try to remove its `message_id` with
    `remove_agent_queued_message`. Use `remove_user_agent_queued_message` to remove it.

- **Edit, move, or remove after a queue item starts**
  - **Trigger:** Queue a message during `[fixture:wait ms=15000]`, let the worker start it, then
    call the matching edit/move/remove tool with the old `message_id`.

- **Interrupt an idle task**
  - **Trigger:** Wait for a fixture task to complete, then call `interrupt_agent_task` with its
    `task_id`.

- **Budget increase is invalid**
  - **Trigger:** Start with `max_cost_usd: 2`, then call `raise_user_agent_budget` with
    `max_cost_usd: 1` or the unchanged value `2`. To test the busy rejection, use
    `[fixture:wait ms=15000]` and raise while the turn is running.

- **Invalid budget update**
  - **Trigger:** Start without a cost limit, then try to lower a finite budget, set a runtime/cost
    value outside the schema bounds, or submit an empty/unknown settings field to
    `update_agent_settings`.

- **Dependency prevents deletion**
  - **Trigger:** Start task A, start task B with `depends_on: [A.task_id]`, then call
    `delete_user_agent_task` for A. Delete B first, then A.

- **Project removal is blocked**
  - **Trigger:** With `Projects` enabled in the integration service, register a repository, create
    task A there, create task B in another project depending on A, then call
    `remove_user_agent_project` with `delete_tasks: true`. Remove B first.

- **Worktree action while busy**
  - **Trigger:** Start `[fixture:wait ms=15000]` in a worktree, then call
    `remove_user_agent_worktree` or `delete_user_agent_branch`. Both require an idle task.

- **Uncommitted worktree removal**
  - **Trigger:** Complete a worktree task with `[fixture:change]`, then call
    `remove_user_agent_worktree` with `force: false`; it returns the uncommitted files and removes
    nothing. `force: true` exercises the explicit discard path in the disposable demo repository.

- **Branch deletion before worktree removal**
  - **Trigger:** Complete a worktree task and call `delete_user_agent_branch` before removing its
    worktree. Remove the worktree first, then the branch.

- **Rename validation**
  - **Trigger:** Call `rename_user_agent_task` with an empty/whitespace title or a title over 200
    characters; for project rename use an unregistered repository or invalid name.

- **User-only MCP tool called by a parent**
  - **Trigger:** In the service test helper, call
    `callTool(c, owner, <user-only tool>, args, "parent")`, for example `submit_user_agent_input` or
    `update_user_agent_settings`. The UI helper with authority `"user"` is required.

- **Task ownership**
  - **Trigger:** In a two-owner service test, create a task as `alice`, then use its ID as `bob` for
    task inspection, input, queue, or delete controls. These resolve as not found. The single-owner
    demo token cannot create this condition.

Queue, ownership, budget, dependency, workspace, and project cleanup rejection tests are in
[`control.test.ts`](../src/service/features/tasks/runtime/control.test.ts),
[`approval.test.ts`](../src/service/features/tasks/input/approval.test.ts),
and
[`conversation-tools.test.ts`](../src/service/platform/server/conversation-tools.test.ts).
