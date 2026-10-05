# Project and chat context for Delegated Work

October 2, 2026. Requested outcome: asking Claude to review work opens delegated
work beside the chat with the correct repository and new task active; New task
inherits useful defaults. Implement in the existing checkout, without committing.

## Research and decision

The [current extension guide](https://developers.openai.com/plugins/build/extensions)
and [public extension specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md)
describe global and thread entrypoints. A thread gets its own app instance, but
entrypoint arguments are `{}`. They do not establish an active-repository argument.
The [tool metadata reference](https://developers.openai.com/plugins/reference)
documents optional anonymized `openai/session` correlation. This is not a native
Codex thread ID or an access grant. The installed MCP Apps host-context type has
presentation fields and no declared project/repository field.

Legacy Apps SDK APIs (`window.openai.widgetState`, `setWidgetState`, PiP) must not
be assumed on every Codex host. Prefer the existing portable MCP Apps bridge,
explicit validated launch data, and host capabilities. Current installed OpenAI
extensions support preferred model display mode and resource display modes;
declare inline/fullscreen and prefer inline for model invocations. The host
decides the physical location and may ignore hints. The thread entrypoint is the
supported conversation-adjacent affordance, not a forced right-side placement API.

| Real option                                                                     | Benefit                                                                      | Tradeoff                                                                                | Decision                           |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------- |
| Attach existing panel resource to task creation and supply task/project scope   | One call starts work and renders the selected task; works with current tools | Native placement still requires host verification                                       | Implement                          |
| Explicit opener repository/revision/task, plus latest task within the same chat | Reliable project defaults without global state or private APIs               | First use needs model-supplied context or user selection                                | Implement                          |
| Optional source-backed Codex directory adapter                                  | Can resolve approved project on first use from sandboxCwd file URI           | Opt-in experimental capability and version-specific host delivery                       | Implement with validation/fallback |
| Trusted SessionStart hook and explicit session binding                          | Can capture actual cwd before the first delegation                           | Hook trust/setup required; hook ID and anonymized MCP session are not proven equivalent | Document future option             |
| Separate client built on Codex app-server                                       | Full control of thread/cwd/layout/events within that client                  | Not an extension point into the existing desktop layout                                 | Document alternative               |
| Local browser panel via Codex open_in_codex helper                              | Explicit right placement from a skill when the desktop tool is available     | Different surface, service/auth and lifecycle concerns                                  | Document fallback                  |
| Scrape desktop state, guess extra host fields, use a global last directory      | Superficially automatic                                                      | Concurrent-chat races, unsupported contracts, wrong-repository risk                     | Reject                             |

Codex [app-server](https://learn.chatgpt.com/docs/app-server) supports `thread/start`
cwd and `thread/list` cwd filters for clients using that protocol. This does not
prove that a third-party MCP app can inspect or control the active desktop thread.
[Hooks](https://learn.chatgpt.com/docs/hooks) and [project MCP configuration](https://learn.chatgpt.com/docs/extend/mcp)
are useful alternatives but launch cwd is not a guaranteed per-call chat binding.
The companion research report records deeper source evidence and compatibility.

## Implementation sequence

1. Add an owner-scoped, read-only panel-context resolver. Accept optional
   conversation, repository, revision and task ID. Validate explicit repositories
   with the existing Projects/Workspaces checks; verify task ownership and reject
   conflicting chat/repository hints. Recover defaults from the newest task only
   within the supplied conversation. No unrelated global-history default.
2. Expand the shared opener and output schema to include repository/revision and
   selected task/tab. Use the resolver over both HTTP and stdio. Attach the panel
   to successful task creation with the just-created task and Activity tab.
   Preserve existing task result envelopes. Bump the resource URI for caching.
3. Add a visible project context selector and path, project filtering, and scoped
   new-task prefills. Default order: explicit launch repository, intentional task
   selection, latest task in this chat, only registered repository. A manually
   chosen project remains editable. Parent registrations need a validated absolute
   child repository input rather than silently choosing the parent as a Git root.
   Carry revision when the repository matches; otherwise use HEAD. Show a queued
   task immediately, auto-select launch targets even in narrow panels, and retain
   Activity as work runs. Render initial returned tasks before polling.
4. Keep task selection/polling/form requests tied to a generation and scope;
   changing chat/project clears unrelated detail and closes unsent forms. Prevent
   late responses from selecting work into a different scope. Explicit null
   conversation means All conversations and bypasses optional host injection.
   Context sharing is capability gated and identifies conversation/repository/
   revision/task/artifact; it never sends an unsolicited chat message.
5. Improve responsive panel layout, contextual breadcrumbs, status announcement,
   worker/profile defaults and bounded evidence handoff. Keep host theme/style
   variables and capability-gated expand/collapse. Update delegation skill so
   conversational delegation supplies the actual repository and bounded context,
   uses the UI result, and distinguishes native chat IDs from correlation IDs.
6. Verify meaningful context/transport/race/default tests with fixture workers,
   typecheck, build, existing suite, and visual checks when browser access allows.
   Record native-host gates separately from protocol proof. Do not launch paid
   workers or change MCP configuration merely to test presentation.

## Acceptance criteria

- Successful start_agent_task returns its existing Task and an associated panel
  carrying its canonical repository, conversation scope, ID and Activity tab.
- Opening with task_id selects that owned task and rejects conflicting scope.
- New task has directory and revision prefilled when context is known; multiple
  unrelated repositories never silently default from global task history.
- Project selection scopes lists and dependencies, and remains visible when the
  task list collapses in a narrow panel. Unknown context is clearly labelled.
- Concurrent chats and delayed reads/mutations do not contaminate one another.
- HTTP and stdio advertise matching panel metadata and result contracts.
- Read-only context never registers a root, starts a worker or persists settings.
- All required checks pass; native panel placement and first-use automatic cwd
  limitations are stated candidly.

## Execution record

Plan saved before implementation. Subsequent source research established a
narrow optional `codex/sandbox-state-meta` adapter in public core/CLI source,
which is included with validation and fallback. The desktop UI is closed source;
its layout and metadata delivery require live verification. Research references and final verification will
be recorded in the companion research report and docs/codex-panel.md.

This is the plan-completion snapshot for app-v5, before the later app-v6 panel
update and shared React UI. See the [current panel notes](codex-panel.md) and
[React UI architecture](react-ui.md) for the current implementation.

Implementation completed in the existing checkout. Includes the optional validated
Codex cwd/thread adapter, shared app-v5 opener/task-creation UI, contextual
prefills, project/chat indicators and race protections. Full suite: 155/155;
final UI refinement: 11/11. Typecheck, build and whitespace checks passed. Browser
fixture previews passed at 440px light and 1040px dark. Native desktop loading,
metadata delivery and placement remain explicit operational verification gates.
No commit or running-service restart was performed.
