# Embedded Delegated Work app

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
on Chat immediately, where its reply streams in, including in narrow panels. The
opener opens any selected task on Chat. The opener accepts
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

## Chat tab

Each task is a conversation, and **Chat** is its first tab: Chat / Changes / Activity / Details. It shows the task's request, the messages sent since, the worker's messages and each turn's reply, read through the app-only `get_user_agent_chat(task_id, after?)`, which pages from a cursor and returns an item again when it changes.

- **Messages.** The user's messages sit on the right; the parent agent's are labelled **Parent agent**. The worker's messages render as Markdown; its progress between replies is quieter than the reply that ends a turn. A reply that repeats the turn's last message takes that message's place, so it doesn't show twice. Where the host takes shared context, **Ask Codex about this reply** shares it as `selected_item: { kind: "message", id }`. Tool activity stays in Activity.
- **Outcome rows.** Each turn ends with a row: the turn's outcome (completed, failed or interrupted), how long it ran, what it cost, and **View activity**. A failed turn's row shows its error. Notes between messages mark a context compaction, a compaction failure, a new session (the earlier one couldn't continue) and a worktree recreated after **Remove worktree**.
- **Streaming.** While a turn runs, the worker's text streams in with a caret and is replaced in place by the stored message with the same id. Without a message being written, a status line shows the task's live activity.
- **Questions and permissions** show at the end of Chat, using the same forms as before: question cards answered in place, or a permission to review.
- **Composer.** Always at the bottom. It uses the Codex keys: **Enter** sends, which starts the next turn of an idle task or steers a running one; **Tab** queues while a turn runs and the composer has text; **Esc**, while the composer has focus and a turn runs, stops it. Otherwise Tab and Esc keep their usual roles. **Shift+Enter** adds a new line. Each key has a button: while a turn runs, an empty composer's button is **Stop**. While the worker waits for input, messages can only be queued. Unsent text is kept per task until the panel reloads.
- **Above the composer.** Steers the running turn hasn't taken yet, under "Sent after the next tool call" with **Interrupt and send now**, then queued messages, each with **Edit** and **Remove**. A queue an interrupt paused shows **Resume** and **Clear**; the next message sent resumes it too. A steer the turn ended without taking waits at the front of the queue and can only be removed.
- **Budgets.** When a task has spent its cost or runtime limit, the composer shows the amounts used and allowed, with fields that raise the limits for the next message. Each limit can only go up.

The app-only tools are `send_user_agent_message(task_id, message, delivery?, budget?)`, `edit_user_agent_queued_message`, `remove_user_agent_queued_message`, `resume_user_agent_queue`, `clear_user_agent_queue` and `get_user_agent_draft`; **Stop** calls `interrupt_agent_task(task_id, send_pending?)`.

## Activity timeline

Claude activity preserves every SDK response, including content blocks, streaming events, system updates, hooks, background tasks, rate limits, and unknown future variants. The timeline combines tool starts, progress and results into one row, groups hook and background-task lifecycles by their IDs, assembles streamed responses, and collapses adjacent routine status updates. Rows appear newest first by their latest event, so progress on an existing operation moves its row to the top. Messages and failure reasons remain visible; cancelled and stopped operations are distinguished from successful completion. A `task.completed` row includes the accumulated runtime, such as **Task completed after 3m 05s**. While a task runs, the inspector's status line ends with its live activity, such as **Thinking…** or the running tool, and distinguishes working, idle and failed provider updates. The live text comes last and truncates, so the labels before it never shift; on panels 400 pixels wide or less, the worker label gives way to it. A rail joins the row markers, starting at the newest and ending at the oldest; when older events were trimmed, it fades out into a note saying how many recent events are shown and summarizing the rest: how many earlier events there were, the time they spanned, and counts of tool calls (by tool), messages, failures and retries. The panel tallies these as events leave the retained tail, so the summary covers everything it has read for that task. A finished thinking row says **Thought for 7s**, measured from its first thinking update until the next event. While nothing has followed and the task runs, the row shows a bare clock that counts up.

The expanded panel is sized to its viewport and the page itself never scrolls; the task list and the selected evidence tab each scroll independently without chaining into one another. The task header stays in place above the tabs, with long notices clamped to two lines behind **Show more**. When the header would leave the tabs less than 280 pixels, the whole inspector scrolls instead. The Activity tab keeps its reading position while another tab is shown. New rows fade and slide in, and existing rows animate to their new positions; reduced-motion preferences suppress these animations. Scrolling within 48 pixels of the top pins the feed, and new activity keeps it at the top. Scrolling farther down preserves the visible row when activity arrives. A floating scroll-to-latest button scrolls smoothly back to the top, pins the feed, and focuses the activity region. Scrolling away while it moves hands control back to the reader. The feed scrolls right up to the tab bar, and its spacing from the tabs sits inside the scroller, so rows clip at the tabs and not below a gap. On panels 640 pixels wide or less the tab bar runs edge to edge and scrolls sideways when it overflows, resting inside the content margin; selecting a tab scrolls it into view.

A small debug icon beside each row’s timestamp opens individual events with readable content, labeled metadata, and a **Raw response** inspector for the original SDK message. Debug controls support keyboard navigation and announce their expanded state. Event details mount on first use and stay mounted to preserve open inspectors through refreshes and closing/reopening the debug panel. Raw JSON renders only when its own inspector is open. Thinking has a separate disclosure; supported inline images render in place, while encoded payloads remain available in raw JSON.

The panel retains the most recent 200 events; full stored history is available through `get_agent_events`. Open inspectors persist while their timeline row remains in the retained tail. Older stored events expose their saved data; messages discarded by the previous adapter cannot be recovered.

## Changes tab

Every task has a **Changes** tab: the task's uncommitted changes, read live from Git whenever the tab (or Details) opens, the task's status or turn changes, or **Refresh changes** is pressed. Committed work isn't shown; it's in the Git history, on a worktree task's branch or in the checkout's log. Nothing is stored, and it never uses the worker's own list of changed files, which misses formatter, codegen and shell edits.

- **What it shows.** Uncommitted changes made since the task started, untracked files included and ignored ones left out. Each file is compared with its content when the task started or, if it has been committed since, with its committed content, so edits already uncommitted at the start are left out, and so is anything committed after. A file that no longer differs from `HEAD` leaves the tab, and comes back if it's edited again. A worktree belongs to its task, so all of its files count. In a `current_repo` checkout, only the files the task changed count (see the task's changes below); the tab says so: "Uncommitted changes to the files this task changed, including edits to them made outside the task. Committed changes are in the Git history." **This turn** keeps the files changed in the latest turn; the choice appears once a task has more than one turn, and **Whole task** is the default. Empty, the tab says "No uncommitted changes. Anything committed is in the Git history."
- **The task's changes.** Agents (`get_agent_changes`) and dependent tasks see everything a task changed, committed or not; the panel uses the same diff to pick a `current_repo` task's files. Both sides are tree snapshots taken with a temporary index (`GIT_INDEX_FILE`, `add -A`, `write-tree`), so the checkout's own index and files are never touched and `.gitignore` applies. The temporary index starts as a copy of the checkout's index, keeping its timestamp, so Git hashes only files that changed since the index was written; assume-unchanged marks are dropped from the copy, and unmerged entries left by a merge conflict resolve to the working tree. A checkout with no index file starts from `HEAD` instead, which gives the same tree more slowly. In a sparse checkout, files outside the sparse set stay as committed. A worktree task diffs its base commit against its worktree now, since only the task (or you, following up) edits it. A `current_repo` task diffs a snapshot from task start, which leaves out work that was already uncommitted, against the checkout now while its worker runs, and against a snapshot taken when the worker stopped otherwise: when its latest turn ended, or when it began waiting for input (kept if the task is then stopped, since the worker was blocked). Later edits to the checkout aren't counted. A `current_repo` task that ended before these end snapshots were recorded, or whose service stopped mid-turn, shows no changes: "This task ended before its end state was recorded, so its changes can't be told apart from later edits to this checkout." The latest turn's changes are diffed from a snapshot taken when it started. A removed worktree's changes are what's committed on its branch: the base commit (or the turn snapshot) against the branch's latest commit.
- **Known limit for `current_repo`.** Anything else that edits the checkout between the task's start and the end of its latest turn, including you, counts as the task's too.
- **Side effect.** Snapshots write blob objects for new content into the repository's object store. The ones a task compares from are pinned, so `git gc` keeps them: refs `refs/agent-tasks/<task-id>/start`, `turn-start` and `end` point at their trees, and `turns/<n>/start` and `turns/<n>/end` keep each replied turn's, which its `agent.reply` event records. They aren't branches, and `git log --all` leaves them out. Deleting a worktree task's branch removes its refs; list them all with `git for-each-ref refs/agent-tasks` and remove one with `git update-ref -d <ref>`. Snapshots taken only to read changes are unreferenced, and `git gc` prunes them in time.
- **Header.** A worktree task shows its branch (`<worktree_branch_prefix><task-id>`, `agent/` by default), then commands to copy: `cd` into the worktree (or `git checkout` the branch once the worktree is removed), compare with `git diff <base>...<branch>`, and push with `git push -u origin <branch>`. The panel never pushes; work leaves a task by being pushed from a terminal. Copy buttons appear where the clipboard is available; elsewhere a command selects as a whole on click.
- **Files.** Each changed file is a collapsible diff, collapsed when there are more than eight. Binary files show **Binary file changed** and their size. **Preview** opens the file as it is now in a modal with the file viewers: Markdown, tables, images, source and diffs. A deleted file previews as **Deleted**; binary files that aren't images have no preview. Where the host takes shared context, **Ask Codex about this file** shares it as `selected_item: { kind: "file", path }`.
- **Worktree actions** (worktree tasks, in the header and Details, disabled while the task runs). **Remove worktree** runs `git worktree remove` and keeps the branch; if the worktree has uncommitted changes, it lists them and asks before discarding them. Once the worktree is gone, **Delete branch** asks before deleting the branch. Each outcome is a task event (`task.worktree_removed`, `task.branch_deleted`). Removing a worktree doesn't end the task: its next message recreates the worktree from the branch, or from the base commit if the branch was deleted too (`task.worktree_recreated`), and Chat notes it.
- **Empty states.** No uncommitted changes; "The worktree was removed, so nothing is uncommitted. Its commits are on branch …"; "The worktree and its branch … were deleted." Tasks created before change tracking show a plain error.
- **Everything is shown.** Diffs and previews are never truncated. Long diffs, sources and tables mount their rows in blocks of 200 near the visible area, and a collapsed file unmounts its rows. The tools page large diffs by whole files, and large files by characters, through `next_cursor`; the panel reads every page.

The service tools are `get_agent_changes(task_id, scope?, cursor?)` and `get_agent_changed_file(task_id, path, cursor?)`, which agents can call too and which return the task's changes, and the app-only `get_user_agent_changes` and `get_user_agent_changed_file`, which return its uncommitted changes, `remove_user_agent_worktree` and `delete_user_agent_branch`. A dependent task's prompt includes each dependency's whole-task diff, up to 50,000 characters in whole files; a removed worktree's is what's committed on its branch.

## Panel behavior

The panel complements the Codex conversation with a compact task rail and inspector. Neutral colors, system typography, restrained borders, dense controls and host theme variables keep it visually quiet. Narrow panels show either the task list or selected task, with a back action.

The rail offers search and Needs input / Failed / Active / Done / All filters, in that order. Until you choose one, the first filter in that order that holds tasks is selected for you (All when none do). A filter appears only while it holds tasks (the chosen one stays), except All, which always shows so the row keeps its place; pills fold in and out as that changes. Each task appears in exactly one filter besides All: a task waiting on a question or permission is under Needs input; failed, interrupted and compaction-failed tasks are under Failed; other unfinished tasks are under Active; completed tasks are under Done. A task whose queue goes straight on to its next turn is never completed in between, so it stays under Active. Each filter shows how many tasks it holds for the current search and project; Needs input and Failed highlight when nonzero. The filters are pills; on narrow panels they run edge to edge and scroll sideways, resting inside the content margin like the tabs, and the selected one scrolls into view. Press `/` to focus search and Escape to clear it. When search or a filter narrows the list, the list header shows "N of M" with a **Clear filter** link, and an empty result says what matched nothing. When all projects are shown, each row names its project above the task title. Tasks needing input are selected first on wide panels. The inspector shows the worker and status, then Chat / Changes / Activity / Details. Details lists the worker, revision, the number of turns, budgets, session identity, workspace path, a worktree task's branch, a live **+N −M, K files** line for its changes, dependencies and usage. The task list shows a live runtime on its second line during active work; waiting and attention states use short labels instead. Completed tasks show **Ran for** and failed tasks **Failed after** with their total runtime across turns. Details also counts the active run, using `run_started_at` because `runtime_ms` only adds a run once it ends. The inspector header shows status and current activity without a separate runtime. On wider panels, Refresh, Expand/Collapse, and Settings are icon buttons with tooltips; on narrow panels Expand/Collapse stays on the bar while Refresh and Settings fold into the **⋯** menu. Global launches show a **Browse** button beside the project selector, which opens the folder picker and adds the chosen repository without the project dialog. A thread launch offers **Add chat project** in the context bar instead. The panel never applies changes.

New task reads the existing user defaults, discovers available workers, and lets the user explicitly supply context, revision, dependencies, runtime and cost limits. Conversation context is not automatically attached. Unsupported numeric cost budgets block submission. Claude's response-boundary cost semantics are disclosed. Defaults are read without modifying persisted settings.

Forms retain the conversation scope in which they opened. Changing scope clears the previous task view and closes unsent forms. A request already in flight cannot be retracted; its response does not select a task into the new scope, and the form asks the user to inspect its original outcome before retrying. Only the opener's explicit `panel_scope` result changes conversation scope; unrelated tool results are ignored.

Permission requests show the complete payload and default to deny. Worker questions are answered in place at the end of Chat: the question notice opens expanded when a request arrives, and a notice the user collapses stays collapsed when they return to the task. Unsent answers are kept too: switching to another task and back restores the choices, typed answers, skips and current question until the answers are sent. Both are remembered only until the panel reloads. Choices show inline as single or multiple selections, with an Other field for a custom response. Several questions in one request form a stack of cards with a count and a chip per question, sized to the tallest card so the stack does not move between questions. Each question can be skipped; Claude then receives an answer saying the user has no preference. Replies retain the exact request ID; the service remains responsible for rejecting stale input. Mutations are never automatically retried.

Click the task title to edit it in place. Enter or clicking outside saves a changed title; Escape discards the change and dismisses focus. Titles wrap without switching to a single-line view. Blank titles and failed saves remain open for correction or retry. Titles contain 1–200 characters after trimming, and `rename_user_agent_task(task_id, title)` changes only the display title. The full task description appears in Details.

The **more menu** at the end of the task's status line holds **Delete task**, the only way to end a task for good. It works in any state: a running, queued or waiting task is stopped first. Its dialog confirms, then removes the task with its events, pending requests and queued webhook deliveries, and a worktree task's worktree (uncommitted changes included), branch and snapshot refs. A current-repo checkout is left as it is. The **Also delete the agent task** switch, off by default, also deletes the provider's session (Claude's transcript), so nothing can resume it; if provider cleanup fails, the local task is kept for retry. Cleanup across the provider, Git and local storage is sequential, so a later failure can leave earlier resources already removed. A task that others depend on can't be deleted until they are, since a follow-up could still resume them. The app-only tool is `delete_user_agent_task(task_id, delete_agent_task?)`.

The handoff action in the more menu (**Bring to Codex**, or **Copy for Codex** in the standalone console) prepares an editable, bounded message that quotes the latest reply and points to `get_agent_messages` and `get_agent_changes`. Message delivery is offered only when the host advertises text messages. Otherwise the message can be selected and copied manually. A declined delivery stays visible in the dialog. Selecting a task shares its ID, and **Ask Codex about this file** or **Ask Codex about this reply** adds the file or reply as `selected_item`, only when structured model context is advertised; it does not trigger a follow-up automatically.

Optional context sharing runs separately from inspection: rejection or slow host delivery does not prevent selecting a task. Expand and Collapse appear only when the respective target mode is advertised. Evidence tabs support arrow keys, Home and End. Closing a dialog returns focus to its replacement control if polling rebuilt the inspector.

## Transport

All panel reads and writes use the portable MCP Apps bridge. No direct fetch, cookie, SSE, credential entry, provider API or public endpoint is required in the panel. The stdio resource permits no external connections/assets. It polls through the bridge every five seconds while visible and not submitting. Unchanged details are not rerendered, open forms survive polling, and detail disclosure, focus and scroll positions are retained. Activity uses cursor paging and displays the most recent 200 events; full history remains available through `get_agent_events`. Chat reads its own items by cursor, so a long task keeps its whole conversation. While Chat shows a running task, the panel follows its draft with `get_user_agent_draft(task_id, message_id?, after_length?, wait_ms ≤ 25000)`, one call after another: each returns as soon as the draft grows or becomes another message, the message is stored, or the turn ends. Reads are at least 100 ms apart and pause while the panel is hidden, and task reads include the draft as a fallback. The proxy and host transport give this tool its wait plus a ten-second margin. The panel can't stream over SSE, since Codex runs it under a fixed sandbox CSP; see [host capabilities](host-capabilities.md#panel-network-access). Changes are not polled, since each read snapshots the workspace; they reload when the task's status or turn changes and on **Refresh changes**. Their pages are at most 1,000,000 characters of diff each. The service keeps the last two diffs for a minute, by checkout and tree pair, so later pages of a large diff don't run Git again. The 60-file preview diff (about 330 KB) crossed the dev host's bridge in one message; the Codex host's own message size limit has not been measured.

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
