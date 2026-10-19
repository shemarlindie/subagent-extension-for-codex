# Codex subagent extension

Delegate Claude coding tasks from Codex through a local MCP service. Claude runs through the Claude Agent SDK and Claude Code harness. One service owns scheduling, durable task state and Git worktrees. Disconnecting a client leaves tasks running.

## Install

You need:

- [Claude Code](https://code.claude.com/docs/en/setup) 2.1.285 or later, signed in: run `claude` once and complete sign-in. See [Claude Code CLI](docs/claude-cli.md) for how the extension finds it.
- Node.js 24 or later as the `node` Codex finds on its `PATH`.
- Git.
- A Codex build with plugin marketplaces. The install is tested with Codex CLI 0.162.1.

Add the marketplace, then install the plugin:

```sh
codex plugin marketplace add shemarlindie/codex-subagent-extension@release
codex plugin add codex-subagent-extension@shemarlindie
```

After the first command, the plugin also appears in the Codex desktop app's Plugins directory. Or ask Codex to do it: _"Install the Codex plugin codex-subagent-extension from the release branch of github.com/shemarlindie/codex-subagent-extension."_

Then open **Delegated Work** from a Codex chat and use **Manage → Add project** to approve a Git repository root with at least one commit. The plugin starts its local service the first time Codex connects.

You can also manage projects in the standalone console at `http://127.0.0.1:17317` while the service is running. Sign in with the token in `~/.local/share/codex-subagent-extension/admin-token`. Treat the token as a credential. Do not paste it into chats or commit it.

Claude uses the host's Claude Code credentials and user, project and local settings, including instructions, skills, hooks and MCP servers. This extension does not manage provider credentials. See [configuration and permissions](docs/configuration.md) before changing execution authority or session restrictions.

### Moving from a manual setup

If you connected a checkout by hand before, delete `[mcp_servers.codex_subagent_extension]` (and its `.env` or `http_headers` tables) from `~/.codex/config.toml`. Otherwise Codex runs both servers and lists every tool twice. Stop the old service if it's still running. The plugin won't stop a service it didn't start.

## Update

Codex checks the marketplace when it starts and installs new releases on its own. To check now:

```sh
codex plugin marketplace upgrade shemarlindie
```

The new version takes over from the running service once its running turns finish. Queued tasks carry over. See [updates and service handoff](docs/task-continuation.md#updates-and-service-handoff). Startup backs up the database before applying migrations. [Database](docs/database.md#restore-a-backup) explains restoring one.

To stay on one version, add the marketplace at a release tag instead of the branch, for example `codex plugin marketplace add shemarlindie/codex-subagent-extension@v0.1.0`. Remove the marketplace first if it's already added.

Alpha and beta versions, such as `v0.2.0-beta.1`, are published only as tags and marked as prereleases on GitHub. The `release` branch never receives them. To try one, add the marketplace at its tag the same way. To move to a newer prerelease or back to stable releases, remove the marketplace and add it again at the new tag or at `@release`.

## Uninstall

```sh
codex plugin remove codex-subagent-extension@shemarlindie
codex plugin marketplace remove shemarlindie
```

Removing the plugin leaves the service running until it stops. Stop it with `kill "$(cat ~/.local/share/codex-subagent-extension/service.pid)"`. Running turns are interrupted. Your tasks, settings and worktrees stay in `~/.local/share/codex-subagent-extension`. Delete that directory to remove them. Branches the tasks created stay in their repositories.

## Troubleshooting

| Symptom                                        | Fix                                                                                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `needs Node.js 24 or later` in Codex's MCP log | Install Node.js 24+ and make it the first `node` on the `PATH` Codex starts with.                                                        |
| Tools report the service is unavailable        | Read [service logs](docs/logging.md#diagnose-a-problem), starting with `service.jsonl` and `service.log` in the data directory.          |
| `A different extension service … is running`   | Another service owns the data directory or port, for example a development checkout. Stop it, or give development its own data and port. |
| Claude tasks can't start                       | The panel shows a readiness message above the task list. [Claude Code CLI](docs/claude-cli.md) explains fixes.                           |

For connecting a checkout over stdio or Streamable HTTP instead of installing the plugin, see [Connect Codex from a checkout](docs/development.md#connect-codex-from-a-checkout).

## Working with tasks

Tasks default to the approved checkout, including its uncommitted changes. Choose
`worktree` to work from a committed revision in a separate checkout. The service
never merges changes automatically, and worktrees are not security sandboxes.
Researcher, reviewer and security reviewer profiles inspect only by default.
Writing profiles follow the user's saved permissions and restrictions.

Replies stream into Chat, and Changes shows the task's recorded tool edits. Tasks accept
follow-ups after completion, failure or interruption. During a turn, a message
can steer the worker, queue another turn, or interrupt and start a new one.
Runtime and cost budgets span turns. Cost ceilings are not a hard billing cap.

See [the panel guide](docs/panel-guide.md) for delegation and review,
[configuration](docs/configuration.md) for permissions and limits, and
[task continuation](docs/task-continuation.md) for session recovery and backups.
This single-user service defaults to loopback. [Trusted LAN development](docs/development.md#access-from-your-local-network)
is available.

## Documentation

Choose a guide for your task from the tables below. When starting work on the
codebase, follow this suggested reading order:

1. [Architecture](docs/architecture.md) for runtime ownership and code boundaries.
2. [Local development](docs/development.md#choosing-a-development-tool) for choosing
   a development tool and running the relevant [checks](docs/development.md#checks).
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
