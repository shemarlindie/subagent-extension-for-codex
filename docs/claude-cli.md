# Claude Code CLI

Use this guide to diagnose Claude executable selection, supported versions and
readiness failures. For CLI or SDK upgrade checks, see
[Claude execution verification](claude-verification.md).

Claude tasks run your installed `claude`. The package doesn't include one, and the service never installs, updates or signs in to Claude Code. Install it from the [Claude Code setup guide](https://code.claude.com/docs/en/setup).

## Supported versions

This checkout requires Claude Code 2.1.285 or newer, with no upper version limit. Older versions and prereleases are rejected. This checkout records Agent SDK 0.3.300 as its qualification baseline. Accepting newer CLI releases does not mean each release has been verified. See [Qualifying Claude Code versions](claude-verification.md#qualifying-claude-code-versions) for compatibility checks.

The version policy lives in `src/service/features/providers/claude/configuration/executable.ts`.

## Which `claude` runs

1. `CODEX_SUBAGENT_EXTENSION_CLAUDE_PATH`, when set, names the executable as an absolute path. If it is relative or points to a missing file, Claude tasks are blocked. The service doesn't fall back to `PATH` while it is set.
2. Otherwise, the service selects the first executable `claude` in an absolute directory on its own `PATH`. It ignores relative and empty `PATH` entries. On Windows, it selects `claude.exe` or the binary behind npm's `claude.cmd` launcher.

See [Configuration](configuration.md#environment-variables) for service environment overrides. The lookup runs without a shell, so shell aliases and interactive shell init don't apply: a `claude` your terminal finds through an alias or a `PATH` set in `.zshrc` may not be the one the service sees. The service resolves symlinks in either selection method to find the installed binary.

## When the version is checked

The service validates `claude --version` before opening a session and briefly
caches the result. Replacing or updating the executable triggers revalidation.
Running sessions keep their process.

## When the CLI isn't ready

A missing or unsupported CLI blocks new Claude execution, while projects, task
history and the panel stay usable. The panel shows the readiness error, and
`list_available_workers` reports the selected executable, version and supported
range. Restart the service after changing its environment. After fixing the
installation, refresh the panel or call `list_available_workers` again. Failed
checks are cached briefly.

| Message                                    | Fix                                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| not found on the service's PATH            | Install Claude Code, add its directory to the service's `PATH`, or set `CODEX_SUBAGENT_EXTENSION_CLAUDE_PATH`. |
| older than the supported range             | Update it with the step the message names.                                                                     |
| could not be run                           | Reinstall Claude Code, or point the override at a working copy.                                                |
| not a Claude Code release version          | Install a release. Prereleases aren't supported.                                                               |
| `CODEX_SUBAGENT_EXTENSION_CLAUDE_PATH` ... | Fix or unset the override.                                                                                     |

A ready CLI can still fail when it starts a session, for example on authentication or the network. Model discovery and task execution report those failures when they occur.
