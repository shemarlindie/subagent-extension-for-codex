# Setup and task continuation

Use the [README](../README.md) for installation, supported providers, configuration, and Codex MCP setup. [Local development](development.md) covers the demo and panel dev host. This guide covers choosing a task workspace and preserving state between sessions.

## Start a task

- Use a Git repository root with at least one commit. A task starts from `HEAD` by default.
- The default `current_repo` workspace uses the approved checkout directly, including its staged, unstaged, and untracked files. Choose `worktree` when you need an isolated workspace; worktrees start from a committed revision.
- Add a repository through **Add project**, or start a task from a chat in that repository to register it.
- Keep provider credentials on the service host. Do not put credentials in task instructions, MCP arguments, browser code, or repository files.

## Continue a task

The service stores task and event records, worktrees, executor state, and the event signing key in its data directory. To reconnect, start the service with the same `CODEX_SUBAGENT_EXTENSION_DATA` value and use the task list to inspect existing work. Keep Claude's native session state on its original machine; continuation uses the original worker and session.

Before continuing, inspect the task status, recent events, result, and available artifacts. Continue only when the original worker and session are available. If a submission or shutdown outcome is uncertain, inspect the task state before retrying. The service does not automatically merge worktree changes, and cancellation does not delete a worktree.

## Preserve service state

Stop the service gracefully before backing up its data. Preserve the full data directory, including SQLite files, worktrees, executor state, and `events-key`; copying only a live SQLite database can omit its write-ahead log. Keep the Claude runtime state alongside the machine that owns the worktrees. Moving this state to another machine does not ensure native session continuation.

## Troubleshooting

| Symptom                                          | Check                                                                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Service port is in use                           | Identify the service on that port and confirm its data directory before starting another service.                                         |
| MCP proxy cannot authenticate                    | Set the same absolute `CODEX_SUBAGENT_EXTENSION_DATA` path for the service and MCP client, or configure matching token and URL overrides. |
| Claude task cannot continue                      | Confirm the original service host, worktree, and Claude session state are available.                                                      |
| Codex worker is unavailable                      | Check macOS, `CODEX_SUBAGENT_EXTENSION_CODEX=1`, the model and executable settings, and both OpenAI keys.                                 |
| Task remains locked after an uncertain operation | Record the task ID and inspect its status and events; do not clear state or submit a duplicate request until the outcome is known.        |

See [Implementation status](implementation-status.md) for current capability coverage and [Host capabilities](host-capabilities.md) for host-specific integration details.
