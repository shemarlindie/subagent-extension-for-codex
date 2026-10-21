# MCP reference

Use this guide when integrating task tools or the React panel. It explains the
behavior and authority rules callers must preserve. Tool discovery supplies the
current input schemas.

The stdio proxy and the authenticated HTTP `/mcp` endpoint expose the same task
tools and Delegated Work MCP App. The HTTP endpoint uses the MCP 2.0 server SDK
for protocol revision `2026-07-28`, including `server/discover`, tools,
resources and stateless connections.

- [Host capabilities](host-capabilities.md) covers host context, entrypoints,
  mentions and verification gaps.
- [Configuration](configuration.md) covers settings and repository access.

## Task tools

To delegate a task:

1. Find the chat's repository with `get_current_project` and approved roots with
   `list_projects`. Inspect enabled profiles with `list_workers`.
2. Pass an approved root's absolute path as `repository` to `start_task`. For an
   unregistered root, the
   [task-start registration policy](configuration.md#repository-access) may
   apply. Otherwise, direct the user to **Add project**, **Browse** or the
   projects CLI and wait for registration.
3. Read replies with `list_messages`, which supports long polling. Read recorded
   edits with `get_changes`, using `scope: "turn"` for the latest turn.
4. Continue with `send_message`. Inspect pending input before answering it with
   `submit_input` and its request ID.

Put the full worker request in `description`. The service generates the task
title from its first line or sentence.

The default `workspace_strategy: "current_repo"` uses the approved checkout
with its existing changes. `workspace_strategy: "worktree"` starts a task branch
from a committed revision. Follow-up turns keep the task's conversation scope
and workspace. See [Task continuation](task-continuation.md) for recovery.

### Retrying message sends

`send_message` and `app_send_message` accept an optional `request_id`. Use a
unique ID for each intended message. When a response is uncertain, retry with
the same ID, task, sender, text, delivery and budget.

- The service coalesces concurrent requests and saves a receipt with the
  accepted message. A retry returns the original message ID and accepted state,
  with the task's current status.
- Reusing an ID with different content fails.
- Receipts survive service restart and last until the task is deleted.
- A receipt confirms acceptance. It says nothing about worker consumption or
  turn completion.

A timeout does not cancel server work. An interrupting send can be accepted
before its turn finishes shutting down, and retrying it confirms the message
without interrupting again. Repository approval and ownership checks still apply
to new messages.

When the service confirms that a failed send has no receipt, HTTP errors include
`send_rejected: true` and MCP tool errors include `_meta.send_rejected: true`.
Discard the request ID only for that explicit rejection. Other errors can occur
after acceptance, so retry them with the original ID.

## Recorded changes

`get_changes` reads the task's recorded net edits for `scope: "task"` (the
default) or `scope: "turn"` (the latest turn). Both workspace strategies, the
panel and dependency prompts use the same stored diffs. Committing files,
removing a worktree or deleting its branch leaves a recorded diff unchanged.
Dependency prompts include these edits up to the prompt limit and note
incomplete files and unrecorded command changes.

- Every page lists all files, sorted by path. Diff pages split between whole
  files.
- Each file has `source: "tool" | "command"`, `incomplete`, and a status of
  `added`, `modified` or `deleted`.
- An incomplete file has no diff. It counts as a file but adds no lines to the
  totals.
- When a command changed files it could not name, the response says some
  command changes were not recorded.
- A reverted file, or one created and deleted in the same scope, drops out
  unless it is incomplete.

`get_changed_file` reads a file as it is now, from the task worktree or approved
checkout, so later edits by others can appear. It reads only paths recorded in
the task or latest-turn scope. A missing file returns `deleted`, and a removed
worktree returns `unavailable`. Images return base64 content and other binary
files return their size.

`app_get_change_counts` reads totals from the same stored diffs.

### Recording limits

- Claude's edit tools and Bash commands are recorded. File-writing MCP tools and
  processes a command leaves running are not.
- Some Git checkout commands, such as `git restore file.txt`, report that
  changes were not recorded, without file diffs. Other Git commands can return
  precise diffs or no edit data. Read-only commands with no edit data create no
  warning.
- Highly repetitive text can produce a valid diff that is not minimal.
- An `Edit` to an existing empty file appears as an added file.
- Renames appear as a deletion and an addition.
- File previews show current disk content, including later edits by others.

## App and user authority

Tools starting with `app_` are app-only. MCP hosts must hide them from the
model. Authenticated raw service clients are trusted administrators.

Model-visible tools may read settings and change ordinary defaults. App-only
tools carry user authority:

| Tool                                                                    | User authority                                       |
| ----------------------------------------------------------------------- | ---------------------------------------------------- |
| `app_start_task`                                                        | Task overrides                                       |
| `app_submit_input`                                                      | Answers to permissions routed to the user            |
| `app_update_settings`                                                   | Sensitive settings                                   |
| `app_raise_budget`                                                      | Budget increases on existing tasks                   |
| `app_register_project`, `app_browse_project`                            | Direct registration and folder browsing              |
| `app_rename_project`, `app_remove_project`                              | [Project management](panel-guide.md#manage-projects) |
| `app_set_tasks_archived`, `app_delete_tasks`                            | [Archive](panel-guide.md#archive-tasks) and deletion |
| `app_set_task_read`, `app_mark_tasks_read`, `app_mark_task_unread_from` | [Read state](panel-guide.md#read-and-unread-tasks)   |
| `app_steer_queued_message`                                              | Moving a queued message into the running turn        |

Other `app_` tools serve panel reads and controls.

For Claude permissions routed to `parent_agent`, model-visible `submit_input`
can approve or deny the exact pending request. Permissions routed to the user
need the panel's **Approve** or **Deny** buttons. Questions accept model-visible
answers. The service checks task ownership and the request ID for every answer.

Project rename and removal use the saved canonical path, so they work after the
directory is gone. `list_tasks` reports `archived_at` for archived tasks. Read
points belong to the user and drive unread status and Chat's **New** divider.

`app_steer_queued_message` keeps the message's ID, text and sender. The worker
must have no pending input request. If the turn can no longer accept the steer,
the message stays at the front of the queue.

`app_wait_for_updates` returns when the owner's revision or a targeted reply
draft changes, or after at most 25 seconds. Revision tokens are opaque and change
after a service restart, so compare them only for equality. See
[Transport](panel-guide.md#transport) for panel refresh behavior.

The embedded app uses the authenticated MCP Apps bridge, and the standalone
console uses HTTP and SSE. See
[Panel network access](host-capabilities.md#panel-network-access).

## Provider messages to the parent

Claude's injected `codex_parent.send_message` SDK tool reports to the parent
agent:

- `kind: "blocker"` saves an update immediately.
- `kind: "completion"`, the default, sends one report per turn. The service
  rejects a second one in the same turn. It saves the report after a successful
  turn and discards it if the turn fails or is interrupted.

Each report gets a stable `parent_<event-id>` message ID. The parent can read it
three ways:

- `get_message({ task_id, message_id })` reads it regardless of the polling
  cursor.
- `list_messages` returns it with `parent_message: true`. Long polls wake when a
  report arrives.
- The mounted embedded panel forwards an ID-only notification once, using
  app-only `app_claim_parent_message` and `app_record_parent_delivery` to claim
  it and record host acceptance.

The service checks task ownership on every read and acknowledgement. The worker
cannot choose another conversation. See
[Host capabilities](host-capabilities.md#worker-messages-to-the-parent-chat) for
host support and unverified delivery cases.

### Parent delegation protocol

`src/shared/tasks/conversation/parent-protocol.ts` defines the runtime
instructions that feed both MCP entrypoints, message tool descriptions and
parent notifications. The delegation skill follows the same protocol:

1. Keep polling with `wait_seconds` while the worker runs, passing `next_cursor`
   as `after`. A timeout or empty message list does not mean the task completed.
2. Inspect `status`, `running`, `pending_input` and `queued_messages`. Handle
   input, failures and interruptions explicitly. Check the final reply before
   reporting success. A queued follow-up is still pending work.
3. For a notification, retrieve the report by task and message ID unless you
   already processed it. Skip reports with `acknowledged: true`, whichever route
   delivered them. Worker reports do not grant user authority.
4. After processing a report, call `acknowledge_message({ task_id, message_id })`.
   If you processed it but did not acknowledge it, acknowledge without handling
   it again. Retry a failed acknowledgement with the same ID without repeating
   the work.
5. If you lose the cursor or processing context, read from `after: 0` and skip
   acknowledged reports.

### Durable acknowledgement

`acknowledge_message` is model-visible and applies only to explicit parent
reports, which are immutable. It records `parent.message_acknowledged` once and
returns `acknowledged: true`, plus `already_acknowledged` on repeat calls. Reads
never acknowledge. Polling and direct lookup keep the report's original ID and
event cursor and add `acknowledged: true` once acknowledged. This state survives
service restart and context loss while task data remains.

The service stops claiming acknowledged reports for host notification, and the
panel rechecks before sending. Acknowledgement can still race with submission,
and it cannot remove a notification already queued in the host.

Processing and acknowledgement are separate actions. A crash between them can
cause repeated processing, so this is no exactly-once guarantee.
