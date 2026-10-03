# Host capabilities and integration decisions

Checked against official documentation and the installed packages on October 2, 2026. This distinguishes documented capabilities from behavior verified in this
repository; it is not a claim that every host/version implements every feature.

## Display modes and native extension surfaces

Rechecked October 2, 2026 against the official OpenAI developer documentation
and its linked OpenAI extension specification and SDK. In this project, the
target host is **Codex inside the ChatGPT desktop app**. The user has confirmed
that the thread-specific delegation panel is present and works there. This
confirms that surface in their installation, not every mode or bridge feature.

| Mode         | Presentation                                                      | Current documentation evidence                                                                                     |
| ------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `inline`     | A compact widget in the conversation                              | Listed by the developer reference and extension specification                                                      |
| `fullscreen` | An expanded app view; native entrypoints use this mode            | Listed by both sources; the mode name does not determine desktop pane geometry                                     |
| `pip`        | A persistent picture-in-picture widget alongside the conversation | Listed by the developer reference, UI guide and SDK, but explicitly excluded by the linked extension specification |

The [developer reference](https://developers.openai.com/plugins/reference#component-resource-_meta-fields)
lists all three as supported values of resource
`_meta["openai/ui"].availableDisplayModes`. Its
[presentation request example](https://developers.openai.com/plugins/reference#request-another-presentation-mode)
also describes requesting inline, picture-in-picture or fullscreen, with a
possible fullscreen fallback for PiP on mobile. The
[UI implementation guide](https://developers.openai.com/plugins/build/chatgpt-ui#picture-in-picture)
and [UI guidelines](https://developers.openai.com/plugins/concepts/ui-guidelines#picture-in-picture-pip)
describe PiP workflows. This is more than a value accepted by SDK types.

However, the linked
[extension specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#display-modes)
still explicitly limits ChatGPT to inline/fullscreen and excludes PiP. The
[SDK resource schema](https://github.com/openai/mcp-extensions/blob/main/typescript/src/server/ui.ts)
accepts all three, while tool `preferredModelDisplayMode` accepts only inline
and fullscreen. These sources conflict; neither a categorical claim that
ChatGPT cannot use PiP nor a guarantee that every ChatGPT/Codex installation
supports it is justified. No separate Codex mode-support matrix was found in
the checked developer pages. Do not invent a Codex exclusion from the ChatGPT
wording. Check the actual host's `availableDisplayModes` and returned mode when
requesting a change.

The current extension advertises and implements inline/fullscreen only. PiP is
not implemented or verified here. Its compact inline summary is part of the
extension's widget, distinct from the host's right pinned summary.

The [extension guide](https://developers.openai.com/plugins/build/extensions)
documents global/sidebar, thread/conversation and file entrypoints, settings,
composer mentions, forms and onboarding. The SDK additionally accepts a settings
entrypoint. None of the checked docs exposes a custom section or action in the
right pinned summary. Thread entrypoints and display-mode preferences cannot
request that placement. This is a documentation finding, not proof that an
undocumented or future host API cannot exist.

## Project and chat adapter update

The later [integration research](project-thread-integration-research.md) pins the
public Codex source to `c5d242fa` and the released `rust-v0.160.0`. That source
supplies `_meta.threadId` and supports opt-in `codex/sandbox-state-meta` through
server `capabilities.experimental`. Its `sandboxCwd` field is a file URI for the
execution directory. This is a concrete, optional version-specific adapter,
distinct from the portable MCP Apps context discussed below. The desktop UI is
closed source; public CLI/core/app-server code does not prove desktop behavior.

Both transports now advertise that capability and consume only the directory
hint, resolve its Git root and validate it against approved projects. Explicit
repository/task arguments take precedence; missing, remote, malformed or
unapproved hints fall back to explicit selection or same-chat history. A valid
unregistered local Git root is returned as an **Add chat project** suggestion;
showing or prefilling it never registers it. Leaving the chat with **All chats**
clears that suggestion while retaining the repository/revision filter. Optional
`threadId` is used after explicit conversation and documented `openai/session`
correlation. Permission metadata is neither retained nor treated as an access
grant. Native metadata delivery still needs a live target-host check.

The `app-v6` panel is attached to successful task creation as well as the opener,
with repository/revision/chat scope and immediate task selection on Activity.
The model-visible `open_codex_subagent_extension` advertises only the thread
entrypoint and accepts repository/revision/task ID. An owned task ID supplies
its own scope instead of ambient chat/directory metadata; explicit conflicts
still reject. Other launches preserve explicit or host chat context. The separate app-only `open_codex_subagent_extension_global`
advertises the global entrypoint and always opens all chats and all projects.
Unscoped panel bootstrap explicitly requests a null conversation; **All chats**
expands a scoped panel's chat filter while retaining repository/revision.
Task creation accepts `conversation_id: null` to opt out of host chat correlation
and normalizes it to an absent persisted Task conversation ID. The stdio opener
fetches resolved context from the service and requires its availability.
The context reader recovers only same-chat history defaults. Global history never
silently supplies a project. The project registry refreshes on polling and manual
refresh while preserving drafts and stable options. Panel HTML is read from
`dist` per resource request, so UI rebuilds can appear without a service restart.
Server code changes require a service restart; reload the MCP connection to
discover changed opener metadata and resource URIs. Inline model preference and
resource display modes are hints, not forced native placement.

## Plugin startup and hooks

Codex supports command-based lifecycle hooks, including `SessionStart`, and
plugin hooks are discovered from `hooks/hooks.json` or the OpenAI extension in
the root manifest. Users must review and trust plugin hooks. Scripts must exist
in the execution environment; installation on the web does not deploy them.
Plugin hook commands receive `PLUGIN_ROOT` and writable `PLUGIN_DATA` variables.
The portable package keeps `plugin.json`, `mcp.json`, and assets at its root.
[Official plugin packaging documentation](https://developers.openai.com/plugins/build/plugins).

Hook input contains `session_id` and session `cwd`. Commands run in that working
directory. This is a supported way for a future trusted hook to capture session
context, but a hook payload is not automatically supplied to an MCP tool. A
shared service needs an explicit session binding if it consumes this information;
one global “current repository” is insufficient for concurrent chats.
[Official hook input and execution documentation](https://learn.chatgpt.com/docs/hooks).

STDIO MCP configuration supplies a command, arguments, environment, and optional
launch `cwd`. That launches the configured executable, not a separately managed
HTTP service. Launch `cwd` is not documented as a per-tool-call project identifier.
Starting the local service from the packaged STDIO launcher is therefore an
application responsibility. Disconnecting a client should close its proxy
without terminating work owned by a shared service.
[Official MCP configuration documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Project context and registration

MCP Apps host context describes presentation, locale, device capabilities, and
the initiating tool; it does not standardize a repository path or Codex project
ID. Its fields are optional. The installed `@modelcontextprotocol/ext-apps`
1.7.5 `McpUiHostContext` likewise has no declared repository field, although it
permits additional properties. No documented, guaranteed per-call active-project
field was established by this review. Explicit project selection is the reliable
fallback, and an undocumented extra property must not become an access grant.
[Official MCP Apps host-context reference](https://apps.extensions.modelcontextprotocol.io/api/interfaces/types.McpUiHostContext.html).

Legacy MCP roots are optional: supporting clients declare the capability and
servers can request `roots/list`. The protocol does not mandate a project-picker
interaction or identify which root is active for a particular chat. A root list
is consequently not a replacement for explicit task project identity or the
service's own containment validation.
[MCP 2025-11-25 roots specification](https://modelcontextprotocol.io/specification/2025-11-25/client/roots).

Elicitation can collect a missing repository or an explicit approval, when the
connected client supports the requested mode. For legacy connections, an empty
elicitation capability means form support; absent capability does not. Servers
must not send unsupported modes, and user decline/cancel must be respected.
This allows a capability-gated registration flow; a model-supplied path alone
does not establish user consent.
[MCP elicitation specification](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation).

OpenAI recommends elicitation for missing structured information and explicitly
states that tool annotations do not replace server authorization or validation.
Registration should use a direct user action or accepted elicitation and retain
canonical-path containment checks for all subsequent task requests.
[Official MCP server guidance](https://developers.openai.com/plugins/build/mcp-server).

The panel now registers repositories through app-only user tools. **Add project**
accepts an absolute path or a native macOS folder selection followed by explicit
submission. **Browse…** beside the New task Project selector registers the chosen
repository immediately, selects it for that draft, and leaves task creation to
**Start task**. The native dialog opens on the service host, and other platforms
can use the Add project path field. MCP hosts must enforce app-only tool visibility;
the generic model-facing API rejects these user tools. Registration retains
canonical Git-root validation and does not grant parent or nested-repository access.
The native script has been compiled and its result/error paths tested with an
injected executor; interactive dialog behavior and target-host delivery remain
unverified.

The model-visible, read-only `get_current_agent_project` reports the current root
and whether it is registered, using only original host `_meta["codex/sandbox-state-meta"].sandboxCwd`.
`request_agent_project` asks the user to confirm registration, optionally prefilling
an explicit repository or that host root. Its decision defaults to deny; only an
accepted allow registers the canonical Git root. HTTP uses durable Multi Round-Trip
Requests; stdio uses legacy SDK form elicitation when the host advertises support.
Unsupported hosts receive guidance to register through the panel. Cancellation and
decline never register or start work.

**Automatically add chat projects** (`auto_register_chat_project`) is a persistent,
user-only setting available in native and panel Settings, defaulting to true.
It registers the current local host Git root only when a task is started from the
chat for that root; project listing, context resolution and the panel openers
remain read-only. Explicit/model `host_directory` and task paths cannot trigger
this grant, and roots already covered by a grant are not registered again. The
panel's New task offers the unregistered chat project only while the setting is
on, and adds it when the user starts a task with it.
Disabling the policy keeps existing registrations. These implemented flows do not
establish live desktop metadata delivery or native form rendering.

## Recent releases and compatibility

The July 28, 2026 MCP release introduces stateless per-request capabilities,
Multi Round-Trip Requests for user input, and explicit application handles.
Roots, Sampling, and Logging are deprecated with at least twelve months of
continued support. New code should not depend on roots being a future universal
project-context API. Installed legacy SDK behavior and modern v2 behavior must
be assessed separately; the published latest protocol does not prove a host
negotiates it.
[Official MCP release announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28/).

OpenAI's May 28, 2026 plugin update added host style variables and host-context
theme notifications; May 27 updated approved-tool input delivery. These are
UI capabilities, not a documented repository binding.
[Official plugin UI changelog](https://developers.openai.com/plugins/changelog).

The current OpenAI changelog includes CLI 0.160.0 on October 1, 2026, and the
May 8 desktop 26.506 release added hook trust review. Published release notes
establish that hooks and elicitation are evolving capabilities, but do not
verify which runtime a particular installed desktop app uses. Use handshake
capabilities and direct integration tests rather than product-name assumptions.
[Official ChatGPT and Codex changelog](https://learn.chatgpt.com/docs/changelog).

## Claude task continuity

The installed Claude SDK declares `cwd` (defaulting to process cwd), `resume`
(a specific session ID), and `continue` (the most recent conversation in the
directory). `src/providers/claude.ts` explicitly passes the task workspace as
`cwd` and its saved session ID as `resume`. Preserve both across continuation;
selecting another project for a new task must not change an existing task's
repository or workspace.

Current official sessions guidance says history does not persist filesystem
state, and cross-directory lookup was introduced in Claude Code 2.1.223.
The installed SDK bundles 2.1.141, so that newer lookup guarantee cannot be
assumed here. Resume also requires locally available session data. Using
`continue: true` in a concurrent service risks selecting a different session;
explicit IDs and stable workspaces avoid that ambiguity.
[Official Claude Agent SDK sessions documentation](https://code.claude.com/docs/en/agent-sdk/sessions).

Installed package evidence (`npm ls --depth=0`, package manifests and types):

| Component             | Installed version | Relevant evidence                                        |
| --------------------- | ----------------- | -------------------------------------------------------- |
| Claude Agent SDK      | 0.3.288           | `sdk.d.ts` options; bundled manifest CLI 2.1.288         |
| MCP SDK v1            | 1.31.0            | `types.js` latest supported handshake version 2025-11-25 |
| MCP server / node v2  | 2.2.0 / 2.1.0     | Modern 2026-07-28 codec alongside legacy support         |
| MCP Apps              | 1.7.5             | `spec.types.d.ts` host context lacks repository identity |
| OpenAI SDK            | 7.25.0            | Installed dependency, not a Codex host-context API       |
| OpenAI MCP extensions | 0.1.0             | Installed extension dependency                           |

These observations verify local library contracts, not a live desktop handshake,
hook trust state, or access to another host's filesystem. A local plugin cannot
make its service available to an unrelated cloud machine merely by installing
the package.

## Review corrections

The native settings contract requires a read-tool output schema and scalar
setting fields. Native settings now expose a boolean `use_cost_budget` plus a
numeric amount, translated to nullable internal task budgets. Both transports
advertise read/update output schemas. Settings schema checks must inspect field
definitions as well as the envelope: the SDK's raw read-result parser intentionally
does not validate native field schemas. See the [official extension specification
linked by OpenAI](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#structured-settings)
and [OpenAI extension documentation](https://developers.openai.com/plugins/build/extensions).

`_meta["openai/session"]` is a documented optional anonymized conversation
identifier. Both transports now use it for panel/task/list correlation when no
explicit conversation ID is supplied. It is not a repository ID or an authorization
claim. Metadata absence still works; no active-project access is inferred from it.
[Official plugin UI reference](https://developers.openai.com/plugins/reference).

Portable skills are discovered from the root `skills/` directory, which is now
included in the distributable package. Registry installs do not execute package
lifecycle scripts, so compiled assets and production dependencies must already
be present in the archive. Public publication additionally needs an approved
endpoint and complete submission metadata/assets; local package validation and
protocol tests do not establish universal-directory eligibility.
[Official packaging documentation](https://developers.openai.com/plugins/build/plugins),
[submission requirements](https://developers.openai.com/plugins/deploy/submission).
