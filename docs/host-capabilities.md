# Host capabilities

Use this guide to integrate a host or assess which capabilities have been
verified. Host support can differ from the behavior implemented in this
repository. External references document the cited source or specification
without establishing compatibility with every desktop release.

For system responsibilities see [Architecture](architecture.md). For panel
behavior see [Panel guide](panel-guide.md).

## Panel surfaces

`src/service/platform/panel/panel.ts` advertises `inline` and `fullscreen` and prefers
`inline`. `open_codex_subagent_extension` exposes the thread entrypoint.
`app_open_codex_subagent_extension_global` is app-only and exposes the global
entrypoint. Task creation also attaches the panel resource and selects the new
task on Chat. Display-mode preferences are hints. The host owns physical placement.

### Sidebar icon

The global MCP entrypoint supplies theme-specific assets for the **Delegated
Work** sidebar icon:

- Light theme: [`brand-glyph-black.svg`](../assets/brand/brand-glyph-black.svg).
- Dark theme: [`brand-glyph-white.svg`](../assets/brand/brand-glyph-white.svg).

Use pure black (`#000000`) and pure white (`#ffffff`) in these assets because
Codex dims the displayed sidebar icon.

To change the icon, update those assets, rebuild, restart the service and reload
the MCP connection.

## Panel network access

Codex desktop's fixed sandbox CSP blocks direct connections from the embedded
panel to the loopback service. All panel reads and writes use the authenticated
MCP Apps bridge. The panel
learns of changes and streaming replies through one `app_wait_for_updates`
long poll at a time. The standalone console uses HTTP and SSE. See
[Transport](panel-guide.md#transport) for refresh behavior.

The panel requires no browser bearer token. Host support for long-lived MCP
calls must be verified separately. The service's wait contract is in the
[MCP reference](mcp-reference.md#app-and-user-authority).

## Worker messages to the parent chat

A mounted, connected thread panel can forward ID-only worker notifications
through `App.sendMessage` when the host advertises `openai/message`. Automatic
submission uses `_meta["openai/message"]: { target: "active", send: true }`.
**Ask Codex** uses the portable bridge call to place text in the composer or queue.

With automatic submission, Codex has been observed accepting messages into the
queue during an active parent turn. After that turn ends, the first queued
message arrives as an MCP App message and starts the next parent turn. The API
has no steer option. Delivery to an already idle thread is untested.

The panel attempts delivery on service changes and a fallback timer, including
while hidden or busy. Host suspension or panel teardown can stop it. Global
panels and the standalone console do not forward worker messages.

The host delivers notifications as user messages. Each notification identifies
its worker source, task and stable message ID and tells the parent to retrieve
the stored report.
Polling returns the same report ID. See [MCP reference](mcp-reference.md#provider-messages-to-the-parent)
for retrieval, polling supervision and durable acknowledgement.
The service saves a claim before sending so multiple panels cannot attempt the
same notification. It records host acceptance and delivery failures. An ambiguous
failure or panel teardown does not trigger an automatic retry. The report remains available
through polling even when notification delivery is lost.

Delivery while a panel is closed, unrendered, offscreen, or in another chat is
unverified. A queued result does not mean Codex received the message or began a
new turn. Verify those lifecycle cases separately from open-panel delivery.

## Project context and registration

Portable MCP Apps host context has presentation fields but no standardized
repository identity. See the [host-context reference](https://apps.extensions.modelcontextprotocol.io/api/interfaces/types.McpUiHostContext.html).
An extra host property, a model-supplied directory, and a conversation identifier
are not access grants.

The optional Codex adapter advertises
`capabilities.experimental["codex/sandbox-state-meta"]`. It consumes
`sandboxCwd` as a local `file:` URI, resolves its canonical Git root, and validates
it against approved projects. Unsupported, malformed, unavailable and unapproved
hints fall back to explicit project selection or same-chat task history.

The adapter is backed by public Codex source pinned to
[`c5d242fa`](https://github.com/openai/codex/commit/c5d242fa7907bff1b7a7e26e95febc548c0a6963)
and the reviewed `rust-v0.160.0` release:

- [MCP tool metadata](https://github.com/openai/codex/blob/c5d242fa7907bff1b7a7e26e95febc548c0a6963/codex-rs/core/src/mcp_tool_call.rs)
  supplies optional `threadId` and `sessionId`.
- [MCP client capability detection](https://github.com/openai/codex/blob/c5d242fa7907bff1b7a7e26e95febc548c0a6963/codex-rs/codex-mcp/src/rmcp_client.rs)
  opts into sandbox metadata through `experimental`.
- [Sandbox serialization](https://github.com/openai/codex/blob/c5d242fa7907bff1b7a7e26e95febc548c0a6963/codex-rs/codex-mcp/src/runtime.rs)
  and [PathUri](https://github.com/openai/codex/blob/c5d242fa7907bff1b7a7e26e95febc548c0a6963/codex-rs/utils/path-uri/src/lib.rs)
  establish the camelCase cwd field and file-URI representation.

Public CLI/core source does not prove metadata delivery in a particular closed
source desktop installation. This adapter reads directory context only. It does
not inherit a host permission profile.

Conversation correlation prefers an explicit argument, then the documented
optional [`openai/session`](https://developers.openai.com/plugins/reference), then
Codex `threadId`. `sessionId` is not used as a substitute for `threadId`.
An explicitly selected owned task supplies its own scope. Conflicting explicit
repository, revision or conversation arguments cause an error. Explicit
`conversation_id: null` bypasses host correlation and means all chats.
Global launches ignore ambient chat/directory context. Same-chat history can
supply defaults. Unrelated global task history cannot.

Read-only context resolution can suggest **Add chat project**, but never registers
it. Registration requires a user action or the configured task-start policy.
[Repository access](configuration.md#repository-access) owns these rules.
`get_current_project` reports registration and task-start policy without
changing either. Model-supplied paths cannot grant access or trigger automatic
registration.

The native macOS folder picker runs on the service machine and registers the
selected root without starting a task. Other platforms use the path field.

## Composer mentions

Both transports expose app-only `app_search_mentions` and the Claude resource link.
Search accepts worker/profile terms and the server name as an alias, and returns
Claude when the reviewer profile is available. A selected mention is a provider
hint. It selects no repository and changes no permissions.

The server appears in the desktop picker. Delivery of the selected item and the
full delegation flow are unverified.
Use ordinary MCP tools and the delegation skill when mentions are unavailable.
The [extension guide](https://developers.openai.com/plugins/build/extensions)
and [mention specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#composer-at-mentions)
describe the intended host surface.

## Plugin startup and hooks

`mcp.json` launches the packaged stdio proxy, which connects to or starts the
shared local service. Disconnecting stdio leaves the service and tasks running.
The launcher's cwd belongs to the installed package and cannot identify the
current chat project. See [Build](development.md#build) for package contents.

Use the panel to edit settings. The package has no lifecycle hooks or native
settings entrypoint. Project context comes from explicit arguments and validated
host metadata, as described above. See
[plugin packaging](https://developers.openai.com/plugins/build/plugins).

## Verification boundary

Transport/context tests establish precedence, scope isolation, validation and
protocol behavior. Browser fixtures establish rendering without paid workers.
Neither proves host placement, folder-selection behavior, mention handoff or
background message delivery. Sidebar startup has been observed. Mention search
results alone do not establish selection and handoff.

[UI verification](ui-verification.md#measurement-and-checks-in-codex) lists the
checks to run in Codex, and [What reloads when](development.md#what-reloads-when)
covers applying changes.
