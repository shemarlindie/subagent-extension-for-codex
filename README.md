# Codex subagent extension

Delegate Claude coding tasks from Codex through a local MCP service. Claude runs through the Claude Agent SDK and Claude Code harness. One service owns scheduling, durable task state and Git worktrees. Disconnecting a client leaves tasks running.

## Quick start

Requires Node.js 24+, Git and a [supported Claude Code CLI](docs/claude-cli.md) configured on the service host.

1. Install dependencies and build from the checkout root:

   ```sh
   npm ci
   npm run build
   ```

2. [Connect Codex](#connect-codex) using stdio or Streamable HTTP. The stdio
   launcher can start the service automatically. HTTP requires starting the
   service yourself.
3. Reload the MCP connection and open **Delegated Work** in Codex. Use
   **Manage → Add project** to approve a Git repository root with at least one
   commit.

You can also manage projects in the standalone console at
`http://127.0.0.1:4317` while the service is running. Sign in with the token in
`~/.local/share/codex-subagent-extension/admin-token` (or your configured data
directory). Treat the token as a credential. Do not paste it into chats or commit
it.

Claude uses the host's Claude Code credentials and user, project and local settings, including instructions, skills, hooks and MCP servers. This extension does not manage provider credentials. See [configuration and permissions](docs/configuration.md) before changing execution authority or session restrictions.

For UI previews and interactive testing without model calls, see [development tools](docs/development.md#choosing-a-development-tool).

## Connect Codex

Choose one transport and add its example to `~/.codex/config.toml`. Both expose
the same task tools and MCP App. Replace the existing server entry when switching
transports. Do not combine its stdio and HTTP settings. See the
[Codex MCP configuration reference](https://learn.chatgpt.com/docs/extend/mcp#configure-with-configtoml)
for supported options.

### Stdio

Run `npm run build`, then configure the built launcher using an absolute checkout
path:

```toml
[mcp_servers.codex_subagent_extension]
command = "node"
args = ["<checkout-root>/dist/stdio.js"]
```

The launcher connects to the local service or starts it when needed. It reads the admin token itself. If you override `CODEX_SUBAGENT_EXTENSION_DATA`, give the service and MCP launcher the same absolute path through `[mcp_servers.codex_subagent_extension.env]`. See [task continuation](docs/task-continuation.md) for recovery and state preservation, and [Configuration](docs/configuration.md#admin-token) for token overrides.

### Streamable HTTP

Start the service before connecting Codex:

```sh
npm run build && npm start
```

For development, use `npm run build && npm run dev` instead. Both serve the built
panel. Follow [the reload guide](docs/development.md#what-reloads-when) after edits.

Configure the authenticated `/mcp` endpoint:

```toml
[mcp_servers.codex_subagent_extension]
url = "http://127.0.0.1:4317/mcp"

[mcp_servers.codex_subagent_extension.http_headers]
Authorization = "Bearer <admin-token>"
```

Replace `<admin-token>` locally with the contents of
`~/.local/share/codex-subagent-extension/admin-token`, or
`<data-directory>/admin-token` if you changed the data directory. If the service
uses `CODEX_SUBAGENT_EXTENSION_TOKEN`, use that override instead. On macOS, copy
the default file's token without printing it:

```sh
pbcopy < ~/.local/share/codex-subagent-extension/admin-token
```

Keep the token and configuration private. Do not paste them into chats or commit
them. Update the URL if you changed the service port. HTTP connections require
you to keep the service running. Codex does not start it through this transport.

### Verify either connection

After saving the configuration, reload the MCP connection in Codex. Check the
configured server with `codex mcp list`, then open **Delegated Work** from a chat
to verify the connection. Reload the MCP connection whenever tool metadata changes. To check UI changes in Codex, see
[UI verification](docs/ui-verification.md#measurement-and-checks-in-codex).

`npm run package:plugin` builds an npm tarball containing the service, proxy, panel and delegation skill. Extract its `package/` directory as the local plugin root. Installation alone does not start the service. The host starts the stdio launcher. [Build details](docs/development.md#build) cover packaging and checks.

## Working with tasks

Tasks default to the approved checkout, including its uncommitted changes. Choose
`worktree` to work from a committed revision in a separate checkout. The service
never merges changes automatically, and worktrees are not security sandboxes.
Researcher, reviewer and security reviewer profiles inspect only by default.
Writing profiles follow the user's saved permissions and restrictions.

Replies stream into Chat, and Changes shows live Git changes. Tasks accept
follow-ups after completion, failure or interruption. During a turn, a message
can steer the worker, queue another turn, or interrupt and start a new one.
Runtime and cost budgets span turns. Cost ceilings are not a hard billing cap.

See [the panel guide](docs/panel-guide.md) for delegation and review,
[configuration](docs/configuration.md) for permissions and limits, and
[task continuation](docs/task-continuation.md) for session recovery and backups.
This single-user service defaults to loopback. [Trusted LAN development](docs/development.md#access-from-your-local-network)
is available.

## Documentation

Choose a guide for your task.
[Architecture](docs/architecture.md) explains the code boundaries.

### Use and operate the extension

| Task                                                 | Guide                                          |
| ---------------------------------------------------- | ---------------------------------------------- |
| Start, recover, back up or continue tasks            | [Task continuation](docs/task-continuation.md) |
| Configure permissions, budgets and repository access | [Configuration](docs/configuration.md)         |
| Delegate and review work in Codex or the console     | [Panel guide](docs/panel-guide.md)             |
| Diagnose Claude executable readiness                 | [Claude Code CLI](docs/claude-cli.md)          |

### Develop and verify changes

| Task                                                          | Guide                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------ |
| Follow contribution and documentation conventions             | [Agent instructions](AGENTS.md)                              |
| Understand runtime ownership and system boundaries            | [Architecture](docs/architecture.md)                         |
| Build, test, preview or package the extension                 | [Local development](docs/development.md)                     |
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
