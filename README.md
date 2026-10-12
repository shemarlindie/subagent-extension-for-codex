# Codex subagent extension

Delegate Claude coding tasks from Codex through a local MCP service. Claude runs through the Claude Agent SDK and Claude Code harness; one service owns scheduling, durable task state and Git worktrees. Disconnecting a client leaves tasks running.

## Quick start

Requires Node.js 24+, Git and a [supported Claude Code CLI](docs/claude-cli.md) configured on the service host.

1. Install dependencies and build from the checkout root:

   ```sh
   npm ci
   npm run build
   ```

2. [Connect Codex](#connect-codex) using stdio or Streamable HTTP. The stdio
   launcher can start the service automatically; HTTP requires starting the
   service yourself. For development testing in Codex, build before running
   `npm run dev`; see [Run the service](docs/development.md#run-the-service).
3. Reload the MCP connection and open **Delegated Work** in Codex. Use
   **Manage → Add project** to approve a Git repository root with at least one
   commit.

You can also manage projects in the standalone console at
`http://127.0.0.1:4317` while the service is running. Sign in with the token in
`~/.local/share/codex-subagent-extension/admin-token` (or your configured data
directory). Treat the token as a credential; do not paste it into chats or commit
it.

Claude uses the host's Claude Code credentials and user, project and local settings, including instructions, skills, hooks and MCP servers. This extension does not manage provider credentials. See [configuration and permissions](docs/configuration.md) before changing execution authority or session restrictions.

For UI previews and interactive testing without model calls, see [development tools](docs/development.md#choosing-a-development-tool).

## Connect Codex

Choose one transport and add its example to `~/.codex/config.toml`. Both expose
the same task tools and MCP App. Replace the existing server entry when switching
transports; do not combine its stdio and HTTP settings. See the
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

The launcher connects to the local service or starts it when needed. It reads the admin token itself. If you override `CODEX_SUBAGENT_EXTENSION_DATA`, give the service and MCP launcher the same absolute path through `[mcp_servers.codex_subagent_extension.env]`. See [task continuation](docs/setup-and-resume.md) for recovery and state preservation, and [Configuration](docs/configuration.md#admin-token) for token overrides.

### Streamable HTTP

Start the service before connecting Codex:

```sh
npm run build && npm start
```

For development, use `npm run build && npm run dev` instead. Both serve the built
panel; follow [the reload guide](docs/development.md#what-reloads-when) after edits.

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

Keep the token and configuration private; do not paste them into chats or commit
them. Update the URL if you changed the service port. HTTP connections require
you to keep the service running; Codex does not start it through this transport.

### Verify either connection

After saving the configuration, reload the MCP connection in Codex and open
**Delegated Work** from a chat. Use `codex mcp list` to check the configured server;
opening the panel verifies the connection. Changed tool metadata also requires
MCP reconnection. Task/input host forms and webhook events are HTTP-only. Host
placement, metadata, mention handoff and registered-host delivery still need live
verification; see [host capabilities](docs/host-capabilities.md).

`npm run package:plugin` builds an npm tarball containing the service, proxy, panel and delegation skill. Extract its `package/` directory as the local plugin root. Installation alone does not start the service; the host starts the stdio launcher. [Build details](docs/development.md#build) cover packaging and checks.

## Working with tasks

- **Workspace:** tasks default to `current_repo`, editing the approved checkout with its existing changes. Choose `worktree` to start from a committed revision on a separate branch (`agent/<task-id>` by default). The service never merges changes automatically. A worktree separates code; it does not contain the operating system.
- **Profiles:** researcher, reviewer and security reviewer inspect only by default. Implementer, debugger, test engineer and refactorer can write. User settings control permissions and restrictions.
- **Conversation:** completed, failed and interrupted tasks accept follow-ups. During a turn, messages can steer at the next tool boundary, queue another turn, or interrupt and start a new turn. A plain interrupt pauses the queue.
- **Review:** replies stream into Chat. The Changes tab reads live Git changes; `get_agent_messages` and `get_agent_changes` let the parent retrieve replies and patches. Concurrent edits to files touched by the task can also appear in its changes.
- **Continuation:** a later turn resumes the Claude session when its original worker and transcript are available; otherwise it starts a fresh session carrying the conversation. Removing a worktree keeps its branch, and the next turn recreates it.
- **Limits:** runtime and cost budgets span turns and can be raised from the Chat warning notice before continuing. Token budgets are unsupported. Cost ceilings are checked after responses and are not a hard billing cap.

Questions and permissions wait for an answer tied to the exact request ID. Permissions route to the user by default; user-approved settings can route them to the parent. Claude's own permission rules can allow or deny an action before it reaches that route.

Use [the panel guide](docs/codex-panel.md) for delegation, Chat, Changes and project scope, and [the continuation guide](docs/setup-and-resume.md) for recovery and backups. This single-user service defaults to loopback. See [local network access](docs/development.md#access-from-your-local-network) for trusted LAN development; public or multi-user hosting needs separate authentication and deployment work.

## Documentation

| Read when                                                   | Guide                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------- |
| Contributing to any area                                    | [Agent instructions](AGENTS.md)                         |
| Setting up or continuing tasks                              | [Setup and task continuation](docs/setup-and-resume.md) |
| Changing service settings, permissions or repository access | [Configuration](docs/configuration.md)                  |
| Building, testing, previewing or packaging                  | [Local development](docs/development.md)                |
| Working on the panel's behavior                             | [Panel guide](docs/codex-panel.md)                      |
| Working on React components and state                       | [React UI architecture](docs/react-ui.md)               |
| Working on system boundaries                                | [Architecture](docs/architecture.md)                    |
| Implementing a provider or task execution                   | [Provider contract](docs/provider-contract.md)          |
| Changing MCP tools, forms or events                         | [MCP reference](docs/mcp-reference.md)                  |
| Integrating with Codex or other MCP hosts                   | [Host capabilities](docs/host-capabilities.md)          |
| Diagnosing Claude executable readiness                      | [Claude Code CLI](docs/claude-cli.md)                   |
| Assessing verified behavior and remaining gaps              | [Implementation status](docs/implementation-status.md)  |

The implementation and tests establish current behavior. [Sanitized live Claude evidence](docs/live-claude-verification.json) records the scenarios tested on this machine; [live checks](docs/development.md#live-claude-checks) explain how to repeat them.
