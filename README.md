# Subagent Extension for Codex

[![CI](https://github.com/shemarlindie/codex-subagent-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/shemarlindie/codex-subagent-extension/actions/workflows/ci.yml)

> _Prompt: Chat, build something that lets Claude keep you in line._

Delegate Claude coding tasks from Codex through a local MCP service, then
follow, steer and review them in the Delegated Work panel without leaving Codex.
Claude runs through the Claude Agent SDK and the Claude Code harness.

And yes, some of us still use Codex.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/user-attachments/assets/35edbfc0-bd57-425b-a30a-c95d55ee8aca">
  <img width="1440" alt="Codex delegates a task to Claude and follows it in the Delegated Work panel" src="https://github.com/user-attachments/assets/f6178243-d96c-4e40-9fe5-105e1a1a1ef4">
</picture>

Watch in [full quality](https://github.com/user-attachments/assets/94f0c927-e352-460e-bda1-da6856e45371)

**Is this allowed?** Yes, when you run it on your own computer for your own
work. It uses your local copy of Claude Code and your own sign-in, and it never
collects or stores your Claude credentials. Anthropic's
[usage policy for Claude Code and the Agent SDK](https://code.claude.com/docs/en/legal-and-compliance#usage-policy)
covers this kind of individual use.

## Install

You need:

- [Claude Code](https://code.claude.com/docs/en/setup) 2.1.285 or later, signed
  in. Run `claude` once and complete sign-in. See
  [Claude Code CLI](docs/claude-cli.md) for how the extension finds it.
- Node.js 24 or later as the `node` on the `PATH` Codex starts with.
- Git.
- Codex CLI 0.162.1 or later, or a Codex desktop app with plugin marketplaces.
  CI installs the plugin with 0.162.1, and older builds are untested.

macOS is the primary platform. CI runs the full test suite on macOS and Linux.
Windows CI covers builds, plugin installation, packaged-service checks and
settings file exports.

Add the marketplace, then install the plugin:

```sh
codex plugin marketplace add shemarlindie/codex-subagent-extension@release
codex plugin add codex-subagent-extension@shemarlindie
```

After the first command, the plugin also appears in the Plugins directory of the
Codex desktop app. You can also ask Codex to install it: _"Install the Codex
plugin codex-subagent-extension from the release branch of
github.com/shemarlindie/codex-subagent-extension."_

Then open **Delegated Work** from a Codex chat and use **Manage → Add project**
to approve a Git repository root with at least one commit. The plugin starts its
local service the first time Codex connects.

While the service runs, you can also use the standalone console at
`http://127.0.0.1:17317`. If that port is taken, see
[Service address](docs/configuration.md#service-address) to find the console.
Sign in with the token in
`~/.local/share/codex-subagent-extension/admin-token`. Treat the token as a
credential and keep it out of chats and commits.

Claude uses the host's Claude Code credentials. By default, it also loads user,
project and local settings, including instructions, skills, hooks and MCP
servers. The extension doesn't manage provider credentials. Read
[Configuration and permissions](docs/configuration.md) before changing execution
authority or session restrictions.

## Update

Codex checks the marketplace when it starts and installs new releases on its
own. To check now:

```sh
codex plugin marketplace upgrade shemarlindie
```

The new version takes over from the running service once its running turns
finish, and queued tasks carry over. See
[Updates and service handoff](docs/task-continuation.md#updates-and-service-handoff).
Startup backs up the database before applying migrations. See
[Restore a backup](docs/database.md#restore-a-backup).

To pin a version, add the marketplace at a release tag, for example
`codex plugin marketplace add shemarlindie/codex-subagent-extension@v0.1.0`.
Remove the marketplace first if you already added it.

Prereleases such as `v0.2.0-beta.1` exist only as tags and are marked as
prereleases on GitHub. The `release` branch never receives them. To try one, add
the marketplace at its tag. To switch to another prerelease or back to stable
releases, remove the marketplace and add it again at the new tag or at
`@release`.

## Uninstall

```sh
codex plugin remove codex-subagent-extension@shemarlindie
codex plugin marketplace remove shemarlindie
```

The service keeps running after you remove the plugin. Stop it with
`kill "$(cat ~/.local/share/codex-subagent-extension/service.pid)"`, which
interrupts running turns.

Tasks, settings and worktrees stay in `~/.local/share/codex-subagent-extension`.
Delete that directory to remove them. Branches that tasks created stay in their
repositories.

## Troubleshooting

| Symptom                                        | Fix                                                                                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `needs Node.js 24 or later` in Codex's MCP log | Install Node.js 24 or later and make it the first `node` on the `PATH` Codex starts with.                                                |
| Tools report the service is unavailable        | Read the [service logs](docs/logging.md#diagnose-a-problem), starting with `service.jsonl` and `service.log` in the data directory.      |
| `A different extension service … is running`   | Another service owns the data directory or port, for example a development checkout. Stop it, or give development its own data and port. |
| `Port … is already in use`                     | Choose a free port or remove the address override. See [Service address](docs/configuration.md#service-address).                         |
| Claude tasks can't start                       | The panel shows a readiness message above the task list. [Claude Code CLI](docs/claude-cli.md) explains fixes.                           |

To connect a checkout over stdio or Streamable HTTP instead of installing the
plugin, see
[Connect Codex from a checkout](docs/development.md#connect-codex-from-a-checkout).

## Working with tasks

- **Workspace.** Tasks work in the approved checkout by default, including its
  uncommitted changes. Choose `worktree` to work from a committed revision in a
  separate checkout. The service never merges changes, and worktrees aren't
  security sandboxes.
- **Permissions.** The researcher, reviewer and security reviewer profiles only
  inspect by default. Writing profiles follow your saved permissions and
  restrictions.
- **Conversation.** Replies stream into Chat, and Changes shows the task's
  recorded tool edits. Tasks accept follow-ups after they complete, fail or are
  interrupted. During a turn, a message can steer the worker, queue another
  turn, or interrupt and start a new one.
- **Budgets.** Runtime and cost budgets span turns. Cost budgets aren't a hard
  billing cap.

See the [Panel guide](docs/panel-guide.md) for delegation and review,
[Configuration](docs/configuration.md) for permissions and limits, and
[Task continuation](docs/task-continuation.md) for recovery and backups. For
access from other devices during development, see
[Access from your local network](docs/development.md#access-from-your-local-network).

## Documentation

Before working on the codebase, read in this order:

1. [Architecture](docs/architecture.md) for runtime ownership and code
   boundaries.
2. [Local development](docs/development.md#choosing-a-development-tool) for
   choosing a development tool, and its [checks](docs/development.md#checks).
3. The guide for the area you are changing, listed below.

### Use and operate the extension

| Task                                                   | Guide                                          |
| ------------------------------------------------------ | ---------------------------------------------- |
| Start, recover, back up or continue tasks              | [Task continuation](docs/task-continuation.md) |
| Configure permissions, budgets and repository access   | [Configuration](docs/configuration.md)         |
| Delegate and review work in Codex or the console       | [Panel guide](docs/panel-guide.md)             |
| Diagnose service errors, authentication or performance | [Logging and diagnostics](docs/logging.md)     |
| Diagnose Claude executable readiness                   | [Claude Code CLI](docs/claude-cli.md)          |

### Develop and verify changes

| Task                                                          | Guide                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------ |
| Report a problem or propose a change                          | [Contributing](CONTRIBUTING.md)                              |
| Report a security problem                                     | [Security policy](SECURITY.md)                               |
| Follow contribution and documentation conventions             | [Agent instructions](AGENTS.md)                              |
| Understand runtime ownership and system boundaries            | [Architecture](docs/architecture.md)                         |
| Build, test, connect, preview or release the extension        | [Local development](docs/development.md)                     |
| Change React components, styling and client state             | [Panel architecture](docs/panel-architecture.md)             |
| Check UI layouts and behavior in the browser                  | [UI verification](docs/ui-verification.md)                   |
| Exercise fake-worker task behavior without model calls        | [Fixture scenarios](docs/fixture-scenarios.md)               |
| Change storage, migrations or transactions                    | [Database and migrations](docs/database.md)                  |
| Qualify Claude CLI/SDK updates or run authenticated scenarios | [Claude execution verification](docs/claude-verification.md) |

### Integrate providers and hosts

| Task                                             | Guide                                          |
| ------------------------------------------------ | ---------------------------------------------- |
| Implement provider execution and task policy     | [Provider contract](docs/provider-contract.md) |
| Change MCP tools, user authority or panel inputs | [MCP reference](docs/mcp-reference.md)         |
| Integrate project/chat context and host delivery | [Host capabilities](docs/host-capabilities.md) |
