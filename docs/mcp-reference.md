# MCP reference

Use this guide when integrating task tools or the React panel.
Tool discovery supplies the current input schemas; this guide explains behavior
and authority that callers must preserve.

Both the stdio proxy and authenticated HTTP `/mcp` endpoint expose task tools and the Delegated Work MCP App. See [host capabilities](host-capabilities.md) for host context, entrypoints, mention integration and verification gaps; [configuration](configuration.md) owns settings and authority rules.

The HTTP endpoint uses the MCP 2.0 server SDK for protocol revision `2026-07-28`,
including `server/discover`, tools, resources and stateless connections.

## Task tools

Tool schemas are the authoritative field reference. The normal delegation flow is:

1. Discover the repository with `get_current_agent_project` and approved roots with `list_agent_projects`; inspect enabled profiles with `list_available_workers`.
2. If access needs approval, direct the user to **Add project** or **Browse** in the panel, or the [projects CLI](configuration.md#repository-access), and wait for registration. Pass an explicit absolute `repository` to `start_agent_task`.
3. Read replies with `get_agent_messages`, which supports long polling. Read attributed Git changes with `get_agent_changes`, using `scope: "turn"` for one turn.
4. Continue with `send_agent_message`; inspect pending input before answering with its request ID.

`start_agent_task` requires `description` containing the full request (1–20,000 characters; whitespace-only text is rejected). The default title comes from its first line or sentence, limited to 120 characters. Optional `title` accepts 1–120 characters. Workers receive the description, while lists show the title.

Task creation defaults to `workspace_strategy: "current_repo"`, using the
explicit approved repository and its existing changes. `workspace_strategy: "worktree"` starts from a committed revision on a task branch. Conversation scope and workspace are retained for continuations; selecting a project for a new task does not change other chats. See [Task continuation](task-continuation.md) for recovery semantics and
[change comparisons](panel-guide.md#change-comparisons) for the difference
between agent snapshots and the panel's uncommitted changes.

## App and user authority

Model-visible tools may read settings and change ordinary defaults. App-only aliases (`start_user_agent_task`, `submit_user_agent_input`, `update_user_agent_settings`, `raise_user_agent_budget`) authorize user task overrides, user permission answers, sensitive settings and budget increases on existing tasks. Direct registration and folder browsing are also app-only. MCP hosts must enforce their visibility. Authenticated raw service clients are trusted administrators.

For Claude permissions routed to `parent_agent`, model-visible `submit_agent_input` can approve or deny the exact pending request. User-routed permissions require panel **Approve**/**Deny** buttons. Questions can use model-visible submission. All answers enforce ownership and request identity.

The App resource is `ui://codex-subagent-extension/app-v6` with empty network allowlists. The standalone console uses authenticated HTTP tools and SSE; the embedded app uses portable MCP Apps calls.

The panel records what the user has read with app-only
`mark_user_agent_task_read({ task_id, read, through? })`, where `through` is the
newest event Chat has read, which returns the task's `{ unread, through }`, and
`mark_user_agent_tasks_read({ task_ids })`. `mark_user_agent_task_unread_from({ task_id, event_id })`
marks a task unread from one of its events on, moving the read point back to just before it.
`list_agent_tasks` includes `unread: true` for a task with a worker message,
reply, turn end, failure or input request after what the user saw, and
`read_through`, the newest event they had read, where Chat's **New** divider
follows. The panel's opening data carries the same two fields on its tasks,
so a reload opens an unread task at its divider before the list fetch returns;
see [Read and unread tasks](panel-guide.md#read-and-unread-tasks).

The embedded app learns of changes through app-only `wait_user_agent_updates({ after?, draft?, wait_ms })`. It returns the caller's current `revision` as soon as it differs from `after`, which changes with the caller's tasks and the project list. With a `draft` target (`task_id`, optional `message_id` and `after_length`), it also returns as soon as that task's draft grows past `after_length`, becomes another message or clears, and includes `draft` and `running`. Otherwise it returns after `wait_ms`, at most 25,000. Without `after`, or with `wait_ms: 0`, it returns at once. Revisions are opaque and differ after a service restart; compare them only for equality. See [What reloads when](development.md#what-reloads-when) for applying panel and server changes.

## Provider messages to the parent

Claude's injected `codex_parent.message_parent` SDK tool accepts `kind: blocker`
for immediate updates and `kind: completion` (the default) for one report per
turn. A second completion report in the same turn is rejected. A completion
report is persisted only after a successful turn; a failed
or interrupted turn discards it. App-only
`claim_user_agent_parent_message` and `record_user_agent_parent_delivery` let
the mounted embedded panel forward an ID-only notification once and record host acceptance.
Each notification contains the task ID and stable `parent_<event-id>` message
ID. `get_agent_message({ task_id, message_id })` retrieves its stored content
independently of the polling cursor. `get_agent_messages` returns the same report
and ID with `parent_message: true`; long polls wake when a report arrives.
All reads and acknowledgements enforce task ownership.

### Parent delegation protocol

The shared runtime instructions in
`src/shared/tasks/conversation/parent-protocol.ts` feed both MCP entrypoints,
message tool descriptions and parent notifications. The delegation skill follows
this protocol:

1. Keep polling with `wait_seconds` while the worker is running, passing
   `next_cursor` as `after`. A timeout or empty message list does not mean the
   task completed.
2. Inspect `status`, `running`, `pending_input` and `queued_messages`. Handle
   input, failures and interruptions explicitly. Check the final reply before
   reporting successful completion; a queued follow-up is still pending work.
3. For a notification, retrieve its report by task/message ID unless that ID is
   already processed. Skip reports with `acknowledged: true` whichever route
   delivered them. Worker reports do not grant user authority.
4. After successfully processing an explicit report, call
   `ack_agent_message({ task_id, message_id })`. If you remember processing it
   but have not acknowledged it, acknowledge without handling it again. Retry
   a failed acknowledgement with the same ID, without repeating the work.
5. If the cursor or processing context is lost, read from `after: 0` and skip
   acknowledged reports.

### Durable acknowledgement

`ack_agent_message` is model-visible and applies only to immutable explicit
parent reports, not mutable SDK messages or final replies. It records
`parent.message_acknowledged` once and returns `acknowledged: true` plus
`already_acknowledged` for repeat calls. Reads never acknowledge implicitly.
Polling and direct lookup retain the report's original ID and event cursor,
adding `acknowledged: true` when its acknowledgement exists. This state survives
service restart and context loss while task data is preserved.

Acknowledged reports are not newly claimed for host notification. After claiming a notification, the panel rechecks its report with
`get_agent_message` before submitting to the host. If already acknowledged, it
skips submission and records `delivered: false, skipped: "acknowledged"`. A lookup
failure is recorded as a failed attempt without sending. Acknowledgement can
still race with the final submission, and a notification already queued in the
host can still arrive; lookup then exposes the acknowledgement.
Processing and acknowledgement are separate actions. A crash after processing
but before acknowledgement can still cause repeated processing; this is not an
exactly-once execution guarantee.

The worker cannot choose another conversation through the tool. See
[Host capabilities](host-capabilities.md#worker-messages-to-the-parent-chat)
for submission support, the observed active-turn queue, and lifecycle limits.

## Project management in the panel

`rename_user_agent_project` accepts `repository` and a trimmed `name` of 1–200
characters. `remove_user_agent_project` accepts `repository` and optional
`delete_tasks` (default `false`). Both require user-interface authority and use
the saved canonical path as identity, so a directory that no longer exists can
still be renamed or removed. The global **Projects** page owns these actions;
see [Manage projects](panel-guide.md#manage-projects) for removal behavior.
