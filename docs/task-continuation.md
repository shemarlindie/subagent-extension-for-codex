# Task continuation and service state

Use this guide to choose a workspace, continue a task and preserve service state.
For installation and Codex MCP connection, follow the [README](../README.md).
[Configuration](configuration.md) owns environment variables, task defaults,
repository approvals and permissions.

## Start a task

1. Choose an approved Git repository root with at least one commit. Add it through
   **Manage → Add project** if needed. Automatic registration of the chat project
   depends on the user setting and original host metadata. See
   [Repository access](configuration.md#repository-access).
2. Choose a workspace. The default `current_repo` uses the approved checkout,
   including staged, unstaged and untracked files. `worktree` creates a separate
   branch from a committed revision. Both default to `HEAD`. `current_repo`
   rejects another revision.
3. Select the worker profile and limits, then submit the task. See the
   [panel guide](panel-guide.md) for task controls.

A worktree gives the task a separate checkout, and the service leaves merging
its changes to you. Session
restrictions in [Configuration](configuration.md#claude-session-restrictions)
control execution authority.

## Continue a task

Send a message in Chat, or use `send_agent_message` from the parent agent, to
start another turn on a completed, failed or interrupted task. Running turns
also accept queued messages and steers. See the
[panel conversation controls](panel-guide.md).

A later turn resumes the provider session when its original service host and
saved session state are available. If there is no session, its owner differs or
the provider rejects the saved state, the service starts a new session in the
same task. Its prompt carries the original request and the earlier messages and
replies, with older entries omitted when the conversation is too long. Chat
marks this as **New session**. The Claude transcript itself is
provider state. Copying the extension database alone does not preserve it.

A worktree removed with **Remove worktree** is recreated from the task's branch
on the next turn, or from its base commit if the branch was also deleted.
Uncommitted changes discarded during removal do not return.

## Reconnect after a restart

1. Start the service with the same `CODEX_SUBAGENT_EXTENSION_DATA` value.
2. Inspect existing tasks in the task list.

The data directory contains the database, worktrees and admin token.
Disconnecting a client leaves the service and its tasks running. Stopping the
service interrupts its active turns.

Recovery marks a turn that was running as interrupted. Steers it had not taken
move to the front of its queue. A non-empty recovered queue is paused until you
resume it or send another message. If a submission or shutdown outcome is
uncertain, inspect Chat and Activity before sending it again.

## Updates and service handoff

A plugin update installs the new version while the previous version's service
may still be running. The next stdio proxy to start compares itself with that
service, using the `version`, `apiVersion` and `launcher` fields of `/health`
and the `installRoot` in `service.json`:

| Running service                                                | The proxy                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Same version, installation present                             | Uses it.                                                                        |
| Started by a stdio proxy, older or its installation removed    | Asks it to drain, then starts the new version once it exits.                    |
| Started by a stdio proxy, newer                                | Uses it if `apiVersion` matches; otherwise asks you to update the plugin.       |
| Started another way (`npm run dev`, `npm start`, a supervisor) | Uses it if `apiVersion` matches; otherwise refuses. It never stops the service. |

A draining service starts no more turns and lets running turns finish for up
to 10 minutes, then interrupts any left, as a restart does. Queued tasks stay
queued, and the new service starts them. While a draining service still speaks
the same API, proxies keep using it; when it exits, their next call starts the
new version. Otherwise calls wait for the new service.

Keep development services on their own `CODEX_SUBAGENT_EXTENSION_DATA` and
`PORT`, so an installed plugin never finds them on its data directory.

## Raise a task budget

Runtime and cost limits accumulate across turns. Use the budget controls in
Chat to apply a higher limit while the task is idle, without sending a message.
A continuation can also carry a `budget` update through `send_agent_message`.

Each limit can only increase. `null` removes it, and an unlimited limit cannot
be replaced with a finite one. Applying a budget without a message requires at
least one changed limit. These updates affect that task. Settings changes
apply to new tasks. Runtime includes time spent waiting for input. Cost limits
are checked at response boundaries and can be exceeded by the response that
triggers them. Interrupted usage may be missing.

## Preserve service state

1. Stop the service gracefully before backing up its data.
2. Preserve the full data directory, including SQLite files and worktrees.

Copying only a live SQLite database can omit its write-ahead log. Keep the Claude
runtime state on the machine that owns the worktrees. Moving this state to
another machine does not ensure native session continuation.

For versioned database upgrades, see [Database](database.md).

## Earlier development data

Recorded diffs are not backfilled for tasks created before edit recording.
Their Changes tab may be empty or unavailable. If that development data is no
longer needed, stop the service and start with a fresh data directory. Preserve
any needed worktrees and task history first.

Older builds may also have left Git snapshot refs. They are no longer used.
Remove them from a repository when that earlier build is no longer running:

```sh
git for-each-ref --format='%(refname)' refs/agent-tasks | xargs -n1 git update-ref -d
```

## Troubleshooting

| Symptom                                      | Check                                                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Service port is in use                       | Identify the service on that port and confirm its data directory before starting another service.                                                                  |
| MCP proxy cannot authenticate                | Use the same absolute data directory for the service and MCP client, or matching token and URL overrides.                                                          |
| Claude tasks cannot start                    | Read the worker's readiness message. [Claude Code CLI](claude-cli.md) explains executable selection and fixes.                                                     |
| A turn starts a new session                  | Confirm the original service host and Claude state are available. A fresh session carries the bounded conversation described above.                                |
| "A different extension service … is running" | Stop the named service, or give development its own `CODEX_SUBAGENT_EXTENSION_DATA` and `PORT`.                                                                    |
| Startup refuses the database                 | See [Database](database.md#migration-application) for supported migration histories. If a database has a migration this build lacks, use a build that includes it. |

[Host capabilities](host-capabilities.md) covers host integration limits.
