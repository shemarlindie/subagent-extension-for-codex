<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-banner-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/readme-banner-light.svg">
    <img src="docs/assets/readme-banner-fallback.svg" width="400" alt="Subagent Extension for Codex">
  </picture>
</p>

<p align="center">Delegate to Claude without leaving Codex.</p>

<p align="center">
  <a href="#install">Install</a> &ensp;·&ensp;
  <a href="#start-a-task">Start a task</a> &ensp;·&ensp;
  <a href="#documentation">Documentation</a> &ensp;·&ensp;
  <a href="https://github.com/user-attachments/assets/94f0c927-e352-460e-bda1-da6856e45371">Demo video</a>
</p>

<p align="center">
  <a href="https://github.com/shemarlindie/subagent-extension-for-codex/actions/workflows/ci.yml"><img src="https://github.com/shemarlindie/subagent-extension-for-codex/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/status-early%20release-orange" alt="Status: early release">
</p>

> _Prompt: Chat, build something that lets Claude keep you in line._

Delegate tasks to Claude from Codex through a local MCP service, then follow,
steer and review them in the Delegated Work panel. Claude runs through the
[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) and the
Claude Code harness.

And yes, some of us still use Codex.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/user-attachments/assets/a6e2ad47-1b51-46f4-a5f7-8d3d1c01efc4">
  <img width="1440" alt="Codex delegates a task to Claude and follows it in the Delegated Work panel" src="https://github.com/user-attachments/assets/4b2f34ec-a922-4446-8c51-9bd5b90575ba">
</picture>

**Is this allowed?** Yes, when you run it on your own computer for your own
work. It uses your local copy of Claude Code and your own sign-in. The extension
passes your environment to Claude Code, and it doesn't save your Claude
credentials. Anthropic's
[usage policy for Claude Code and the Agent SDK](https://code.claude.com/docs/en/legal-and-compliance#usage-policy)
covers this kind of individual use.

<!-- prettier-ignore -->
> [!NOTE]
> Windows support is in progress and not ready for use yet.
>
> This is an early release. Expect rough edges, and settings or behavior may
> change between versions. Please report problems in
> [Issues](https://github.com/shemarlindie/subagent-extension-for-codex/issues).

## Install

You need:

- [Claude Code](https://code.claude.com/docs/en/setup) 2.1.300 or later, signed
  in. Run `claude` once and complete sign-in. See
  [Claude Code CLI](docs/claude-cli.md) for how the extension finds it.
- Node.js 24 or later, with npm, on the `PATH` Codex starts with. Codex
  downloads the plugin with npm.
- Git.
- Codex CLI 0.162.1 or later, or a Codex desktop app with plugin marketplaces.

Add the marketplace, then install the plugin:

```sh
codex plugin marketplace add shemarlindie/subagent-extension-for-codex
codex plugin add subagent-extension-for-codex@shemarlindie
```

After the first command, the plugin also appears in the Plugins directory of the
Codex desktop app. You can also ask Codex to install it: _"Install the Codex
plugin subagent-extension-for-codex from the marketplace at
github.com/shemarlindie/subagent-extension-for-codex."_

Tasks run only in approved projects. By default, starting a task from a chat
approves its Git repository.

Claude uses the host's Claude Code credentials. If `ANTHROPIC_API_KEY` is set,
Claude Code uses it over the subscription login. By default, it also loads user,
project and local settings, including instructions, skills, hooks and MCP
servers. The extension doesn't manage provider credentials. Read
[Configuration and permissions](docs/configuration.md) before changing task
access.

## Start a task

Start a task in any of these ways:

1. **Ask Codex.** Describe the work in a chat, for example _"Have Claude review
   my uncommitted changes."_ Codex starts the task and, when the host supports
   it, opens Delegated Work on the task's Chat.
2. **Open the chat's panel.** Ask Codex to open Delegated Work. The panel lists
   the chat's tasks and offers **Allow tasks here** when the chat's folder isn't
   approved yet.
3. **Use the sidebar.** In the Codex desktop app, select **Delegated Work** in
   the sidebar to see tasks from every chat. **New task** starts one there.

See [How tasks run](docs/panel-guide.md#how-tasks-run) for details.

## Update

Codex checks the marketplace when it starts and installs new releases on its
own, unless you pinned a version below. To check now:

```sh
codex plugin marketplace upgrade shemarlindie
```

The new version takes over from the running service once its running turns
finish, and queued tasks carry over. See
[Updates and service handoff](docs/task-continuation.md#updates-and-service-handoff).
Startup backs up the database before applying migrations. See
[Restore a backup](docs/database.md#restore-a-backup).

To pin a version, add the marketplace at its release tag. A tag never moves, so
Codex keeps that version:

```sh
codex plugin marketplace remove shemarlindie
codex plugin marketplace add shemarlindie/subagent-extension-for-codex@v0.5.0
codex plugin add subagent-extension-for-codex@shemarlindie
```

To follow new releases again, remove the marketplace and add it without a tag.

## Uninstall

```sh
codex plugin remove subagent-extension-for-codex@shemarlindie
codex plugin marketplace remove shemarlindie
```

The service exits once Codex stops the plugin and its tasks finish. To stop it
sooner, run
`kill "$(cat ~/.local/share/subagent-extension-for-codex/service.pid)"`, which
interrupts running turns.

Tasks, settings and the worktrees the service creates are stored in
`~/.local/share/subagent-extension-for-codex`. If you delete that directory,
repositories still keep their task branches and worktree records. To clean up,
run `git worktree prune` and delete the branches.

## Troubleshooting

| Symptom                                        | Fix                                                                                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `needs Node.js 24 or later` in Codex's MCP log | Install Node.js 24 or later and make it the first `node` on the `PATH` Codex starts with.                                                |
| Tools report the service is unavailable        | Read the [service logs](docs/logging.md#diagnose-a-problem), starting with `service.jsonl` and `service.log` in the data directory.      |
| `A different extension service … is running`   | Another service owns the data directory or port, for example a development checkout. Stop it, or give development its own data and port. |
| `Port … is already in use`                     | Choose a free port or remove the address override. See [Service address](docs/configuration.md#service-address).                         |
| Claude tasks can't start                       | The panel shows a readiness message above the task list. [Claude Code CLI](docs/claude-cli.md) explains fixes.                           |
| Panel shows Reconnecting… after an update      | The new service starts once the old one's running turns finish. Wait for it to reconnect.                                                |

## Documentation

Before working on the codebase, see [What to read](AGENTS.md#what-to-read).

### Use and operate the extension

| Task                                                   | Guide                                          |
| ------------------------------------------------------ | ---------------------------------------------- |
| Start, recover, back up or continue tasks              | [Task continuation](docs/task-continuation.md) |
| Configure permissions, budgets and repository access   | [Configuration](docs/configuration.md)         |
| Delegate and review work in Codex                      | [Panel guide](docs/panel-guide.md)             |
| Diagnose service errors, authentication or performance | [Logging and diagnostics](docs/logging.md)     |
| Diagnose Claude executable readiness                   | [Claude Code CLI](docs/claude-cli.md)          |

### Develop and verify changes

| Task                                                          | Guide                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------ |
| Report a problem or propose a change                          | [Contributing](CONTRIBUTING.md)                              |
| Report a security problem                                     | [Security policy](SECURITY.md)                               |
| Follow code, test and writing conventions                     | [Agent instructions](AGENTS.md)                              |
| Understand runtime ownership and system boundaries            | [Architecture](docs/architecture.md)                         |
| Build, test, connect or preview the extension                 | [Local development](docs/development.md)                     |
| Change React components, styling and client state             | [Panel architecture](docs/panel-architecture.md)             |
| Check UI layouts and behavior in the browser                  | [UI verification](docs/ui-verification.md)                   |
| Exercise fixture worker task behavior without model calls     | [Fixture scenarios](docs/fixture-scenarios.md)               |
| Change storage, migrations or transactions                    | [Database and migrations](docs/database.md)                  |
| Qualify Claude CLI/SDK updates or run authenticated scenarios | [Claude execution verification](docs/claude-verification.md) |
| Capture the README's showcase images and video                | [Showcase captures](docs/showcase.md)                        |
| Publish a release or maintain CI                              | [Releasing and CI](docs/releasing.md)                        |

### Integrate providers and hosts

| Task                                             | Guide                                          |
| ------------------------------------------------ | ---------------------------------------------- |
| Implement provider execution and task policy     | [Provider contract](docs/provider-contract.md) |
| Change MCP tools, user authority or panel inputs | [MCP reference](docs/mcp-reference.md)         |
| Integrate project/chat context and host delivery | [Host capabilities](docs/host-capabilities.md) |

## License

MIT. See [LICENSE](LICENSE).
