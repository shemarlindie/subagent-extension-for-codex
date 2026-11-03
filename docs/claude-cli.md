# Claude Code CLI

Use this guide to find out which `claude` the service runs, which versions it
accepts, and how to fix readiness failures. For upgrade checks, see
[Claude execution verification](claude-verification.md).

Claude tasks run your installed `claude`. The package does not include one, and
the service never installs, updates or signs in to Claude Code. Install it from
the [Claude Code setup guide](https://code.claude.com/docs/en/setup).

## Supported versions

The service requires Claude Code 2.1.285 or newer, with no upper limit. It
rejects older versions and prereleases. Agent SDK 0.3.300 is the qualification
baseline. A newer CLI release is accepted without being verified. See
[Qualifying Claude Code versions](claude-verification.md#qualifying-claude-code-versions).

The version policy lives in
`src/service/features/providers/claude/configuration/executable.ts`.

## Which `claude` runs

1. When `SUBAGENT_EXTENSION_FOR_CODEX_CLAUDE_PATH` is set, it names the
   executable as an absolute path. A relative path or a missing file blocks
   Claude tasks. The service does not fall back to `PATH` while the variable is
   set.
2. Otherwise, the service runs the first executable `claude` in an absolute
   directory on its own `PATH`. It skips relative and empty entries. On Windows,
   it runs `claude.exe` or the binary behind npm's `claude.cmd` launcher.

The service resolves symlinks to find the installed binary. The lookup runs
without a shell, so aliases and interactive shell setup do not apply. A `claude`
your terminal finds through an alias or a `PATH` set in `.zshrc` may differ from
the one the service sees. See
[Environment variables](configuration.md#environment-variables) for other
service overrides.

## When the version is checked

The service runs `claude --version` before it opens a session and caches the
result for five minutes. Replacing or updating the executable triggers a new
check. Running sessions keep their process.

## When the CLI isn't ready

A missing or unsupported CLI blocks new Claude tasks. Projects, task history and
the panel stay usable. The panel shows the readiness error, and `list_workers`
reports the selected executable, its version and the supported range.

| Message                                        | Fix                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| not found on the service's PATH                | Install Claude Code, add its directory to the service's `PATH`, or set `SUBAGENT_EXTENSION_FOR_CODEX_CLAUDE_PATH`. |
| older than the supported range                 | Update it with the step the message names.                                                                         |
| could not be run                               | Reinstall Claude Code, or point the override at a working copy.                                                    |
| not a Claude Code release version              | Install a release. Prereleases aren't supported.                                                                   |
| `SUBAGENT_EXTENSION_FOR_CODEX_CLAUDE_PATH` ... | Fix or unset the override.                                                                                         |

After a fix, the panel picks it up within about a minute, or you can call
`list_workers` again. The service caches a failed check for about 30 seconds.
Restart the service after changing its environment.

A ready CLI can still fail when it starts a session, for example on
authentication or the network. Model discovery and task execution report those
failures when they happen.
