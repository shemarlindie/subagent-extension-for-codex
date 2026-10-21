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

| Entrypoint                                 | Opens                                     |
| ------------------------------------------ | ----------------------------------------- |
| `open_codex_subagent_extension`            | The thread panel                          |
| `app_open_codex_subagent_extension_global` | The global panel. App-only.               |
| `start_task`                               | The thread panel with the new task's Chat |

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

## Worker messages to the parent chat

A mounted, connected thread panel forwards ID-only worker notifications through
`App.sendMessage` when the host advertises `openai/message`. Automatic
submission uses `_meta["openai/message"]: { target: "active", send: true }`.
**Ask Codex** uses the portable bridge call to place text in the composer or
queue. Global panels and the standalone console do not forward notifications.

Each notification arrives as a user message. It names the worker, task and
stable message ID and tells the parent to retrieve the stored report. See the
[MCP reference](mcp-reference.md#provider-messages-to-the-parent) for retrieval,
polling and acknowledgement.

The panel attempts delivery on service changes and on a fallback timer, even
while hidden or busy. The service saves a claim before sending, so only one
panel attempts each notification, and it records host acceptance or failure.
An ambiguous failure or panel teardown causes no automatic retry. The report
stays available through polling when a notification is lost.

### Observed and unverified behavior

- Observed: during an active parent turn, Codex accepts automatic submissions
  into its queue. After the turn ends, the first queued message arrives as an
  MCP App message and starts the next parent turn. The API has no steer option.
- Untested: delivery to an already idle thread.
- Unverified: delivery while the panel is closed, unrendered, offscreen or in
  another chat. Host suspension or panel teardown can stop delivery.
- A queued result does not show that Codex received the message or began a new
  turn.

## Project context and registration

Portable MCP Apps host context has presentation fields but no standard
repository identity. See the
[host-context reference](https://apps.extensions.modelcontextprotocol.io/api/interfaces/types.McpUiHostContext.html).
Extra host properties, model-supplied directories and conversation IDs never
grant access.

### Codex directory hint

The optional Codex adapter advertises
`capabilities.experimental["codex/sandbox-state-meta"]`. It reads `sandboxCwd`
as a local `file:` URI, resolves its canonical Git root, and checks it against
approved projects. An unsupported, malformed, unavailable or unapproved hint
falls back to explicit project selection or same-chat task history. The adapter
reads directory context only and inherits no host permission profile.

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

Reading context never registers a project, though it can suggest **Add chat
project**. Registration needs a user action or the configured task-start policy.
`get_current_project` reports registration and the task-start policy without
changing either. Model-supplied paths cannot grant access or trigger automatic
registration. [Repository access](configuration.md#repository-access) owns these
rules.

The native macOS folder picker runs on the service machine and returns the
chosen path for registration. Other platforms use the path field.

## Composer mentions

Both transports expose app-only `app_search_mentions` and the Claude resource
link. Search matches worker and profile terms, with the server name as an alias,
and returns Claude when the reviewer profile is available. A selected mention is
a provider hint. It selects no repository and changes no permissions.

The server appears in the desktop picker. Delivery of the selected item and the
full delegation flow are unverified. When mentions are unavailable, use ordinary
MCP tools and the delegation skill. The
[extension guide](https://developers.openai.com/plugins/build/extensions) and
[mention specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#composer-at-mentions)
describe the intended host surface.

## Plugin startup and hooks

`mcp.json` launches the packaged stdio proxy, which connects to or starts the
shared local service. Disconnecting stdio leaves the service and tasks running.
The launcher's working directory belongs to the installed package, so it cannot
identify the chat project. See [Build](development.md#build) for package
contents.

The package has no lifecycle hooks or native settings entrypoint. Edit settings
in the panel. See
[plugin packaging](https://developers.openai.com/plugins/build/plugins).

## Verification boundary

| Evidence                | Establishes                                                   |
| ----------------------- | ------------------------------------------------------------- |
| Transport/context tests | Precedence, scope isolation, validation and protocol behavior |
| Browser fixtures        | Rendering without paid workers                                |
| Observation in Codex    | Sidebar startup and mention search results                    |

None of these proves host placement, folder selection, mention selection and
handoff, or background message delivery.
[UI verification](ui-verification.md#measurement-and-checks-in-codex) lists the
checks to run in Codex, and
[What reloads when](development.md#what-reloads-when) covers applying changes.
