# Host capabilities

Use this guide to integrate a host or check which host capabilities have been
verified. Host support can differ from the behavior this repository implements.
External references document the cited source or specification. They do not
establish compatibility with every desktop release.

- [Architecture](architecture.md) covers system responsibilities.
- [Panel guide](panel-guide.md) covers panel behavior.
- [MCP reference](mcp-reference.md) covers tool behavior and authority.

## Panel surfaces

The panel advertises `inline` and `fullscreen` display modes and prefers
`inline`. Display modes are hints, and the host owns placement.

| Entrypoint                                     | Opens                                     |
| ---------------------------------------------- | ----------------------------------------- |
| `open_subagent_extension_for_codex`            | The thread panel                          |
| `app_open_subagent_extension_for_codex_global` | The global panel. App-only.               |
| `start_task`                                   | The thread panel with the new task's Chat |

### Sidebar icon

The global entrypoint supplies theme-specific assets for the **Delegated Work**
sidebar icon:

- Light theme: [`brand-glyph-black.svg`](../assets/brand/brand-glyph-black.svg).
- Dark theme: [`brand-glyph-white.svg`](../assets/brand/brand-glyph-white.svg).

Use pure black (`#000000`) and pure white (`#ffffff`) because Codex dims the
sidebar icon. To change the icon, update the assets, rebuild, restart the
service and reload the MCP connection.

## Panel network access

Codex desktop's fixed sandbox CSP blocks direct connections from the embedded
panel to the loopback service. The panel sends all reads and writes through the
authenticated MCP Apps bridge and needs no browser bearer token. It learns of
changes and streaming replies through one `app_wait_for_updates` long poll at a
time. The standalone console uses HTTP and SSE.

Host support for long-lived MCP calls needs separate verification. See the
[MCP reference](mcp-reference.md#app-and-user-authority) for the wait contract
and [Transport](panel-guide.md#transport) for refresh behavior.

## Panel messages to the parent chat

The panel sends nothing to the chat on its own. In a thread panel, **Ask Codex**
and **Send to Codex** in
[Pending worker updates](panel-guide.md#pending-worker-updates) use the portable
`App.sendMessage` call. Codex sends the text at once, or queues it behind an
active turn. Global panels and the standalone console send nothing to the chat.

### Observed and unverified behavior

- Observed: during an active parent turn, Codex accepts the message into its
  queue. After the turn ends, the first queued message arrives as an MCP App
  message and starts the next parent turn. The API has no steer option.
- Untested: delivery to an already idle thread.
- A queued result does not show that Codex received the message or began a new
  turn.

## Settings file export

**Export file** uses the portable `App.downloadFile` call when the host
advertises `downloadFile`. The host decides where the file goes and whether to
prompt.
[Copy settings between computers](configuration.md#copy-settings-between-computers)
covers the other cases. Whether Codex advertises `downloadFile` hasn't been
checked. The dev host always does.

## Project context and registration

Portable MCP Apps host context has presentation fields but no standard
repository identity. See the
[host-context reference](https://apps.extensions.modelcontextprotocol.io/api/interfaces/types.McpUiHostContext.html).
Extra host properties, model-supplied directories and conversation IDs never
grant access.

### Codex directory hint

The optional Codex adapter advertises
`capabilities.experimental["codex/sandbox-state-meta"]`. It reads `sandboxCwd`
as a local `file:` URI and resolves its canonical Git root. Without one, it uses
the nearest registered folder, then the directory itself. It checks the result
against approved projects. An unsupported, malformed, unavailable or unapproved
hint falls back to explicit project selection or same-chat task history. The
adapter reads directory context only and inherits no host permission profile.

The adapter follows public Codex source at
[`c5d242fa`](https://github.com/openai/codex/commit/c5d242fa7907bff1b7a7e26e95febc548c0a6963)
and the reviewed `rust-v0.160.0` release:

- [MCP tool metadata](https://github.com/openai/codex/blob/c5d242fa7907bff1b7a7e26e95febc548c0a6963/codex-rs/core/src/mcp_tool_call.rs)
  supplies optional `threadId` and `sessionId`.
- [MCP client capability detection](https://github.com/openai/codex/blob/c5d242fa7907bff1b7a7e26e95febc548c0a6963/codex-rs/codex-mcp/src/rmcp_client.rs)
  opts into sandbox metadata through `experimental`.
- [Sandbox serialization](https://github.com/openai/codex/blob/c5d242fa7907bff1b7a7e26e95febc548c0a6963/codex-rs/codex-mcp/src/runtime.rs)
  and
  [PathUri](https://github.com/openai/codex/blob/c5d242fa7907bff1b7a7e26e95febc548c0a6963/codex-rs/utils/path-uri/src/lib.rs)
  define the camelCase cwd field and file-URI form.

Public CLI and core source does not prove that a particular closed-source
desktop installation delivers this metadata.

### Context precedence

- The conversation comes from an explicit argument, then the optional
  [`openai/session`](https://developers.openai.com/plugins/reference), then the
  Codex `threadId`. The service never substitutes `sessionId` for `threadId`.
- An explicitly selected owned task supplies its own scope. Conflicting
  repository, revision or conversation arguments cause an error.
- `conversation_id: null` bypasses host correlation and means all chats.
- Global launches ignore chat and directory context. Same-chat history can
  supply defaults, and unrelated global history cannot.

### Registration

Reading context never registers a project, though it can suggest **Allow tasks
here**. Registration needs a user action or the configured task-start policy,
which adds Git roots only. A chat with no directory has no candidate.
Directories Codex generates for chats outside a project are treated like any
other folder. `get_current_project` reports registration and the task-start
policy without changing either. Model-supplied paths cannot grant access or
trigger automatic registration.
[Repository access](configuration.md#repository-access) owns these rules.

The native macOS folder picker runs on the service machine and returns the
chosen path for registration. Other platforms use the path field.

## Composer mentions

Composer mentions are temporarily disabled. The flow in Codex is unverified. To
test, set `composerMentionsEnabled` to `true` in
`src/service/platform/server/mentions.ts`.

## Plugin startup and hooks

`mcp.json` launches the packaged stdio proxy, which connects to or starts the
shared local service. Disconnecting stdio leaves tasks running. The service
exits once no client remains and its tasks finish, as
[Reconnect after a restart](task-continuation.md#reconnect-after-a-restart)
describes. The launcher's working directory belongs to the installed package, so
it cannot identify the chat project. See [Build](development.md#build) for
package contents.

The package has no lifecycle hooks or native settings entrypoint. Edit settings
in the panel. See
[plugin packaging](https://developers.openai.com/plugins/build/plugins).

## Verification boundary

| Evidence                | Establishes                                                   |
| ----------------------- | ------------------------------------------------------------- |
| Transport/context tests | Precedence, scope isolation, validation and protocol behavior |
| Browser fixtures        | Rendering without paid workers                                |
| Observation in Codex    | Sidebar startup                                               |

None of these proves host placement, folder selection, mention selection and
handoff, or background message delivery.
[UI verification](ui-verification.md#measurement-and-checks-in-codex) lists the
checks to run in Codex, and
[What reloads when](development.md#what-reloads-when) covers applying changes.
