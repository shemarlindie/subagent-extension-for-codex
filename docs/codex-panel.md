# Embedded Codex delegation panel

The shared frontend architecture is documented in [React UI architecture](react-ui.md).

## Host confirmation and display modes

The target is Codex inside the ChatGPT desktop app. On October 2, 2026, the
user confirmed that the thread-specific panel is present and works. Other
bridge features and modes need their own evidence.

The extension implements inline/fullscreen. The official developer reference
also documents PiP, but the linked extension specification explicitly excludes
it in ChatGPT. Do not present PiP as categorically unsupported or assume a
separate Codex restriction. The source comparison and runtime fallback guidance
are in [host capabilities](host-capabilities.md#display-modes-and-native-extension-surfaces).

The user specifically requested a launcher section in the host's **right pinned
summary**, separate from the repository Changes section. No extension point for
that card was found in the checked official developer docs. The working thread
entrypoint and the extension's own inline summary are separate surfaces.

## Project and chat integration

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
history. Chat launches retain their scope and show the project name and path read-only;
the project selector and **All chats** are available only from the global entrypoint.
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
owns physical placement. The current inline widget offers **Open panel**, which
requests fullscreen only when advertised by the host; no automatic request is
made. Entry-point metadata
changes and additional bridge behaviors need separate host checks. Restarting
a service with active work needs operational care; this work does not restart it.

Fixture browser checks covered 440px light and 1040px dark layouts, project path
visibility and new-task project/revision/worker prefills with task-field focus.
No browser console warnings/errors were observed. These are preview checks,
not native-host proof. [Narrow preview](images/project-thread-panel-narrow.png)
and [wide preview](images/project-thread-panel-wide.png) are saved evidence.

## Activity timeline

Claude activity preserves every SDK response, including content blocks, streaming events, system updates, hooks, background tasks, rate limits, and unknown future variants. The timeline combines tool starts, progress and results into one row, groups hook and background-task lifecycles by their IDs, assembles streamed responses, and collapses adjacent routine status updates. Rows appear newest first by their latest event, so progress on an existing operation moves its row to the top. Messages and failure reasons remain visible; cancelled and stopped operations are distinguished from successful completion. A `task.completed` row includes the accumulated runtime, such as **Task completed after 3m 05s**. While a task runs, the inspector's status line ends with its live activity, such as **Thinking…** or the running tool, and distinguishes working, idle and failed provider updates. The live text comes last and truncates, so the labels before it never shift; on panels 400 pixels wide or less, the worker label gives way to it. A rail joins the row markers, starting at the newest and ending at the oldest; when older events were trimmed, it fades out into a note saying how many recent events are shown and summarizing the rest: how many earlier events there were, the time they spanned, and counts of tool calls (by tool), messages, failures, retries and artifacts. The panel tallies these as events leave the retained tail, so the summary covers everything it has read for that task. A finished thinking row says **Thought for 7s**, measured from its first thinking update until the next event. While nothing has followed and the task runs, the row shows a bare clock that counts up.

The expanded panel is sized to its viewport and the page itself never scrolls; the task list and the selected evidence tab each scroll independently without chaining into one another. The task header stays in place above the tabs, with long notices clamped to two lines behind **Show more**. When the header would leave the tabs less than 280 pixels, the whole inspector scrolls instead. The Activity tab keeps its reading position while another tab is shown. New rows fade and slide in, and existing rows animate to their new positions; reduced-motion preferences suppress these animations. Scrolling within 48 pixels of the top pins the feed, and new activity keeps it at the top. Scrolling farther down preserves the visible row when activity arrives. A floating scroll-to-latest button scrolls smoothly back to the top, pins the feed, and focuses the activity region. Scrolling away while it moves hands control back to the reader. The feed scrolls right up to the tab bar, and its spacing from the tabs sits inside the scroller, so rows clip at the tabs and not below a gap. On panels 640 pixels wide or less the tab bar runs edge to edge and scrolls sideways when it overflows, resting inside the content margin; selecting a tab scrolls it into view.

A small debug icon beside each row’s timestamp opens individual events with readable content, labeled metadata, and a **Raw response** inspector for the original SDK message. Debug controls support keyboard navigation and announce their expanded state. Event details mount on first use and stay mounted to preserve open inspectors through refreshes and closing/reopening the debug panel. Raw JSON renders only when its own inspector is open. Thinking has a separate disclosure; supported inline images render in place, while encoded payloads remain available in raw JSON.

The panel retains the most recent 200 events; full stored history is available through `get_agent_events`. Open inspectors persist while their timeline row remains in the retained tail. Older stored events expose their saved data; messages discarded by the previous adapter cannot be recovered.

## Panel behavior

The panel complements the Codex conversation with a compact task rail and inspector. Neutral colors, system typography, restrained borders, dense controls and host theme variables keep it visually quiet. Narrow panels show either the task list or selected task, with a back action.

The rail offers search and All / Active / Needs input / Done / Failed filters. Each task appears in exactly one filter besides All: a task waiting on a question or permission is under Needs input; failed, interrupted, unconfirmed-shutdown and compaction-failed tasks are under Failed; other unfinished tasks are under Active; completed tasks are under Done; cancelled tasks appear only under All. Each filter shows how many tasks it holds for the current search and project; Needs input and Failed highlight when nonzero. On narrow panels the filters scroll sideways and the selected one scrolls into view. Press `/` to focus search and Escape to clear it. When search or a filter narrows the list, the list header shows "N of M" with a **Reset** link, and an empty result says what matched nothing. Tasks needing input are selected first on wide panels. The inspector shows the worker and status, then Result / Artifacts / Activity / Details. Details lists the worker, revision, budgets, session identity, workspace path, dependencies and usage. The task list shows a live runtime on its second line during active work; waiting and attention states use short labels instead. Completed tasks show **Ran for**, failed tasks **Failed after**, and cancelled tasks **Stopped after** with their total runtime. Details also counts the active run, using `run_started_at` because `runtime_ms` only adds a run once it ends. The inspector header shows status and current activity without a separate runtime. On panels 640 pixels wide or less, the header keeps **New task** and folds Refresh, Expand/Collapse, **Add project** and Settings into a **⋯** menu. **Add project** appears only in a global launch; a thread launch offers **Add chat project** in the context bar instead. Full patch contents remain inspectable; the panel never applies changes.

New task reads the existing user defaults, discovers available workers, and lets the user explicitly supply context, revision, dependencies, runtime and cost limits. Conversation context is not automatically attached. Unsupported numeric cost budgets block submission. Claude's response-boundary cost semantics are disclosed. Defaults are read without modifying persisted settings.

Forms retain the conversation scope in which they opened. Changing scope clears the previous task view and closes unsent forms. A request already in flight cannot be retracted; its response does not select a task into the new scope, and the form asks the user to inspect its original outcome before retrying. Only the opener's explicit `panel_scope` result changes conversation scope; unrelated tool results are ignored.

Steering explains that it interrupts a running turn. Interrupt, cancel and new attempt describe their effects before submission. Permission requests show the complete payload and default to deny. Questions support choices, multiple selections and custom responses. Replies retain the exact request ID; the service remains responsible for rejecting stale input. Unconfirmed termination locks execution controls. Mutations are never automatically retried.

Bring to Codex prepares an editable, bounded message referencing the task and tools for full evidence. Message delivery is offered only when the host advertises text messages. Otherwise the message can be selected and copied manually. A declined delivery stays visible in the dialog. Selecting tasks or artifacts shares IDs only when structured model context is advertised; it does not trigger a follow-up automatically.

Optional context sharing runs separately from inspection: rejection or slow host delivery does not prevent opening an artifact. Expand and Collapse appear only when the respective target mode is advertised. Evidence tabs support arrow keys, Home and End. Closing a dialog returns focus to its replacement control if polling rebuilt the inspector.

## Transport

All panel reads and writes use the portable MCP Apps bridge. No direct fetch, cookie, SSE, credential entry, provider API or public endpoint is required in the panel. The stdio resource permits no external connections/assets. It polls through the bridge every five seconds while visible and not submitting. Unchanged details are not rerendered, open forms survive polling, and detail disclosure/focus/artifact scroll positions are retained. Activity uses cursor paging and displays the most recent 200 events; full history remains available through `get_agent_events`.

## Activation and host checks

Build this checkout with the lockfile dependencies installed. A separately configured MCP connection can run its `dist/stdio.js`, with `CODEX_SUBAGENT_EXTENSION_DATA` pointing to the existing service data directory and `CODEX_SUBAGENT_EXTENSION_URL` pointing to its existing loopback origin. The proxy reads the token locally and forwards only requested tools; it does not acquire the service lease or alter the database directly. The HTTP panel instead calls tools through the already-authenticated host MCP bridge.

Reload the stdio MCP connection after building to discover the separate global/thread openers and the updated resource URI. The host controls launch placement. A thread entrypoint is intended for opening beside a conversation; the global entrypoint opens all projects and conversations in the sidebar app view. Chat-scoped launches still use explicit or host-supplied conversation correlation.

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
