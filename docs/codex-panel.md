# Embedded Codex delegation panel

Original panel implemented October 2, 2026 in an isolated worktree, then applied to the primary repository. The original verification built the primary checkout and passed its 109 tests; that result is historical. This Codex-oriented MCP App still awaits visual and interaction verification in the installed host. The running service was not restarted; configuration and durable task data were not changed. No live workers were started for this verification.

The current shared frontend architecture is documented in [React UI architecture](react-ui.md).

## Project and chat integration update

The `app-v6` resource is returned by task creation and both openers. Task
creation preserves `structuredContent.result` and adds `panel_scope`,
`panel_selection` and initial `tasks`, so a model-created task appears selected
on Activity immediately, including in narrow panels. The opener accepts
repository, revision and owned task ID. A selected owned task supplies its own
scope instead of ambient chat/directory metadata. Explicit conflicting
task/chat/repository/revision arguments are rejected.

Task creation accepts `conversation_id: null` to opt out of host chat
correlation; the persisted Task stores an absent conversation ID.

Both transports expose `get_agent_panel_context`. The stdio opener fetches
resolved context from the service, so opening requires service availability. It prefers explicit context,
then validated optional Codex directory metadata, then the latest owned task in
the same conversation. New task defaults additionally use an intentional task
selection or the only registered repository. User worker/budget preferences are
preserved. Approved-parent setups accept an absolute child repository. Task
creation still validates containment and starts from a committed revision.

The top project selector and chat indicator remain visible beside the inspector.
Global launches use an app-only opener that explicitly requests all conversations
and no repository default. Unscoped widget startup also sends an explicit null
conversation, preventing ambient host chat/directory metadata from hiding task
history. Chat launches retain their scope and offer an **All chats** button that
keeps the selected project and revision while expanding the conversation scope.
The project registry refreshes on polling and manual refresh, preserving drafts
and stable selector options. Project filtering also restricts default dependencies. Scope changes invalidate
in-flight reads, clear old evidence and close unsent forms. A mutation already
sent cannot be retracted; its late response does not select work into a new scope.
Selection context includes repository, revision, task and conversation and is
shared only when the host advertises it. No automatic chat message is sent.

The source-backed adapter advertises `codex/sandbox-state-meta` and reads only
its local `sandboxCwd` file URI, resolves a Git root and validates registration.
Explicit repository/task data wins. Missing/unapproved/remote hints fall back.
`threadId` correlation follows explicit arguments and `openai/session`.
The desktop UI is closed source; CLI/core/app-server evidence is not a claim
that the desktop delivers these fields. See the
[research report](project-thread-integration-research.md) and
[implementation plan](project-thread-integration-plan.md).

Tools prefer inline model presentation; the resource declares inline/fullscreen.
The thread entrypoint is the supported adjacent-chat affordance, while the host
owns physical placement. No automatic fullscreen request is made. Native
placement, entrypoint directory metadata, and authenticated live widget behavior
still require loading the rebuilt connection in the target desktop. Restarting
a service with active work needs operational care; this work does not restart it.

Fixture browser checks covered 440px light and 1040px dark layouts, project path
visibility and new-task project/revision/worker prefills with task-field focus.
No browser console warnings/errors were observed. These are preview checks,
not native-host proof. [Narrow preview](images/project-thread-panel-narrow.png)
and [wide preview](images/project-thread-panel-wide.png) are saved evidence.

The earlier implementation/verification notes below describe prior versions.
The final validation result for this update is recorded at the end of this file.

## Activity timeline

Claude activity preserves every SDK response, including content blocks, streaming events, system updates, hooks, background tasks, rate limits, and unknown future variants. The chronological timeline combines tool starts, progress and results into one row, groups hook and background-task lifecycles by their IDs, assembles streamed responses, and collapses adjacent routine status updates. Messages and failure reasons remain visible; cancelled and stopped operations are distinguished from successful completion. The current-status line uses authoritative task state and distinguishes working, waiting, idle, and failed provider updates.

A small debug icon beside each row’s timestamp opens individual events with readable content, labeled metadata, and a **Raw response** inspector for the original SDK message. Debug controls support keyboard navigation and announce their expanded state. Event details mount on first use and stay mounted to preserve open inspectors through refreshes and closing/reopening the debug panel. Raw JSON renders only when its own inspector is open. Thinking has a separate disclosure; supported inline images render in place, while encoded payloads remain available in raw JSON.

The panel retains the most recent 200 events; full stored history is available through `get_agent_events`. Open inspectors persist while their timeline row remains in the retained tail. Older stored events expose their saved data; messages discarded by the previous adapter cannot be recovered.

## Historical app-v4 implementation

These notes describe the earlier app-v4 implementation and its checks. For
current scope inference, transport behavior and host gates, use the update above
and the final verification below.

### Design

The panel complements the Codex conversation with a compact task rail and inspector. Neutral colors, system typography, restrained borders, dense controls and host theme variables keep it visually quiet. Narrow panels show either the task list or selected task, with a back action. It uses a native modal dialog for focus containment and Escape dismissal.

The rail offers search and All / Active / Needs input / Done filters. Tasks needing input are selected first on wide panels. The inspector shows the worker, status, revision and budgets, then Result / Artifacts / Activity. Session identity, workspace path, dependencies and usage live under Task details. Full patch contents remain inspectable; the panel never applies changes.

New task reads the existing user defaults, discovers available workers, and lets the user explicitly supply context, revision, dependencies, runtime and cost limits. Conversation context is not automatically attached. Unsupported numeric cost budgets block submission. Claude's response-boundary cost semantics are disclosed. Defaults are read without modifying persisted settings.

Forms retain the conversation scope in which they opened. Changing scope clears the previous task view and closes unsent forms. A request already in flight cannot be retracted; its response does not select a task into the new scope, and the form asks the user to inspect its original outcome before retrying. Only the opener's explicit `panel_scope` result changes conversation scope; unrelated tool results are ignored.

Steering explains that it interrupts a running turn. Interrupt, cancel and new attempt describe their effects before submission. Permission requests show the complete payload and default to deny. Questions support choices, multiple selections and custom responses. Replies retain the exact request ID; the service remains responsible for rejecting stale input. Unconfirmed termination locks execution controls. Mutations are never automatically retried.

Bring to Codex prepares an editable, bounded message referencing the task and tools for full evidence. Message delivery is offered only when the host advertises text messages. Otherwise the message can be selected and copied manually. A declined delivery stays visible in the dialog. Selecting tasks or artifacts shares IDs only when structured model context is advertised; it does not trigger a follow-up automatically.

Optional context sharing runs separately from inspection: rejection or slow host delivery does not prevent opening an artifact. Expand and Collapse appear only when the respective target mode is advertised. Evidence tabs support arrow keys, Home and End. Closing a dialog returns focus to its replacement control if polling rebuilt the inspector.

### Transport and files

- `ui/codex.html`, `ui/codex.ts`: separate embedded panel shell and controller.
- `ui/codex-fixtures.ts`: synthetic design preview states; no service connection or worker execution. `?preview=1` works only at the top level; `&theme=dark` selects the dark preview.
- `scripts/build-ui.mjs`: builds both `dist/console.html` and self-contained `dist/codex.html`; checks the embedded JavaScript parses. No external UI assets or new packages.
- `src/stdio.ts`: adds `open_codex_subagent_extension` and `ui://codex-subagent-extension/app-v4` to the existing loopback proxy. It serves this checkout's built panel without exposing a token or creating another service. Existing tool names and envelopes are retained.
- `src/panel.ts`: shares the opener schemas, annotations, global/thread entrypoints, scope result, and panel resource definitions between HTTP and stdio. The original HTTP opener optionally included initial owner-scoped tasks; the original stdio opener was independent of service availability. Current app-v6 stdio openers fetch context from the service. Both advertise task tools for model and app use.
- `src/app.ts`, `src/main.ts`: keep the web console on its current routes; use the separate panel for the HTTP MCP resource. The optional panel path retains compatibility for existing callers of `application`.
- `src/mcp.ts`: retains the HTTP opener and existing metadata, adds read-only annotations/output schema, and describes the embedded resource. The new HTTP resource uses `app-v4` so hosts refresh its cached metadata. The panel does not consume compatibility bootstrap metadata.
- `package.json`: includes the new controller in UI typechecking.

All panel reads and writes use the portable MCP Apps bridge. No direct fetch, cookie, SSE, credential entry, provider API or public endpoint is required in the panel. The stdio resource permits no external connections/assets. It polls through the bridge every five seconds while visible and not submitting. Unchanged details are not rerendered, open forms survive polling, and detail disclosure/focus/artifact scroll positions are retained. Activity uses cursor paging and displays the most recent 200 events; full history remains available through `get_agent_events`.

The official [UI documentation](https://developers.openai.com/plugins/build/chatgpt-ui) and [metadata reference](https://developers.openai.com/plugins/reference) informed the portable resource/bridge approach. ChatGPT's `window.openai`, global/thread entrypoints, rich forms and settings surfaces are not treated as Codex contracts.

### Load later without replacing the active service

Build this checkout with the lockfile dependencies installed. A separately configured MCP connection can run its `dist/stdio.js`, with `CODEX_SUBAGENT_EXTENSION_DATA` pointing to the existing service data directory and `CODEX_SUBAGENT_EXTENSION_URL` pointing to its existing loopback origin. The proxy reads the token locally and forwards only requested tools; it does not acquire the service lease or alter the database directly. The HTTP panel instead calls tools through the already-authenticated host MCP bridge. No MCP configuration change was made when applying the panel to the primary repository.

After explicitly choosing to load that connection, ask Codex to call `open_codex_subagent_extension`. Expand the returned app into Codex's side panel for native inspection: the MCP Apps inspector cannot access apps shown only inline. Pass `conversation_id` only if its actual value is known; otherwise the panel labels its scope All conversations. Do not infer a thread ID from undocumented host fields. The existing connection continues loading its configured checkout until configuration is deliberately changed. This original verification did not restart the service. Current panel HTML is read from `dist` on each resource request, so rebuilt UI changes can load without a restart; server code changes require restarting the service.

Reload the stdio MCP connection after building to discover the separate global/thread openers and the updated resource URI. The host controls launch placement. A thread entrypoint is intended for opening beside a conversation; the global entrypoint opens all projects and conversations in the sidebar app view. Chat-scoped launches still use explicit or host-supplied conversation correlation.

The built HTML also has a fixture-only design preview for a browser that supports local files. The in-app Browser declined the file URL in this session. No alternate exposure/server was used to bypass that restriction, so visual rendering was not verified.

### Verification and open host gates

`npm run typecheck`, `npm run build` and `git diff --check` passed in the implementation worktree. Primary-repository typecheck passed after applying the changes. Its production build was not run because it would replace `dist` files used by the running service. Dependencies were temporarily read from the existing checkout using a local symlink, without installing or modifying its dependency tree; the symlink was removed afterward. No tests were added or run, no service was started or restarted, no credentials were printed, and no commit was created. These are build/source checks, not transport or native-host proof. The earlier 101-test result is historical.

Subsequent in-place verification passed `npm run typecheck`, `npm run build`, `git diff --check` and all 109 existing tests. The tests needed local socket access outside the filesystem sandbox. The installed stdio opener returned its expected unscoped `panel_scope`, and worker discovery succeeded through the installed connection. Neither response proves native rendering. The native MCP Apps inspector was available but had no expanded app to inspect. Browser state races and native interactions remain unverified.

`tests/http.test.ts` now also verifies the HTTP and stdio `app-v4` resource URI, panel HTML and empty CSP, retention of the standalone console, explicit/null conversation scope, and HTTP task filtering by conversation and owner. All four focused HTTP tests passed after these additions. This exercises actual MCP clients and fixture data without starting live workers.

After consolidating the panel definitions in `src/panel.ts`, typechecking, build and all 109 tests passed again. Transport checks compare opener descriptions, annotations, entrypoints, input/output schema structure, and complete resource contents. The SDKs emit different JSON Schema draft identifiers, so that comparison excludes only the root `$schema` URI. Tests also verify stdio task-tool visibility and close the proxy on assertion failures. Native placement after discovering the new stdio entrypoints still requires reloading the connection and observing the host.

Still unverified in the installed Codex host: rendering the new resource from stdio; bridge tool calls/authorization; host theme delivery; actual conversation scoping; model context reception; message delivery/rejection; fullscreen behavior; panel retention on reload/fullscreen changes. Global/thread entrypoints, native rich forms, native settings and host notifications remain separate unsupported/unverified assumptions. Existing HTTP features and headless tools remain available; no new Codex-specific host API or notification channel was added. Stage A was not repeated and Stage B was skipped.

## Final verification of project and chat integration

Typecheck, production build and `git diff --check` passed. The full suite passed
155/155 tests using `node --import tsx --test tests/*.test.ts`; loopback fixture
transports and local subprocess tests ran with the required sandbox escalation.
After the final dependency-picker refinement, typecheck/build and all 11 panel
UI tests passed again. Tests exercise actual HTTP/stdio clients and the real UI
controller, with fixture workers and temporary Git repositories. No paid model
worker was launched. No commit, service restart, project registration or MCP
configuration change was made by the implementation work.

The subsequent improvement review fixed polling after narrow-panel Back,
defaults after a selected task disappears, launch filter pressed states and
project-option stability during polling. The harness now uses the actual panel
HTML shell, including its filters. All 159 tests passed after these changes,
alongside typecheck, production build and whitespace checks. The 15 panel UI
tests include regression coverage for each fix. Native desktop behavior remains
subject to the host checks below.

The fixture preview server and temporary browser tab were closed after checks.
The saved preview images show light/narrow and dark/wide layouts; viewport
overrides were reset. This is visual and protocol proof, not native desktop proof.

To activate server code changes, restart the configured delegation service with
this build. Panel HTML is read from `dist` on each resource request and can
reflect UI rebuilds without a restart. Reload the MCP connection to discover
changed opener metadata and resource URIs (or refresh the installed plugin build
if it points elsewhere).
The host should then discover app-v6, the separate global opener, the context reader, task-creation UI and
optional sandbox metadata capability. The existing running service keeps its
loaded code until restarted.

A read-only native smoke check can open the panel with an approved repository,
verify the project/chat indicator and New task prefills without submitting, then
reopen an existing owned task by ID. Check actual adjacent placement and whether
the host sends thread/directory metadata. Do not interpret the passing transport
tests as confirmation of these closed-source desktop behaviors.

## Latest improvement review

The current app-v6 review corrected explicit task selection so ambient chat or
directory metadata cannot redirect it, and preserved the explicit null chat
opt-out for task creation while normalizing persisted task data. The panel now
refreshes registered projects during polling and manual refresh without losing
drafts or rebuilding unchanged selector options. Transport and UI regressions
cover these behaviors. Final validation passed all 164 tests, including 19 panel
UI tests and the HTTP/stdio transport checks, plus typecheck, production build,
Prettier checks on changed code and `git diff --check`. The counts above describe
earlier verification runs. Native placement and metadata delivery remain subject
to the host checks described above.
