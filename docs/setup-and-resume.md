# Setup and conversations

Use the [README](../README.md) for installation, supported providers, configuration, and Codex MCP setup. [Local development](development.md) covers the demo and panel dev host. This guide covers choosing a task workspace, continuing a task's conversation and preserving state between sessions.

## Start a task

- Use a Git repository root with at least one commit. A task starts from `HEAD` by default.
- The default `current_repo` workspace uses the approved checkout directly, including its staged, unstaged, and untracked files. Choose `worktree` when you need an isolated workspace; worktrees start from a committed revision.
- Add a repository through **Add project**, or start a task from a chat in that repository to register it.
- Keep provider credentials on the service host. Do not put credentials in task instructions, MCP arguments, browser code, or repository files.

## Continue a task

A task stays open after a turn: a message in Chat, or `send_agent_message` from the parent agent, starts its next turn. The next turn resumes the worker's session on the machine that owns it. When it can't (the task failed before its session existed, the session is on another machine, or Claude rejects it), the turn starts a new session in the same task, whose prompt carries the request and the earlier conversation, newest kept; Chat marks it "New session". A worktree removed with **Remove worktree** comes back from the task's branch, or from its base commit if the branch was deleted too. Deleting a task is the only way to end it.

The service stores task and event records, worktrees, and the event signing key in its data directory. To reconnect, start the service with the same `CODEX_SUBAGENT_EXTENSION_DATA` value and use the task list to inspect existing work. A restart leaves a turn that was running interrupted. Steers it hadn't taken wait at the front of its queue, which is paused until the next message. If a submission or shutdown outcome is uncertain, inspect the task's Chat and Activity before sending again. The service does not merge worktree changes.

## Preserve service state

Stop the service gracefully before backing up its data. Preserve the full data directory, including SQLite files, worktrees, and `events-key`; copying only a live SQLite database can omit its write-ahead log. Keep the Claude runtime state alongside the machine that owns the worktrees. Moving this state to another machine does not ensure native session continuation.

## Troubleshooting

| Symptom                       | Check                                                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Service port is in use        | Identify the service on that port and confirm its data directory before starting another service.                                         |
| MCP proxy cannot authenticate | Set the same absolute `CODEX_SUBAGENT_EXTENSION_DATA` path for the service and MCP client, or configure matching token and URL overrides. |
| A turn starts a new session   | Confirm the original service host and Claude session state are available; otherwise the new session carries the conversation.             |

See [Implementation status](implementation-status.md) for current capability coverage and [Host capabilities](host-capabilities.md) for host-specific integration details.
