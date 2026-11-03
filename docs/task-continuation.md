# Task continuation and service state

Use this guide to choose a workspace, continue a task, and keep service state
across restarts, updates and backups.

- [Configuration](configuration.md) covers environment variables, task defaults,
  repository approvals and permissions.
- The [panel guide](panel-guide.md) covers task controls.

## Start a task

1. Choose an approved Git repository root with at least one commit. Add it
   through **Manage projects… → Add project** if needed. The chat project can
   register automatically, depending on the user setting and host metadata. See
   [Repository access](configuration.md#repository-access).
2. Choose a workspace:
   - `current_repo`, the default, uses the approved checkout, including staged,
     unstaged and untracked files. It accepts only revision `HEAD`.
   - `worktree` creates a separate checkout on a task branch from a committed
     revision, `HEAD` by default. Merging its changes is up to you.
3. Select the worker profile and limits, then submit the task.

Worktrees isolate files only.
[Session restrictions](configuration.md#claude-session-restrictions) control
what the worker may run.

## Continue a task

Send a message in Chat, or call `send_message` from the parent agent, to start
another turn on a completed, failed or interrupted task. A running turn also
accepts queued messages and steers.

A later turn resumes the provider session when the original service host and
saved session state are available. Otherwise the service starts a new session in
the same task, and Chat marks it **New session**. This happens when there is no
session, its owner differs, or the provider rejects the saved state. The new
prompt carries the original request and the earlier messages and replies,
omitting the oldest entries when the conversation is too long.

The Claude transcript is provider state, so copying the extension database alone
does not preserve it.

A worktree removed with **Remove worktree** is recreated on the next turn from
the task's branch, or from its base commit if the branch was deleted too.
Uncommitted changes discarded during removal do not return.

## Reconnect after a restart

Start the service with the same `SUBAGENT_EXTENSION_FOR_CODEX_DATA` value, then
check the task list. The data directory holds the database, worktrees and admin
token.

Disconnecting a client leaves its tasks running. A service the plugin started
exits about 15 seconds after its last Codex proxy and console disconnect and its
tasks finish. A task waiting for input counts as unfinished. A task waiting for
a dependency doesn't, since the wait resumes after a restart. Services started
another way run until you stop them.

Stopping the service interrupts its active turns. On restart:

- A turn that was running becomes interrupted.
- Steers that turn had not taken move to the front of its queue.
- A non-empty recovered queue pauses until you resume it or send another
  message.

If a submission or shutdown outcome is uncertain, check Chat and Activity before
sending again.

## Updates and service handoff

A plugin update installs the new version while the old version's service may
still run. The next stdio proxy to start compares itself with that service. It
reads `version`, `apiVersion` and `launcher` from `/health` and `installRoot`
from `service.json`. Versions compare by semver precedence, so a prerelease such
as `0.2.0-beta.1` is older than `0.2.0`. `apiVersion` changes only when a
release breaks the previous release's proxy, so most updates keep it.

| Running service                                                | The proxy                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Same version and `apiVersion`, installation present            | Uses it.                                                                        |
| Started by a stdio proxy, older, on another API or uninstalled | Asks it to drain, then starts the new version once it exits.                    |
| Started by a stdio proxy, newer                                | Uses it if `apiVersion` matches. Otherwise asks you to update the plugin.       |
| Started another way (`npm run dev`, `npm start`, a supervisor) | Uses it if `apiVersion` matches. Otherwise refuses. It never stops the service. |

A draining service starts no new turns. It lets running turns finish for up to
10 minutes, then interrupts the rest as a restart does. Queued tasks stay
queued, and the new service starts them. Proxies keep using a draining service
that speaks the same API, and their next call after it exits starts the new
version. Proxies on another API wait for the new service.

Give development services their own `SUBAGENT_EXTENSION_FOR_CODEX_DATA` and
`PORT` so an installed plugin never finds them.

## Raise a task budget

Runtime and cost limits accumulate across turns. While the task is idle, use the
budget controls in Chat to raise a limit without sending a message. A
`send_message` call can also carry a `budget` update.

- Each limit can only increase. `null` removes it, and an unlimited limit cannot
  become finite.
- Applying a budget without a message needs at least one changed limit.
- Budget updates affect that task only. Settings changes apply to new tasks.
- Runtime includes time spent waiting for input.
- Cost is checked at response boundaries, so the response that crosses a limit
  can exceed it. Usage from interrupted turns may be missing.

## Preserve service state

1. Stop the service gracefully.
2. Back up the full data directory, including the SQLite files and worktrees.

Copying only a live SQLite database can miss its write-ahead log. Keep the
Claude runtime state on the machine that owns the worktrees. Moving it to
another machine does not ensure native session continuation.

[Database](database.md) covers migrations and
[restoring a pre-migration backup](database.md#restore-a-backup).

## Earlier development data

Older builds may have left Git snapshot refs that current builds don't use. Once
no such build is running, remove them from a repository:

```sh
git for-each-ref --format='%(refname)' refs/agent-tasks | xargs -n1 git update-ref -d
```

## Troubleshooting

| Symptom                                      | Check                                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Service port is in use                       | Check [Service address](configuration.md#service-address) for port selection and overrides.                                                |
| MCP proxy cannot authenticate                | Use the same absolute data directory for the service and MCP client, or matching token and URL overrides.                                  |
| Claude tasks cannot start                    | Read the worker's readiness message. [Claude Code CLI](claude-cli.md) explains executable selection and fixes.                             |
| A turn starts a new session                  | Confirm the original service host and Claude state are available. See [Continue a task](#continue-a-task).                                 |
| "A different extension service … is running" | Stop the named service, or give development its own `SUBAGENT_EXTENSION_FOR_CODEX_DATA` and `PORT`.                                        |
| Startup refuses the database                 | See [Migration application](database.md#migration-application). If the database has a migration this build lacks, use a build that has it. |

[Host capabilities](host-capabilities.md) covers host integration limits.
