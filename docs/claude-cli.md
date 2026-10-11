# Claude Code CLI

Claude tasks run your installed `claude`. The package doesn't include one, and the service never installs, updates or signs in to Claude Code. Install it from the [Claude Code setup guide](https://code.claude.com/docs/en/setup).

## Supported versions

The service requires Claude Code 2.1.285 or newer, with no upper version limit. Older versions and prereleases are rejected. This checkout qualifies compatibility against Agent SDK 0.3.293; accepting newer releases does not mean each release has been verified. See [Qualifying Claude Code versions](development.md#qualifying-claude-code-versions) for compatibility checks.

The minimum is defined in `src/service/features/providers/claude/configuration/executable.ts`. Use the readiness message to choose an installation or path override.

## Which `claude` runs

1. `CODEX_SUBAGENT_EXTENSION_CLAUDE_PATH`, when set, names the executable as an absolute path. If it is relative or points to a missing file, Claude tasks are blocked; the service doesn't fall back to `PATH` while it is set.
2. Otherwise, the first `claude` on the service's own `PATH`. On Windows, `claude.exe`, or the binary behind npm's `claude.cmd` launcher.

See [Configuration](configuration.md#environment-variables) for service environment overrides. The lookup runs without a shell, so shell aliases and interactive shell init don't apply: a `claude` your terminal finds through an alias or a `PATH` set in `.zshrc` may not be the one the service sees. Either path is resolved through symlinks, so the selected path names the installed binary itself.

## When the version is checked

Before each new Claude session, the service runs `claude --version` and checks the version against the range. It reuses a passing check while the file is unchanged, for up to five minutes, and checks again as soon as the file changes, as an auto-update does. A failed check is retried after 30 seconds. Running sessions keep their process.

## When the CLI isn't ready

A missing or unsupported CLI blocks starting Claude tasks and new turns. The message names the fix: the install or update step, the release channel and the path override. The panel shows it above the task list and in the inline preview. It appears within an hour of the CLI breaking and clears on the next refresh after the fix; the delegate form also shows it under **Worker**. `list_available_workers` reports each provider's `readiness` with the selected path, its version and the supported range. Projects, task history and the panel stay usable.

| Message                                    | Fix                                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| not found on the service's PATH            | Install Claude Code, add its directory to the service's `PATH`, or set `CODEX_SUBAGENT_EXTENSION_CLAUDE_PATH`. |
| older than the supported range             | Update it with the step the message names.                                                                     |
| could not be run                           | Reinstall Claude Code, or point the override at a working copy.                                                |
| not a Claude Code release version          | Install a release; prereleases aren't supported.                                                               |
| `CODEX_SUBAGENT_EXTENSION_CLAUDE_PATH` ... | Fix or unset the override.                                                                                     |

A ready CLI can still fail when it starts a session, for example on authentication or the network. Those failures appear as model discovery or task errors, not as readiness.
