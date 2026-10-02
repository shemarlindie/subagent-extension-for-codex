# Embedded Codex delegation panel

Implemented October 2, 2026 in an isolated worktree, then applied to the primary repository. The primary checkout has now been built and its 109 existing tests pass. This Codex-oriented MCP App still awaits visual and interaction verification in the installed host. The running service was not restarted; configuration and durable task data were not changed. No live workers were started for this verification.

## Design

The panel complements the Codex conversation with a compact task rail and inspector. Neutral colors, system typography, restrained borders, dense controls and host theme variables keep it visually quiet. Narrow panels show either the task list or selected task, with a back action. It uses a native modal dialog for focus containment and Escape dismissal.

The rail offers search and All / Active / Needs input / Done filters. Tasks needing input are selected first on wide panels. The inspector shows the worker, status, revision and budgets, then Result / Artifacts / Activity. Session identity, workspace path, dependencies and usage live under Task details. Full patch contents remain inspectable; the panel never applies changes.

New task reads the existing user defaults, discovers available workers, and lets the user explicitly supply context, revision, dependencies, runtime and cost limits. Conversation context is not automatically attached. Unsupported numeric cost budgets block submission. Claude's response-boundary cost semantics are disclosed. Defaults are read without modifying persisted settings.

Forms retain the conversation scope in which they opened. Changing scope clears the previous task view and closes unsent forms. A request already in flight cannot be retracted; its response does not select a task into the new scope, and the form asks the user to inspect its original outcome before retrying. Only the opener's explicit `panel_scope` result changes conversation scope; unrelated tool results are ignored.

Steering explains that it interrupts a running turn. Interrupt, cancel and new attempt describe their effects before submission. Permission requests show the complete payload and default to deny. Questions support choices, multiple selections and custom responses. Replies retain the exact request ID; the service remains responsible for rejecting stale input. Unconfirmed termination locks execution controls. Mutations are never automatically retried.

Bring to Codex prepares an editable, bounded message referencing the task and tools for full evidence. Message delivery is offered only when the host advertises text messages. Otherwise the message can be selected and copied manually. A declined delivery stays visible in the dialog. Selecting tasks or artifacts shares IDs only when structured model context is advertised; it does not trigger a follow-up automatically.

Optional context sharing runs separately from inspection: rejection or slow host delivery does not prevent opening an artifact. Expand and Collapse appear only when the respective target mode is advertised. Evidence tabs support arrow keys, Home and End. Closing a dialog returns focus to its replacement control if polling rebuilt the inspector.

## Transport and files

- `ui/codex.html`, `ui/codex.ts`: separate embedded panel shell and controller.
- `ui/codex-fixtures.ts`: synthetic design preview states; no service connection or worker execution. `?preview=1` works only at the top level; `&theme=dark` selects the dark preview.
- `scripts/build-ui.mjs`: builds both `dist/console.html` and self-contained `dist/codex.html`; checks the embedded JavaScript parses. No external UI assets or new packages.
- `src/stdio.ts`: adds `open_codex_subagent_extension` and `ui://codex-subagent-extension/app-v4` to the existing loopback proxy. It serves this checkout's built panel without exposing a token or creating another service. Existing tool names and envelopes are retained.
- `src/panel.ts`: shares the opener schemas, annotations, global/thread entrypoints, scope result, and panel resource definitions between HTTP and stdio. HTTP optionally includes initial owner-scoped tasks; the stdio opener remains independent of service availability. Both advertise task tools for model and app use.
- `src/app.ts`, `src/main.ts`: keep the web console on its current routes; use the separate panel for the HTTP MCP resource. The optional panel path retains compatibility for existing callers of `application`.
- `src/mcp.ts`: retains the HTTP opener and existing metadata, adds read-only annotations/output schema, and describes the embedded resource. The new HTTP resource uses `app-v4` so hosts refresh its cached metadata. The panel does not consume compatibility bootstrap metadata.
- `package.json`: includes the new controller in UI typechecking.

All panel reads and writes use the portable MCP Apps bridge. No direct fetch, cookie, SSE, credential entry, provider API or public endpoint is required in the panel. The stdio resource permits no external connections/assets. It polls through the bridge every five seconds while visible and not submitting. Unchanged details are not rerendered, open forms survive polling, and detail disclosure/focus/artifact scroll positions are retained. Activity uses cursor paging and displays the most recent 200 events; full history remains available through `get_agent_events`.

The official [UI documentation](https://developers.openai.com/plugins/build/chatgpt-ui) and [metadata reference](https://developers.openai.com/plugins/reference) informed the portable resource/bridge approach. ChatGPT's `window.openai`, global/thread entrypoints, rich forms and settings surfaces are not treated as Codex contracts.

## Load later without replacing the active service

Build this checkout with the lockfile dependencies installed. A separately configured MCP connection can run its `dist/stdio.js`, with `CODEX_SUBAGENT_EXTENSION_DATA` pointing to the existing service data directory and `CODEX_SUBAGENT_EXTENSION_URL` pointing to its existing loopback origin. The proxy reads the token locally and forwards only requested tools; it does not acquire the service lease or alter the database directly. The HTTP panel instead calls tools through the already-authenticated host MCP bridge. No MCP configuration change was made when applying the panel to the primary repository.

After explicitly choosing to load that connection, ask Codex to call `open_codex_subagent_extension`. Expand the returned app into Codex's side panel for native inspection: the MCP Apps inspector cannot access apps shown only inline. Pass `conversation_id` only if its actual value is known; otherwise the panel labels its scope All conversations. Do not infer a thread ID from undocumented host fields. The existing connection continues loading its configured checkout until configuration is deliberately changed. HTTP resource changes take effect only after the service adopts a build containing this resource; the current service was not restarted.

Reload the stdio MCP connection after building to discover the shared global/thread entrypoint metadata. The host controls launch placement. A thread entrypoint is intended for opening beside a conversation; global entrypoints are intended for the sidebar app view. Declaring both does not conditionally redirect a sidebar click to the active conversation. Conversation filtering still requires an explicit `conversation_id`.

The built HTML also has a fixture-only design preview for a browser that supports local files. The in-app Browser declined the file URL in this session. No alternate exposure/server was used to bypass that restriction, so visual rendering was not verified.

## Verification and open host gates

`npm run typecheck`, `npm run build` and `git diff --check` passed in the implementation worktree. Primary-repository typecheck passed after applying the changes. Its production build was not run because it would replace `dist` files used by the running service. Dependencies were temporarily read from the existing checkout using a local symlink, without installing or modifying its dependency tree; the symlink was removed afterward. No tests were added or run, no service was started or restarted, no credentials were printed, and no commit was created. These are build/source checks, not transport or native-host proof. The earlier 101-test result is historical.

Subsequent in-place verification passed `npm run typecheck`, `npm run build`, `git diff --check` and all 109 existing tests. The tests needed local socket access outside the filesystem sandbox. The installed stdio opener returned its expected unscoped `panel_scope`, and worker discovery succeeded through the installed connection. Neither response proves native rendering. The native MCP Apps inspector was available but had no expanded app to inspect. Browser state races and native interactions remain unverified.

`tests/http.test.ts` now also verifies the HTTP and stdio `app-v4` resource URI, panel HTML and empty CSP, retention of the standalone console, explicit/null conversation scope, and HTTP task filtering by conversation and owner. All four focused HTTP tests passed after these additions. This exercises actual MCP clients and fixture data without starting live workers.

After consolidating the panel definitions in `src/panel.ts`, typechecking, build and all 109 tests passed again. Transport checks compare opener descriptions, annotations, entrypoints, input/output schema structure, and complete resource contents. The SDKs emit different JSON Schema draft identifiers, so that comparison excludes only the root `$schema` URI. Tests also verify stdio task-tool visibility and close the proxy on assertion failures. Native placement after discovering the new stdio entrypoints still requires reloading the connection and observing the host.

Still unverified in the installed Codex host: rendering the new resource from stdio; bridge tool calls/authorization; host theme delivery; actual conversation scoping; model context reception; message delivery/rejection; fullscreen behavior; panel retention on reload/fullscreen changes. Global/thread entrypoints, native rich forms, native settings and host notifications remain separate unsupported/unverified assumptions. Existing HTTP features and headless tools remain available; no new Codex-specific host API or notification channel was added. Stage A was not repeated and Stage B was skipped.
