# Project and thread integration research

Research date: October 2, 2026. This report covers official OpenAI documentation,
the public Codex implementation, and installed SDK types. It separates public
contracts, source-backed optional adapters, and behavior requiring a live host
check. It is not an exhaustive archive of every historical OpenAI page.

The Codex desktop UI is not open source. The public repository establishes
CLI/core, SDK and app-server behavior. Its types and metadata paths are evidence
for optional integration adapters, not proof of desktop panel routing, currently
focused chat access, or the installed desktop runtime version.

## Recommended direction

Make project, conversation, selected delegated task, and revision explicit
application state. Return that state when opening the panel and starting a task.
Resolve defaults on the server using the authenticated owner, approved project
registry, explicit arguments, and the latest task in the same conversation.
Keep the chosen task visible while it starts and show Activity until a result is
available. New task should inherit that resolved project and revision.

Add optional Codex metadata adapters when the host supplies them. A conversation
identifier can correlate requests; an optional working-directory hint can help
select an already approved project. Neither grants access or registers projects.
The result is useful without any host-specific field and gets smoother as the
host exposes more context.

The physical panel location belongs to the host. Use its thread entrypoint and
native opening helpers when available, preserve portable MCP Apps rendering,
and verify the actual desktop layout. A display-mode label alone is insufficient
evidence that chat remains visible beside the app.

## Current and legacy documentation

The old [Apps SDK UI guide](https://developers.openai.com/apps-sdk/build/chatgpt-ui)
and [Apps SDK reference](https://developers.openai.com/apps-sdk/reference) now
redirect to the plugin documentation. They are compatibility routes, not
independent archived snapshots.

The current [UI implementation guide](https://developers.openai.com/plugins/build/chatgpt-ui)
recommends `_meta.ui.resourceUri`, the MCP Apps JSON-RPC bridge, tool input/result
notifications, `tools/call`, and `ui/message`. `window.openai` remains an optional
compatibility layer. Feature detection is preferred to host-name branching.
The existing portable panel is a sound foundation; replacing its bridge with a
ChatGPT-only integration would not create a project-context contract.

The [plugin UI changelog](https://developers.openai.com/plugins/changelog)
records migration details: server instructions became model guidance in May
2026; legacy `openai/visibility` was deprecated in July in favor of
`ui.visibility`. UI discovery, rendering, and model guidance should remain
separate from authorization.

The [extension overview](https://developers.openai.com/plugins/build/extensions)
describes sidebar apps, conversation panels, settings, file handlers, deep links,
and model/app context. It links to the public extension specification and SDK.
The page primarily documents ChatGPT surfaces; installed desktop support still
needs observation for individual capabilities. The target here is Codex inside
the ChatGPT desktop app, where the user has confirmed the thread panel works.
Do not treat ChatGPT documentation as automatically excluding that Codex surface.

## What the UI extensions actually expose

The [extension specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md)
establishes these boundaries:

| Surface           | Supported behavior                                                                         | Consequence                                                              |
| ----------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Global entrypoint | Accepts `{}`; opens the global app                                                         | Sidebar navigation is not an active-repository argument                  |
| Thread entrypoint | Accepts `{}`; separate app instance per thread                                             | Adjacent conversation tab is supported; automatic repo arguments are not |
| Model context     | `openai/modelContext` restores the app's attached context                                  | It is not access to conversation history or host project metadata        |
| Deep link         | Global entrypoint URL with encoded app-relative `path`; delivered as `openai/deepLink.url` | Useful for a task route; no specified adjacent-thread deep link          |
| Messages          | Optional `openai/message.target` is `active` or `new`; send is immediate                   | It does not specify cwd, project, title, or a returned native thread ID  |
| Display mode      | Entry points use fullscreen; resource preference is a hint                                 | Check physical placement on the target desktop                           |

These imply that task selection must be our own data contract. Do not interpret
model context as a transcript API or pass a global last-used project into every
thread. Avoid using `target: new` as a substitute for creating a delegated task:
that launches a host conversation and cannot describe the worker's workspace.

The installed `@openai/mcp-extensions` **0.1.0** matches these
[public SDK schema definitions](https://github.com/openai/mcp-extensions/blob/main/typescript/src/server/ui.ts):

- Tool `_meta["openai/ui"].entrypoints` accepts `global`, `thread`, `file`,
  and `settings`. A global entrypoint can include a `quickAction` with
  `title`, `icons`, and a `target` containing `type: "tool"`, `name`, and
  optional `arguments`.
- Tool `preferredModelDisplayMode` accepts `inline` or `fullscreen`.
- Resource `preferredDisplayMode` and `availableDisplayModes` accept
  `inline`, `fullscreen`, and `pip` in the SDK. The current developer reference
  explicitly lists all three and describes requesting PiP, while the linked
  extension specification explicitly excludes PiP in ChatGPT. This is a current
  source conflict, not an established difference between Codex and ChatGPT or
  proof that PiP is unavailable. Check actual host capabilities and the returned
  mode. See the [display-mode evidence](host-capabilities.md#display-modes-and-native-extension-surfaces).

Local evidence: `node_modules/@openai/mcp-extensions/dist/server/ui.d.ts` and
`dist/app/model-context.d.ts`. A global quick action has static arguments; it
cannot manufacture the active thread's directory. Prefer a quick action that
opens a prefilled draft without executing work.

Installed `@modelcontextprotocol/ext-apps` **1.7.5** declares presentation
context such as `toolInfo`, `theme`, `styles`, `displayMode`,
`availableDisplayModes`, `containerDimensions`, locale, timezone, device
capabilities, and safe-area insets. Its `McpUiHostContext` permits extra keys but
does not declare a current repository, project ID, or conversation ID.
Evidence: `node_modules/@modelcontextprotocol/ext-apps/dist/src/spec.types.d.ts`.
An extensible index signature is not a promise of undocumented project fields.

## Concrete Codex repository evidence

Public Codex `main` was pinned during this review to
[`c5d242fa7907bff1b7a7e26e95febc548c0a6963`](https://github.com/openai/codex/commit/c5d242fa7907bff1b7a7e26e95febc548c0a6963),
committer time **2026-10-02 18:48:49 UTC**. The released `rust-v0.160.0`
tag was also inspected. A newer source tree does not prove the installed
desktop uses that core version.

### Conversation correlation

In [`core/src/mcp_tool_call.rs`](https://github.com/openai/codex/blob/c5d242fa7907bff1b7a7e26e95febc548c0a6963/codex-rs/core/src/mcp_tool_call.rs),
`with_mcp_tool_call_ids_meta` supplies request `_meta.threadId` and
`_meta.sessionId`, plus `windowId` and `itemId` when available.
`build_mcp_tool_call_request_meta` supplies `callId`. The executed MCP path
uses these helpers without a desktop-name restriction. The same file parses
`openai/ui.preferredModelDisplayMode` into `McpAppUi` and accepts standard
`ui.resourceUri` before compatibility aliases.

The [documented client metadata](https://developers.openai.com/plugins/reference)
additionally includes `_meta["openai/session"]`, an anonymized ChatGPT
conversation identifier. These IDs have different semantics. Prefer an
explicit conversation argument, then the documented session hint, then an
optional source-backed Codex `threadId` adapter. Do not equate `sessionId`
with `threadId`: Codex session trees can contain multiple threads.

This is stronger evidence than the older repository documentation's statement
that no conversation correlation was established. It remains optional metadata,
not an ownership claim or a current-project grant.

### Optional working-directory hint

The pinned
[`codex-mcp/src/rmcp_client.rs`](https://github.com/openai/codex/blob/c5d242fa7907bff1b7a7e26e95febc548c0a6963/codex-rs/codex-mcp/src/rmcp_client.rs)
defines **`codex/sandbox-state-meta`** and detects its presence in the
server initialization response's `capabilities.experimental`. The checked
client does not read this key from `capabilities.extensions`. No protocol-date
condition is imposed by that check. New-protocol capability placement should
therefore be tested rather than inferred from unrelated extensions.

[`codex-mcp/src/runtime.rs`](https://github.com/openai/codex/blob/c5d242fa7907bff1b7a7e26e95febc548c0a6963/codex-rs/codex-mcp/src/runtime.rs)
serializes `SandboxState` with camelCase fields: `sandboxCwd`,
`permissionProfile`, `codexLinuxSandboxExe`, `useLegacyLandlock`, and
`useMxc`. Read only the cwd if using this adapter; permission state is not
needed for project defaults.

The core's `augment_mcp_tool_request_meta_with_sandbox_state` only attaches
this payload when advertised. Its cwd comes from the MCP server's captured
environment or turn environment; it need not be a Git root or local to the
service. The
[sandbox integration test](https://github.com/openai/codex/blob/c5d242fa7907bff1b7a7e26e95febc548c0a6963/codex-rs/core/tests/suite/mcp_sandbox_tests.rs)
advertises the capability under `experimental` with protocol `2025-11-25`
and proves sandbox cwd differs from the server process's cwd.

[`PathUri`](https://github.com/openai/codex/blob/c5d242fa7907bff1b7a7e26e95febc548c0a6963/codex-rs/utils/path-uri/src/lib.rs)
serializes as a canonical `file:` URI, including cross-platform paths and
opaque fallback representations. Thus `sandboxCwd` is not a raw absolute
path in this pinned version.

A narrow adapter is a real option: advertise the capability, accept a supported
local file URI, canonicalize it, map it to an approved registered repository,
and preserve all existing `Projects.resolve` checks. Reject unsupported foreign
or opaque URIs and fall back when unavailable. A subdirectory may need a
validated Git-root resolution; passing it directly into the current resolver
is insufficient. The adapter must never consume permission fields as access
grants, auto-register paths, or overwrite explicit user context. Live validation
must cover both HTTP and stdio, entrypoint calls, and UI-originated calls.

## Real options and tradeoffs

These options are engineering recommendations based on the evidence above.

| Option                      | What it can deliver                                                     | Remaining cost or limit                                                      |
| --------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Explicit MCP panel context  | Exact project/revision/task selection from a model or user action       | First use needs context supplied by the host model or user                   |
| Same-chat task defaults     | New task prefilled from the latest owned task in that conversation      | First task has no history; task history is not the host's active repo        |
| Codex metadata adapters     | Thread correlation and optional approved cwd mapping                    | Version-dependent; widget calls and static entrypoints need live proof       |
| Trusted lifecycle hook      | A session/call-scoped cwd registration channel                          | Requires trust, secure explicit correlation, concurrency and expiry handling |
| Native browser panel helper | Guaranteed requested right-side placement through host tooling          | Browser app uses standalone transport; authentication cannot appear in URL   |
| Global app deep links       | Reopen a specific delegated task                                        | Global navigation may move away from the main chat                           |
| Own app-server client UI    | Complete control over project selection, thread creation, and streaming | A larger product; does not grant control over native desktop window state    |

### Trusted hooks

The [official hooks guide](https://learn.chatgpt.com/docs/hooks) documents
`session_id`, `cwd`, and optional transcript path in hook input. Tool hooks add
`tool_use_id` and tool arguments. Non-managed hooks require review and trust.
Transcript format is explicitly unstable.

A future plugin hook can publish a minimal owner/session/call/cwd record to the
service. Resolve it only through the matching request metadata or an explicit
binding. `SessionStart` alone cannot reliably mean 'the chat currently visible
in a particular window'; concurrent chats and subagents make one global current
cwd unsafe. Do not scrape desktop databases or transcripts to infer focus.

### Native browser helper through a skill

The host tool available in this session, `open_in_codex`, can open a browser URL
with `placement: "right"`; its default target is the calling chat/window.
This is local tool-schema evidence, not an API exported to arbitrary MCP apps.
A plugin skill can instruct the host model to start a task, obtain a safe panel
URL or one-time handoff, and call that helper. A tool's `resourceUri` does not
itself confer access to `open_in_codex`.

The standalone console already exists, so this is a practical optional route.
Carry repository/task identifiers in a validated route; keep bearer credentials
out of query strings, fragments, model-visible messages, and logs. Preserve the
embedded bridge route for hosts without native panel-opening tools. Do not
replace the active user's chat with a global deep link merely to select a task.

### Own app-server UI

The [Codex app-server guide](https://learn.chatgpt.com/docs/app-server)
documents `thread/start` with `cwd`, `thread/read`, thread listing, turn start,
and streaming notifications. Read does not subscribe; starting/resuming and
reading have different lifecycle effects. Generate schemas from the actual CLI
version when building a client. TCP WebSocket transport is experimental.

The pinned
[`Thread` type](https://github.com/openai/codex/blob/c5d242fa7907bff1b7a7e26e95febc548c0a6963/codex-rs/app-server-protocol/schema/typescript/v2/Thread.ts)
contains `id`, `sessionId`, `projectId`, `cwd`, `name`, `status`, `gitInfo`,
`parentThreadId`, and `forkedFromId`. The pinned
[`ThreadListParams`](https://github.com/openai/codex/blob/c5d242fa7907bff1b7a7e26e95febc548c0a6963/codex-rs/app-server-protocol/schema/typescript/v2/ThreadListParams.ts)
supports an exact cwd filter. These enable a tightly integrated custom client.
They do not establish an iframe method to read whichever desktop chat is focused
or a native UI placement API. Connecting to a different app-server process is
also not proof of access to the desktop's loaded threads.

## UI defaults and cohesion

The [official UI guidelines](https://developers.openai.com/plugins/concepts/ui-guidelines)
favor small inline actions, discourage deep navigation and nested scrolling in
inline cards, and reserve larger surfaces for detailed workflows. They recommend
system colors/fonts/spacing and accessibility. Those principles support a compact
status summary in chat and a full inspector beside it.

Recommended product behavior:

1. Display the resolved project name/path and conversation scope in a persistent
   context strip. Make All projects and All conversations explicit options.
2. Prefill new tasks from explicit launch context, then same-chat task history;
   use an optional validated host cwd hint when present. Explain the source of a
   fallback when useful. Never silently choose the first approved project.
3. A successful start should return the queued task immediately, select it,
   reveal Activity, and preserve its ID across the initial tool result and
   subsequent polling. Existing result/artifact tools should remain headless.
4. Auto-select newly arriving work only in a known narrow scope and while the
   user has not deliberately selected another task. Refreshes must not switch
   project, reset filters, dismiss drafts, or erase form edits.
5. Selecting a task should update optional model context with task/project IDs,
   repository/revision, and status. It must not automatically send a prompt or
   apply a patch. Clear context deliberately when selection ends.
6. Use host theme/style variables and supported display modes. At narrow widths,
   prioritize a single inspector with a compact task picker. Preserve keyboard
   navigation, focus return, scroll state, and live status announcements.
7. Worktree path and source repository are separate facts. Reviewer tasks start
   from a committed revision under the current implementation. 'Review my work'
   must identify the intended diff or provide context/artifacts for uncommitted
   changes; prefilling a directory cannot transfer unsaved changes by itself.

## Acceptance evidence needed

Automated checks should exercise owner isolation, malformed and missing metadata,
explicit-context precedence, approved project validation, same-chat defaults,
unknown task IDs, start-result scope, and transport parity. Browser checks should
cover new-task prefill, selected task/activity, narrow and wide layouts, draft
preservation during polling, and scope-switch races.

Native host verification remains a separate gate: reload the plugin, invoke
'ask Claude to review my work', observe placement, confirm delivered correlation
and optional cwd metadata, check task auto-selection and activity, switch between
two projects/chats, and verify retention on reopening. Source/type checks do not
prove native placement, permission prompts, model-context delivery, or streaming
behavior on the installed desktop.

## Historical app-v5 implementation result

The original app-v5 implementation followed the recommended portable path and added
the source-backed optional metadata adapters. Context is validated on the server;
only same-chat owned history supplies defaults. Task creation returns a panel
selection on Activity, New task prefills context and user defaults, project/chat
indicators remain visible at narrow widths, and delayed reads/mutations cannot
select work in a new scope. New-task dependency choices follow its project.

That app-v5 verification passed 155 tests; its final UI refinement passed 11 tests,
with typecheck/build/whitespace checks passing. Browser fixtures verified narrow
light and wide dark rendering. The desktop UI remains closed source and native
placement/metadata delivery remain unverified. The running service was not
restarted. See [panel verification and activation](codex-panel.md) for the exact
operational boundary.

Current app-v6 uses separate global/thread openers. An explicit owned task ID
supplies its own scope rather than ambient metadata, task creation accepts a
null conversation opt-out, and project registration is refreshed while preserving
drafts. The stdio opener obtains context from the service. See the
[panel project and chat integration](codex-panel.md#project-and-chat-integration)
for behavior and activation details; the counts above are historical.
