# Task continuation and service state

Use this guide to choose a workspace, continue a task and preserve service state.
For installation and Codex MCP connection, follow the [README](../README.md).
[Configuration](configuration.md) owns environment variables, task defaults,
repository approvals and permissions.

## Start a task

1. Choose an approved Git repository root with at least one commit. Add it through
   **Manage → Add project** if needed. Automatic registration of the chat project
   depends on the user setting and original host metadata; see
   [Repository access](configuration.md#repository-access).
2. Choose a workspace. The default `current_repo` uses the approved checkout,
   including staged, unstaged and untracked files. `worktree` creates a separate
   branch from a committed revision. Both default to `HEAD`; `current_repo`
   rejects another revision.
3. Select the worker profile and limits, then submit the task. Keep provider
   credentials on the service host; the extension uses the host's Claude Code
   configuration.

The service does not merge worktree changes. A worktree separates code; session
restrictions in [Configuration](configuration.md#claude-session-restrictions)
control execution authority.

## Continue a task

Send a message in Chat, or use `send_agent_message` from the parent agent, to
start another turn on a completed, failed or interrupted task. Running turns
also accept queued messages and steers; see the
[panel conversation controls](panel-guide.md).

A later turn resumes the provider session when its original service host and
saved session state are available. If there is no session, its owner differs or
the provider rejects the saved state, the service starts a new session in the
same task. Its prompt carries the original request and the earlier messages and
replies, keeping the newest conversation entries within a 50,000-character
limit. Chat marks this as **New session**. The Claude transcript itself is
provider state; copying the extension database alone does not preserve it.

A worktree removed with **Remove worktree** is recreated from the task's branch
on the next turn, or from its base commit if the branch was also deleted.
Uncommitted changes discarded during removal do not return.

## Reconnect after a restart

Start the service with the same `CODEX_SUBAGENT_EXTENSION_DATA` value and inspect
existing tasks in the task list. The data directory contains the database,
worktrees and admin token. Disconnecting a client leaves the
service and its tasks running; stopping the service interrupts its active turns.

Recovery marks a turn that was running as interrupted. Steers it had not taken
move to the front of its queue. A non-empty recovered queue is paused until you
resume it or send another message. If a submission or shutdown outcome is
uncertain, inspect Chat and Activity before sending it again.

## Raise a task budget

Runtime and cost limits accumulate across turns. Use the budget controls in
Chat to apply a higher limit while the task is idle, without sending a message.
Those controls call the app-only `raise_user_agent_budget` tool. A continuation
can also carry a `budget` update through `send_agent_message`.

Each limit can only increase; `null` removes it, and an unlimited limit cannot
be replaced with a finite one. Applying a budget without a message requires at
least one changed limit. These updates affect that task; Settings changes
apply to new tasks. Runtime includes time spent waiting for input. Cost limits
are checked at response boundaries and can be exceeded by the response that
triggers them; interrupted usage may be missing.

## Preserve service state

Stop the service gracefully before backing up its data. Preserve the full data
directory, including SQLite files and worktrees; copying only a
live SQLite database can omit its write-ahead log. Keep the Claude runtime state
alongside the machine that owns the worktrees. Moving this state to another
machine does not ensure native session continuation.

For database upgrades and legacy conversion, see [Database](database.md).

## Troubleshooting

| Symptom                       | Check                                                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Service port is in use        | Identify the service on that port and confirm its data directory before starting another service.                                              |
| MCP proxy cannot authenticate | Use the same absolute data directory for the service and MCP client, or matching token and URL overrides.                                      |
| Claude tasks cannot start     | Read the worker's readiness message; [Claude Code CLI](claude-cli.md) explains executable selection and fixes.                                 |
| A turn starts a new session   | Confirm the original service host and Claude state are available. A fresh session carries the bounded conversation described above.            |
| Startup refuses the database  | Stop the service and back up its data. Follow [Database](database.md) for legacy conversion or use a build that knows all recorded migrations. |

[Host capabilities](host-capabilities.md) covers host integration limits.
