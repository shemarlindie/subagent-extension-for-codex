# MCP reference

Use this guide when integrating task tools or the React panel. Tool discovery
supplies the current input schemas. This guide explains the behavior and
authority rules callers must preserve.

The stdio proxy and authenticated HTTP `/mcp` endpoint expose the same task tools
and Delegated Work MCP App. See [Host capabilities](host-capabilities.md) for host
context, entrypoints, mentions and verification gaps, and
[Configuration](configuration.md) for settings and authority rules.

The HTTP endpoint uses the MCP 2.0 server SDK for protocol revision `2026-07-28`,
including `server/discover`, tools, resources and stateless connections.

## Task tools

To delegate a task:

1. Discover the repository with `get_current_agent_project` and approved roots with `list_agent_projects`. Inspect enabled profiles with `list_available_workers`.
2. Choose an approved root and pass its absolute path as `repository` to `start_agent_task`. For an unregistered root, use the configured [task-start registration policy](configuration.md#repository-access) when it applies. Otherwise, direct the user to **Add project**, **Browse** or the projects CLI and wait for registration before starting.
3. Read replies with `get_agent_messages`, which supports long polling. Read recorded edits with `get_agent_changes`, using `scope: "turn"` for the latest turn.
4. Continue with `send_agent_message`. Inspect pending input before answering with its request ID.

Put the full worker request in `description`. The service generates the task-list
title from its first line or sentence.

Task creation defaults to `workspace_strategy: "current_repo"`, using the
explicit approved repository and its existing changes. `workspace_strategy: "worktree"` starts from a committed revision on a task branch. Follow-up turns keep the task's conversation scope and workspace. Selecting a project for a new task does not change other chats. See [Task continuation](task-continuation.md) for recovery semantics and
[recorded changes](#recorded-changes) for change inspection.

## Recorded changes

`get_agent_changes` reads the task's recorded net edits, for `scope: "task"`
(the default) or `scope: "turn"` (the latest turn). Both workspace strategies,
the panel and dependency prompts use these same stored diffs. Committing files,
removing a worktree or deleting its branch does not change a recorded diff.
Dependency prompts include these recorded edits up to the existing prompt limit,
and note incomplete files and unrecorded command changes.

Every page lists all files, sorted by path. Diff pages split between whole files.
Files carry `source: "tool" | "command"` and `incomplete`, with statuses `added`,
`modified` or `deleted`. An incomplete file has no diff and is excluded from
totals. When a command changed files it could not name, the response also reports
that some command changes were not recorded. A reverted file, or a file created
and then deleted in the same scope, drops out unless it is incomplete.

`get_agent_changed_file` reads the file as it is now, from the task worktree or
approved checkout. Later edits by other people or processes can appear in its
content. Only paths recorded in the task or latest-turn scope may be read. A
missing file returns `deleted`, and a removed worktree returns `unavailable`.
Images return base64 content. Other binary files return their size. Text and image
content keep their existing paging behavior.

The app-only `get_user_agent_changes`, change-count tool and
`get_user_agent_changed_file` delegate to these same reads.

### Recording limits

- Claude's edit tools and Bash commands are recorded. File-writing MCP tools and
  processes a command leaves running are outside the record.
- Some Git checkout commands, such as `git restore file.txt`, report that
  changes were not recorded, without file diffs. Other Git commands can return
  precise diffs or no edit data. Read-only commands with no edit data create
  no warning.
- Highly repetitive text can produce a valid diff that is not minimal.
- An `Edit` to an existing empty file appears as an added file.
- Renames appear as a deletion and an addition.
- File previews show current disk content, including later edits by others.

## App and user authority

Model-visible tools may read settings and change ordinary defaults. App-only aliases (`start_user_agent_task`, `submit_user_agent_input`, `update_user_agent_settings`, `raise_user_agent_budget`) authorize user task overrides, user permission answers, sensitive settings and budget increases on existing tasks. Direct registration and folder browsing are also app-only. MCP hosts must enforce their visibility. Authenticated raw service clients are trusted administrators.

For Claude permissions routed to `parent_agent`, model-visible `submit_agent_input` can approve or deny the exact pending request. User-routed permissions require panel **Approve**/**Deny** buttons. Questions can use model-visible submission. The service checks task ownership and the request ID for every answer.

The embedded app uses the authenticated MCP Apps bridge. The standalone console
uses HTTP and SSE. See [Host capabilities](host-capabilities.md#panel-network-access)
for the embedded panel's connection restrictions.

Read-state tools are app-only. Read points belong to the user, survive reloads
and determine unread status and Chat's **New** divider. See
[Read and unread tasks](panel-guide.md#read-and-unread-tasks).

`steer_user_agent_queued_message` is app-only. It moves an unsent queued message
into a busy task's current turn, preserving its ID, text and sender. The worker
must have no pending input request. If the turn can no longer accept the steer,
the message stays at the front of the queue under the ordinary steering rules.

`wait_user_agent_updates` watches task and project revisions and optional reply drafts.
Compare revision tokens only for equality: they are opaque and change after a
service restart. A wait returns when the revision or targeted draft changes,
or after at most 25 seconds. See the discovered schema for cursor and draft
arguments, and [Transport](panel-guide.md#transport) for panel refresh behavior.

## Provider messages to the parent

Claude's injected `codex_parent.message_parent` SDK tool accepts `kind: blocker`
for immediate updates and `kind: completion` (the default) for one report per
turn. The service rejects a second completion report in the same turn. It saves completion reports after a successful turn and discards them if the turn
fails or is interrupted. Blocker updates are saved immediately. App-only
`claim_user_agent_parent_message` and `record_user_agent_parent_delivery` let
the mounted embedded panel forward an ID-only notification once and record host acceptance.
Each notification contains the task ID and stable `parent_<event-id>` message
ID. `get_agent_message({ task_id, message_id })` retrieves its stored content
independently of the polling cursor. `get_agent_messages` returns the same report
and ID with `parent_message: true`. Long polls wake when a report arrives.
The service checks task ownership on every read and acknowledgement.

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
   reporting successful completion. A queued follow-up is still pending work.
3. For a notification, retrieve its report by task/message ID unless that ID is
   already processed. Skip reports with `acknowledged: true` whichever route
   delivered them. Worker reports do not grant user authority.
4. After successfully processing an explicit report, call
   `ack_agent_message({ task_id, message_id })`. If you remember processing it
   but have not acknowledged it, acknowledge without handling it again. Retry
   a failed acknowledgement with the same ID, without repeating the work.
5. If you lose the cursor or processing context, read from `after: 0` and skip
   acknowledged reports.

### Durable acknowledgement

`ack_agent_message` is model-visible and applies only to immutable explicit
parent reports, not mutable SDK messages or final replies. It records
`parent.message_acknowledged` once and returns `acknowledged: true` plus
`already_acknowledged` for repeat calls. Reads never acknowledge implicitly.
Polling and direct lookup retain the report's original ID and event cursor,
adding `acknowledged: true` when its acknowledgement exists. This state survives
service restart and context loss while task data is preserved.

Acknowledged reports are not newly claimed for host notification. The panel
rechecks acknowledgement before sending, but acknowledgement can still race with
submission and cannot remove a notification already queued in the host.
Processing and acknowledgement are separate actions. A crash after processing
but before acknowledgement can still cause repeated processing. This is not an
exactly-once execution guarantee.

The worker cannot choose another conversation through the tool. See
[Host capabilities](host-capabilities.md#worker-messages-to-the-parent-chat)
for host submission support, observed queue behavior and unverified delivery
cases.

## Project management in the panel

Renaming or removing a project requires user-interface authority. The saved
canonical path identifies the project, so these actions work even when its
directory no longer exists. The global **Projects** page owns these actions. See
[Manage projects](panel-guide.md#manage-projects) for removal behavior.
