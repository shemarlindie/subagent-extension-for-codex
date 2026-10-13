# Host capabilities

This guide separates integration implemented in this repository from capabilities
that depend on the connected host. Local code was reviewed on October 9, 2026.
External references below retain the scope of the October 2–5 documentation/source
review; they are not a fresh compatibility claim for every desktop release.

For system responsibilities see [Architecture](architecture.md); for panel
behavior and activation see [Codex panel](codex-panel.md).

## Display modes and native extension surfaces

`src/service/platform/panel/panel.ts` advertises `inline` and `fullscreen` and prefers
`inline`. `open_codex_subagent_extension` exposes the thread entrypoint;
`open_codex_subagent_extension_global` is app-only and exposes the global
entrypoint. Task creation also attaches the panel resource and selects the new
task on Chat. Display-mode preferences are hints; the host owns physical placement.

The extension does not advertise PiP or a native pinned-summary surface. Its compact inline summary is part of the widget; display-mode requests do not guarantee desktop pane geometry.

### Sidebar icon

The **Delegated Work** sidebar icon is set by the `icons` field on the
`open_codex_subagent_extension_global` MCP tool in
`src/service/platform/panel/panel.ts`. Its
`_meta["openai/ui"].entrypoints: [{ type: "global" }]` registers the sidebar entry.

The icon array, `productGlyphIcons`, comes from
`src/service/platform/server/product-glyph.ts`. It encodes these SVG files as
base64 data URIs with theme metadata:

- Light theme: [`brand-glyph-black.svg`](../assets/brand/brand-glyph-black.svg).
- Dark theme: [`brand-glyph-white.svg`](../assets/brand/brand-glyph-white.svg).

Use pure black (`#000000`) and pure white (`#ffffff`) in these assets because
Codex dims the displayed sidebar icon.

To change the icon, update those assets, rebuild, restart the service and reload
the MCP connection.

## Panel network access

Observed in the target Codex desktop installation: the embedded panel uses a
fixed sandbox CSP and cannot connect directly to the loopback service. All panel
reads and writes therefore use the authenticated MCP Apps bridge. Streaming
replies use chained `get_user_agent_draft` polls; the standalone console uses
HTTP and SSE.

Draft polls wait at most 25 seconds. Transport timeouts add a 10-second margin
for these calls; the stdio proxy's ordinary service timeout is 30 seconds.
These limits are implemented contracts, not a guarantee that every host permits
long-lived calls. The panel requires no browser bearer token.

## Worker messages to the parent chat

Claude receives `mcp__codex_parent__message_parent` and environment instructions
for task identity, workspace, parent conversation and delivery limits. The tool
queues a durable `parent.message` event. While a thread-scoped embedded panel is
mounted, connected and advertises `openai/message`, its normal refresh claims
one ID-only notification and sends it through `App.sendMessage` with
`_meta["openai/message"]: { target: "active", send: true }`. Ordinary **Ask Codex**
uses the portable bridge call. In the October 11, 2026 live check, that portable
call put the worker message into the composer or queue, as confirmed by the user.
Automatic submission uses the OpenAI extension capability explicitly. A second
probe with `send: true` was accepted by the host and appeared in the queue while
the parent turn was active, as confirmed by the user. The installed message
API has no steer option. After the parent turn ended, the first queued marker
arrived as an MCP App message and started the next parent turn. This verifies
queued continuation with the panel open; delivery to a thread already idle at
the time of submission remains untested.
The mounted panel attempts parent delivery on its five-second timer even while
hidden or busy; UI reads can remain paused. Host suspension or panel teardown
can stop that timer, so this does not establish background host delivery.
Global panels and the standalone console do not forward worker messages.

The host uses a user-message envelope, so the notification identifies its worker-report source, task
and stable message ID, and directs the parent to retrieve the stored report.
Polling returns the same report ID; see [MCP reference](mcp-reference.md#provider-messages-to-the-parent)
for retrieval, polling supervision and durable acknowledgement.
Worker content does not grant user authority. A claim is persisted before sending to prevent duplicate attempts from multiple panels. The panel rechecks acknowledgement before submission and records a skip if
already processed. It records host acceptance or failure; an ambiguous failure or teardown is not
automatically retried. This proof of concept favors avoiding duplicates over
recovering every interrupted delivery.

Delivery while a panel is closed, unrendered, offscreen, or in another chat is
unverified. A queued result does not mean Codex received the message or began a
new turn. Verify those lifecycle cases separately from open-panel delivery.

## Project context and registration

Portable MCP Apps host context has presentation fields but no standardized
repository identity. See the [host-context reference](https://apps.extensions.modelcontextprotocol.io/api/interfaces/types.McpUiHostContext.html).
An extra host property, a model-supplied directory, and a conversation identifier
are not access grants.

The implemented optional Codex adapter advertises
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
source desktop installation. This adapter reads directory context only; it does
not inherit a host permission profile.

Conversation correlation prefers an explicit argument, then the documented
optional [`openai/session`](https://developers.openai.com/plugins/reference), then
Codex `threadId`. `sessionId` is not used as a substitute for `threadId`.
An explicitly selected owned task supplies its own scope; conflicting explicit
repository, revision or conversation arguments reject. Explicit
`conversation_id: null` bypasses host correlation and means all chats.
Global launches ignore ambient chat/directory context. Same-chat history can
supply defaults; unrelated global task history cannot.

Read-only context resolution may return an **Add chat project** suggestion but
never registers it. Registration is available through:

- Panel **Add project**, the local projects CLI, or configured approved roots.
- **Browse…** in New task: the native macOS folder picker registers the selected
  root and selects it for the draft. It does not start the task. The dialog runs
  on the service machine; other platforms use the path field.
- **Automatically add chat projects**, a user-only persistent setting, enabled
  by default. It registers the host's local Git root when a task starts for that
  root from the chat. Only original transport directory metadata can trigger
  this policy; task paths and `host_directory` arguments cannot. Read-only calls
  never trigger it. Disabling it retains existing registrations.

`get_current_agent_project` is read-only and reports whether the host root is
registered and whether task-start registration is enabled. All registration
routes preserve canonical-path and Git-root validation. A repository grant
covers that root; an explicitly approved parent grant can cover child repositories.
MCP hosts must enforce app-only visibility; the generic model API rejects
user-only operations.

## Composer mentions

Both transports expose app-only `search_mentions` and the Claude resource link.
Search accepts worker/profile terms and the server name as an alias, and returns
Claude when the reviewer profile is available. A selected mention is a provider
hint; it selects no repository and changes no permissions.

The prior review confirmed the server appeared in the desktop picker; delivery
of the selected item and the full delegation flow still need a live host check.
Use ordinary MCP tools and the delegation skill when mentions are unavailable.
The [extension guide](https://developers.openai.com/plugins/build/extensions)
and [mention specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#composer-at-mentions)
describe the intended host surface.

## Plugin startup and hooks

The distributable includes root `plugin.json`, `mcp.json`, compiled `dist`,
migrations, assets and `skills`. `mcp.json` launches `dist/stdio.js`, which connects
to or starts the shared local service. Disconnecting stdio does not stop the
service or its tasks. The launcher's cwd belongs to the installed package and
cannot identify the current chat project. A local install does not deploy a
service to an unrelated cloud machine.

There are no packaged lifecycle hooks or native settings entrypoint. The panel is the settings editor. Project context comes from the explicit and validated metadata paths described above. See [plugin packaging](https://developers.openai.com/plugins/build/plugins).

## Verification boundary

Transport/context tests establish explicit precedence, scope isolation, validation
and protocol behavior. Browser fixtures establish rendering without paid workers.
They do not establish native desktop placement, selected-mention delivery,
folder-picker interaction, or sandbox metadata delivery.

For changes in these areas, reload the MCP connection and verify the affected
flow on the target host, including two concurrent chats/projects. UI resource
HTML is read from `dist` on each request, so rebuilding UI can update it without a
service restart. Server changes require restart; changed discovery metadata or
resource URIs require MCP reload. Do not infer support from a product name or an
installed library version alone.
