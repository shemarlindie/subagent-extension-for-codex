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

1. Find the chat's project with `get_current_project` and approved roots with
   `list_projects`, which reports each one's `git` state. Inspect enabled
   profiles with `list_workers`. Its `policy` field reports what
   [org policy](configuration.md#org-policy) limits. `start_task` fails with the
   reason when you ask for a mode or model it rules out.
2. Pass an approved root's absolute path as `repository` to `start_task`. For an
   unregistered root, the
   [task-start registration policy](configuration.md#repository-access) may
   apply. Otherwise, direct the user to **Allow tasks here**, **Add project**,
   **Browse** or the projects CLI and wait for registration.
3. Read replies with `list_messages`, which supports long polling. Read recorded
   edits with `get_changes`, using `scope: "turn"` for the latest turn.
   `list_tasks` returns summaries, without archived tasks unless `archived` asks
   for them. Read a task's full state with `get_task`.
4. Continue with `send_message`. Inspect pending input before answering it with
   `submit_input` and its request ID.

Put the full worker request in `description`. The service generates the task
title from its first line or sentence.

The default `workspace_strategy: "current_repo"` uses the approved checkout with
its existing changes. `workspace_strategy: "worktree"` starts a task branch from
a committed revision. Follow-up turns keep the task's conversation scope and
workspace. See [Task continuation](task-continuation.md) for recovery.

Claude tasks take `provider_options.claude.permission_mode`, `approval_decider`
and `sandbox`. Read-only profiles start in `plan` unless `permission_mode` names
another mode. `sandbox: true` runs Bash in Claude Code's sandbox. A model can't
raise the mode or route approvals to itself beyond the settings, or turn off a
sandbox the settings turn on. See
[Claude permissions](configuration.md#claude-permissions) and
[session restrictions](configuration.md#claude-session-restrictions).

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
- When a command changed files it could not name, the response says some command
  changes were not recorded.
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
- In a folder without Git, Claude Code reports no Bash edit data, so any command
  sets `unrecorded_commands`, even one that only read files. `Write` and `Edit`
  are still recorded. A Git repository without commits records both.
- Highly repetitive text can produce a valid diff that is not minimal.
- An `Edit` to an existing empty file appears as an added file.
- Renames appear as a deletion and an addition.
- File previews show current disk content, including later edits by others.

## App and user authority

Tools starting with `app_` are app-only. MCP hosts must hide them from the
model. Authenticated raw service clients are trusted administrators.

Model-visible tools may read settings and change ordinary defaults.
`get_settings` marks user-only setting groups with `userOnly: true` in its
schema. App-only tools carry user authority:

| Tool                                                                    | User authority                                                             |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `app_start_task`                                                        | Task overrides                                                             |
| `app_submit_input`                                                      | Answers to permissions routed to the user                                  |
| `app_update_settings`, `app_import_settings`                            | Sensitive settings                                                         |
| `app_raise_budget`                                                      | Budget increases on existing tasks                                         |
| `app_register_project`, `app_browse_project`                            | Direct registration and folder browsing                                    |
| `app_rename_project`, `app_remove_project`                              | [Project management](panel-guide.md#manage-projects)                       |
| `app_set_tasks_archived`, `app_delete_tasks`                            | [Archive](panel-guide.md#archive-tasks) and deletion                       |
| `app_set_task_read`, `app_mark_tasks_read`, `app_mark_task_unread_from` | [Read state](panel-guide.md#read-and-unread-tasks)                         |
| `app_mark_updates_seen`                                                 | [Pending updates](panel-guide.md#pending-worker-updates) Codex hasn't read |
| `app_steer_queued_message`                                              | Moving a queued message into the running turn                              |

Other `app_` tools serve panel reads and controls. `app_list_tasks` returns the
panel's tasks as `{ tasks }`, without their conversation and context. `include`
names tasks to list whatever the filters say. Unless `include_read_completed` is
true, it also leaves out completed tasks the user has read, except included ones
and the newest, and counts them by repository in `read_completed`. The panel
loads them for Done, All and search.

`list_tasks` and `app_list_tasks` take the same `archived` filter: `exclude`
(the default) leaves archived tasks out, `include` lists them too and `only`
lists just them. Archived tasks carry `archived_at`.

`app_get_original_response` reads an original response saved with
[full-event recording](configuration.md#environment-variables). Pass `task_id`
and the event's `response_ref`. It returns `{ available: true, original }`, or
`{ available: false }` if the response is unavailable.

`app_record_timing` accepts best-effort panel diagnostics in strict batches of 1
to 50 records, with an optional bounded `dropped_count`. It rejects unknown
fields and arbitrary metadata, and stores only the hash of a send request ID.
See [Panel calls](logging.md#panel-calls) for accepted operations, fields,
timing boundaries and delivery limits.

`app_export_settings` returns a JSON string in `document`. The export contains a
`format` number, currently `2`, the extension `version` and the user's saved
nested `settings`. `app_import_settings` accepts this document with user
authority, lists skipped dotted paths and rejects other formats. The format
number controls compatibility independently of the extension version.

`app_save_settings_file` writes the user's settings export to a new file in the
service computer's home folder. The panel uses it only when neither the host nor
the browser can save the file. It accepts no destination or file contents from
the caller and returns the saved path. See
[Copy settings between computers](configuration.md#copy-settings-between-computers).

For Claude permissions routed to `parent_agent`, model-visible `submit_input`
can approve or deny the exact pending request. Permissions routed to the user
need the panel's **Approve** or **Deny** buttons. Questions accept model-visible
answers. The service checks task ownership and the request ID for every answer.

Project rename and removal use the saved canonical path, so they work after the
directory is gone. Read points belong to the user and drive unread status and
Chat's **New** divider.

`app_steer_queued_message` keeps the message's ID, text and sender. The worker
must have no pending input request. If the turn can no longer accept the steer,
the message stays at the front of the queue.

`app_restore_queued_messages` undoes queued message removals. The panel names
each message and the position to restore. The service takes the text, sender and
steer state from the task's recorded events, so it restores only messages that
were removed and haven't been sent or queued again. A task that isn't busy gets
a paused queue, so restoring never starts a turn, and an archived task returns
to the task lists. `app_clear_queue` takes optional `message_ids` so redo
removes only the restored messages.

`app_wait_for_updates` returns when the owner's revision or a targeted reply
draft changes, or after at most 25 seconds. Revision tokens are opaque and
change after a service restart, so compare them only for equality. See
[Transport](panel-guide.md#transport) for panel refresh behavior.

The embedded app uses the authenticated MCP Apps bridge, and the standalone
console uses HTTP and SSE. See
[Panel network access](host-capabilities.md#panel-network-access).

## Parent delegation protocol

`src/service/platform/server/instructions.ts` defines the server instructions,
and `src/shared/tasks/conversation/parent-protocol.ts` defines the parent
protocol. Each rule appears once in what the model sees:

| Constant                      | Content                 | Delivered in                                 |
| ----------------------------- | ----------------------- | -------------------------------------------- |
| `SERVER_INSTRUCTIONS`         | The delegation workflow | Server instructions for both MCP entrypoints |
| `PARENT_SUPERVISION_PROTOCOL` | Polling and completion  | The `list_messages` description              |

Tool descriptions own each tool's contract, because hosts can drop server
instructions. The delegation skill covers the judgment calls the tools leave to
the agent and defers to the tool descriptions. Together they give this protocol:

1. Keep polling with `wait_seconds` while the worker runs, passing `next_cursor`
   as `after`. A timeout or empty message list does not mean the task completed.
2. Inspect `status`, `running`, `pending_input` and `queued_messages`. Handle
   input, failures and interruptions explicitly. Check the final reply before
   reporting success. A queued follow-up is still pending work.
3. If you lose the cursor, read again from `after: 0`.

Workers never message the parent directly. Codex learns of results by polling,
and the panel counts the
[pending worker updates](panel-guide.md#pending-worker-updates) it hasn't read
yet.
