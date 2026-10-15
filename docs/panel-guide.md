# Delegated Work panel

Use this guide to operate Delegated Work or check its user-visible behavior.
The embedded panel and standalone console share one frontend; [Panel architecture](panel-architecture.md), including its
[loading and pending UI approach](panel-architecture.md#loading-and-pending-ui), covers
implementation. [Local development](development.md) covers setup, and
[UI verification](ui-verification.md) covers browser checks.

## Project and chat integration

Task creation and both openers return the `ui://codex-subagent-extension/app-v6`
resource. Their `panel_scope` and `panel_selection` open the selected task on
Chat. Task creation preserves its ordinary `structuredContent.result` too.
Only explicit opener scope changes are applied; unrelated tool results do not
change the conversation.

- **Thread launch:** scopes tasks to the conversation, with a read-only project
  name/path beside **Delegated Work** in the header. The project name is bold,
  separated from the extension name by a pipe. **Settings** remains available
  in the header and opens a full-width page with the **Back to Tasks** caret button to return.
  **Add chat project** is the first header action when
  registration is needed.
- **Global launch:** shows all conversations and offers the project selector,
  **All chats** and **Manage** to add, rename or remove saved projects. The project selector and
  **Manage** sit directly below the connection status within the header.
- An explicit owned task supplies its own scope. Conflicting explicit task,
  conversation, repository or revision arguments are rejected.
- Context resolution prefers explicit arguments, then validated optional Codex
  directory metadata, then an owned task in the conversation. New task defaults
  can also use the selected task or only registered project. User preferences
  remain intact. `conversation_id: null` explicitly opts out of correlation.
- The adapter accepts local `sandboxCwd` file URIs through
  `codex/sandbox-state-meta`; explicit context wins and invalid hints fall back.
  Conversation correlation uses explicit arguments, `threadId` and
  `openai/session`. See [Host capabilities](host-capabilities.md#project-context-and-registration)
  for what desktop hosts deliver.

On narrow panels, header actions move into **Panel actions**, including
**Settings**, with **Add chat project** first when registration is needed.

Project dropdowns include a search field that matches saved names and repository paths.

Changing scope invalidates reads, clears old evidence and closes unsent forms.
A mutation already submitted cannot be retracted or automatically retried; its
late result never selects work into the new scope. Task creation validates
approved project containment; worktrees start from a committed revision.

Inline mode shows a compact scope/count/status summary. **Open panel** requests
fullscreen only when the host advertises it; Collapse preserves selection and
form drafts. A standalone console always shows the full layout. The host owns
placement and available display modes; see [Host capabilities](host-capabilities.md).
While the first task read is pending, the compact preview uses a short
count-and-task skeleton in place of its summary.

### Manage projects

**Manage** is available only in global mode. It opens a full-width Projects page
with a **Back to Tasks** caret button beside the title to return to the previous task view. The page lists saved names and
repository paths, including parent approvals. **Add project** opens a focused
dialog for entering a path or using the service host's folder picker.
The saved-project list shows name, path and action placeholders while its first
read is pending.
Click a project name to edit it inline, like a task title. Enter or clicking
outside saves; Escape cancels. The remove icon on the right opens confirmation
in a focused modal. The repository folder and its files remain on disk.
Renaming changes the display name only;
names may repeat because paths identify projects.

Removal asks for confirmation. By default it removes the saved registration while
preserving files, task history and worktrees. Running turns may finish; later
turns require approval. Parent grants still apply, and automatic chat registration
can add the repository again when a task starts from its chat. Parent approvals
configured in `CODEX_SUBAGENT_EXTENSION_ALLOWED_ROOTS` return on service restart;
remove them from that configuration to keep them removed.

**Also remove extension task data**, off by default, stops and removes that repository's
tasks across all chats, matching its exact saved repository path. Removing a
parent approval does not remove descendant repositories' tasks. Removal includes
conversations, activity, requests and task worktrees/branches with uncommitted changes. Checkout files
and provider sessions remain. Tasks in other projects that depend on these tasks
block removal before cleanup starts. Internal dependents are removed first.
If cleanup fails, the approval and remaining tasks stay available for retry;
the error warns that earlier task removals cannot be undone.

Removing the selected project returns to **All projects** and clears stale task
selection and dialogs while keeping the Projects page open. Other panels reconcile registry changes on their next
refresh. Rename drafts survive refresh and failed saves; destructive choices
are not restored after reload.

## Tasks and settings

### Find and inspect tasks

The task rail searches and filters by **Unread**, **Needs input**, **Failed**,
**Active**, **Done**, then **All**. The default is the first nonempty filter
other than Unread. Questions and
permissions count as Needs input; failures, interruptions and compaction
failures as Failed; other unfinished tasks as Active. Queued follow-up turns
keep a task active between runs. Unread cuts across the others; see
[Read and unread tasks](#read-and-unread-tasks). Counts respect project and
search filters.
The first task read shows card-like rows with placeholders for titles, worker
profiles, runtime and status until the list arrives. Press `/` for search and
Escape to clear it.

Wide panels show rail and inspector together; narrow ones switch between them
with a back action. Until the first task read selects a task, the inspector
shows a spinner; its empty message appears only after loading when no task is
selected. Drag the divider to resize the task rail; its width is saved
in local storage when the browser or host permits it. Focus the divider and use Left/Right arrows to resize, Home/End
for the minimum/maximum width, or double-click to restore the default width.
Custom scrollbars appear during scrolling or pointer interaction and disappear
after one second of inactivity. They remain visible while dragging.
Details includes task creation and latest activity dates, description, worker,
revision, turns, budgets, session, workspace/branch, changes, dependencies and
usage. Dates follow the host locale and time zone. Runtime in the rail and
Details accumulates across turns and includes the active run.

### Read and unread tasks

A task becomes unread when it has something you haven't viewed: a worker
message or reply, a turn's end, a failure, or a question or permission request.
Your own messages never make a task unread. Unread tasks show an accent dot at
the top right of their row, and the compact panel adds **N unread** to its
counts.

A task becomes read when its Chat is on screen and scrolled to the latest
message: the panel must be visible, on the Tasks page and the Chat tab. Only
what Chat has loaded counts as read, so a reply that arrives after it stays
unread until Chat shows it.

Opening an unread task places a **New** divider above the first worker message,
outcome or failure after what you had read, and Chat opens with the divider at
the top. If everything new fits on screen, the task is read at once; otherwise
it stays unread until you scroll to the latest message, and the
**Scroll to unread messages** button carries a dot. The divider stays until you
leave the task or mark it read. A task you marked unread with nothing new opens
at the end.

- **Task actions → Mark unread** or **Mark read**, or right-clicking
  (long-pressing on touch) a task row, sets it by hand. A task you mark unread
  while reading it stays unread until you scroll its Chat or open another task.
- A reply's copy button row has **Mark unread from here**, an eye icon. It
  marks the task unread from that reply on, so earlier messages stay read. The
  **New** divider moves to just above that reply and opens its space smoothly;
  Chat smoothly scrolls to it if it is out of view.
- **Unread** lists unread tasks. The task you open stays listed after it is
  read until you choose another, and the filter is never picked by default,
  since reading empties it. **Mark all read** beside the count marks every
  listed task; with no search to clear, it takes **Clear filter**'s place.

The standalone console's tab title leads with the unread count, as in
**(2) Delegated Work**. Read state is stored by the service, so the embedded
panel and the standalone console agree and it survives reloads. Codex reading
replies through `get_agent_messages` doesn't mark tasks read.

### Create and rename tasks

Global launch offers two ways to start a task, from the **New task** split
button or, on narrow panels, **Panel actions**:

- **New task** opens an empty chat in the inspector, with a **New task** draft
  row at the top of the task list.
  Opening it from an existing task folds the task header and tabs away while
  the composer expands to show the draft options.
  Selecting an existing task from the draft plays the opening transition too,
  restoring that task's saved tab.
  Your first message becomes the request:
  Enter starts the task and opens it on Chat, and Shift+Enter adds a line.
  The composer sits where Chat's does; when the task starts, its header and
  tabs ease in above while the composer settles in place and keeps focus for
  your next message. Chips below the message choose the options:
  - **Project**, shown only under **All projects**.
  - **Profile**, which defaults to **General**. A profile works as a preset:
    choosing one returns model and reasoning to that profile's settings.
    Beside it, a one-line summary such as `Sonnet 5.5 · H · Edits` shows what
    the profile sets, abbreviating reasoning (L, M, H, H+, Max) and permission
    (Read, Ask, Edits); hover it for full names. Click it to edit these chips,
    and the caret to collapse them again. The pills fade and ease into place as
    they expand or collapse; reduced motion makes the change immediate.
    A draft that already overrides the profile opens with them shown.
  - **Model**, from the discovered models or the inherited default.
  - **Reasoning effort**, limited to levels the selected model supports.
  - **Permission mode**. Read-only profiles show **Read only** instead.

  Workspace, revision and budgets use your settings defaults. **More
  options…** opens Advanced task with the message and loaded choices filled in;
  defaults still pending finish loading there. Escape
  in an empty message, using the **Back to Tasks** caret button or selecting another task leaves the draft,
  which stays in memory until sent or the panel reloads. Changing the global
  project keeps it open; a chat scope closes it.

- **Advanced task…**, in the split button's menu, opens the full dialog. It
  collects the request, explicit context, workspace/revision, approval decision
  maker, dependencies and budgets. Unsupported numeric cost budgets block
  submission; Claude's response-boundary limit is disclosed. Use **Wait for
  tasks** to search task titles or IDs in the selected project and select
  multiple dependencies. Searching preserves selections; reopening the
  dropdown clears the search.

Both read defaults and worker availability without changing settings, and
neither attaches conversation text automatically. They show their structure
while defaults and choices load; only controls and actions that depend on
pending data are disabled.

Below a task's Chat composer, the hint line lists the profile, model, reasoning
effort and permission mode the task started with. Later turns keep them. The
profile keeps a pill and the rest shorten beside it, as in the new-task
composer's summary (`Haiku 4.5 · M · Read`); hover for full names. Narrow
panels put them on their own line.

The service derives a title from the request. Click the inspector title to edit:
Enter or an outside click saves, Escape cancels, and blank/failed saves stay open.
`rename_user_agent_task` accepts a trimmed title of 1–200 characters.

### Edit settings

**Settings** opens a full-width page with the **Back to Tasks** caret button to return. It uses
server-defined sections and rows, supports per-section resets, validates
budgets, and asks before discarding unsaved edits. **Save** sits in the page
header, keeps the page open, and sends only changed fields through the app-only
`update_user_agent_settings`. Permission and approval defaults are described in
[Configuration](configuration.md).
The form and section tabs appear before the settings read finishes, and the
last selected section is restored in the standalone console and development host. Wide pages use a vertical section rail;
narrow pages use a horizontally scrolling tab strip that reaches the page edges
and brings the selected section into view. Tab panels stay mounted so drafts
survive section changes. Pending fields remain in place with a spinner; a
dropdown whose selected value is unresolved also shows **Loading…** while
disabled.

Per-task tabs, composer drafts/visibility, question answers, Chat/Activity
reading positions and the Changes position, opened files and viewed files last
for the panel session. The standalone console and development host also persist view state and
dialog form drafts across reloads; the production embedded panel keeps them
only while mounted. For the storage boundaries, see [State and persistence](panel-architecture.md#state-and-persistence).

## Chat tab

The inspector tabs appear in this order: Chat, Activity, Changes and Details.
It shows requests, follow-ups, worker messages, replies and turn outcomes.
Worker and parent-agent text renders as Markdown, following the
[Markdown rules](../src/panel/features/file-preview/README.md#markdown); what the
user typed shows as typed. A reply that repeats the last message replaces it. An outcome stays with the preceding worker response when both belong to the
same turn. Outcome rows show the timestamp, duration and cost on the left, with
**Copy response** before the timestamp when a response is available and
**Ask Codex about this reply** in thread mode followed by **View activity**
on the right, separated by a middot. These actions move below the details and
align left when space is tight. On devices with hover, the row fades in when
the message is hovered or contains keyboard focus. It waits one second after
hover and focus leave before fading out; touch devices keep it visible. The
row keeps its space while hidden, and reduced motion disables the fade.
The timestamp omits seconds and the timezone. Responses from earlier days
include the date, with the year shown only when it differs from the current year.
Hover over the timestamp for the full date and time, including year and seconds,
without a timezone label. The duration tooltip says **Turn took** followed by the elapsed time.
Failures retain their error. Notes mark compaction, new sessions and recreated worktrees.
Draft text streams with a caret and is replaced by its stored message.

| Composer action                   | Behavior                                               |
| --------------------------------- | ------------------------------------------------------ |
| Enter                             | Start an idle task's next turn, or queue during a run. |
| Cmd/Ctrl+Enter during a run       | Steer the running turn after its next tool call.       |
| Shift+Enter                       | Insert a newline.                                      |
| Waiting for a question/permission | Messages can only be queued.                           |

### Steering, queues and budgets

Pending steers offer **Interrupt and send now**. Queued messages offer Edit and
Remove, and can be reordered by dragging or with Alt+Up/Alt+Down on a focused
message; a paused queue offers Resume and Clear. An unconsumed steer stays at
its front and can't be moved or passed. Sending the next message also resumes a
paused queue. When a budget is exhausted, Chat shows the relevant cost and
runtime controls together in the warning notice. **Apply** saves a higher limit
without sending a message; limits can only increase.
The composer can be hidden while retaining its draft; Stop remains available.
Every pending question or permission request collapses it automatically,
including requests opened through **Review request**. It can be reopened to
queue a message without changing its ordinary visibility preference.

### Questions and permissions

Questions appear as inline cards, with single/multiple choices, custom answers,
skips and **Respond**. Several questions form a navigable stack. Switching tasks
preserves unsent answers until reload. Permission requests show their complete
payload in Chat, with commands formatted as code and **Deny**/**Approve** actions
available inline. An optional message can be added before deciding. Requests
default to deny. Replies include the exact request ID; the service rejects
stale answers. Mutations are never automatically retried.

### Reading and loading

Chat follows new messages while the reader is at the end. Scrolling into history
preserves the visible message as replies stream or earlier pages load, and a
button above the composer returns to the latest message. Reduced motion turns
that return into an immediate jump.

Chat reads cursor-paged `get_user_agent_chat`; sending, queue editing and draft
reads use app-only tools. Stop uses `interrupt_agent_task`. See the
[MCP reference](mcp-reference.md) for tool contracts.

While task content loads, the known tab labels and selected tab stay visible.
Chat's first read shows alternating user bubbles and worker response lines,
including one restrained Markdown-like reply, until the conversation arrives.
An empty conversation says **No messages yet.**

## Activity timeline

The timeline lists activity oldest first, like Chat. It groups tools, hooks,
background tasks, streamed responses and adjacent routine updates while keeping
original SDK events for inspection. Progress moves an operation's row to the
end. Messages, failures and lifecycle transitions remain distinct;
stopped/cancelled operations are not shown as successful. Agent connection and
ordinary Claude status events keep their own timeline rows. **Requesting** is a
status update, without a thinking clock or duration. Thinking rows contain
only thinking signals and show a live clock, then their elapsed time.
User messages use Chat's literal-text bubbles, aligned left in Activity. Parent
messages and parent-authored initial requests also align left here.
The initial request appears before the first event when the beginning of the
history is visible, including turn 1. Later-turn views and trimmed history omit it.
Assistant message rows say **Started a response...**; their SDK message text stays
in the raw response JSON, while thinking notes and attachments remain visible.
A **Reply** row shows a 100-character preview beneath
its heading, with a **More**/**Less** control; the full event remains in Debug's
raw JSON. Tool input and output stay plain text,
with fenced blocks shown as code.

A turn's **Turn completed** row shows its duration, input and output tokens
(input includes cached tokens) and the session's cumulative cost. If a **Reply**
row follows and repeats the turn's result, the response appears on the Reply row.
The completed row's debug view keeps the result in raw response JSON,
alongside the turn metadata.

Rate-limit updates keep their own groups, separate from startup and Claude status
events. Each group shows a separate line for each reported window,
showing the window name, its latest utilization percentage and reset timestamp
without seconds or a timezone label. Labels include
**5-hour window** and **7-day Opus window**. Windows without reported utilization
are omitted. Status, overage details and earlier reports remain
in Debug.

Times follow the host's locale and time zone. A group heading shows the clock,
and its tooltip is the full date and time without a timezone label. An expanded
group fades out the heading's clock and shows its first event's timestamp, in
Chat's format, at the right of the **Debug details** line, followed by a button
that collapses the group and scrolls its heading back into view. The timestamp's
tooltip is the full date and time, like the heading's.
Tooltips across the panel close as soon as anything scrolls, so they never point
at a control that has moved.

Activity scrolls like Chat: it follows new events while the reader is at the
end, preserves the visible row while they read history, and shows the same
button to return to the latest activity. The task header and tabs stay fixed
when enough height remains; a short frame scrolls the whole inspector.
Chat and Activity keep separate positions. Reduced motion suppresses animation.

**View activity** on a Chat outcome row opens Activity at that turn. When the
turn is among the most recent events, Activity scrolls to its first row.
Otherwise the panel reads that turn's events (`get_user_agent_turn_activity`)
and shows them, trimmed and tallied like the latest view, under **Showing
activity for turn n** until **Show latest activity** or another task is
selected. A turn runs from after the previous turn's closing status event
through its own, so a queued message delivered as a turn ends stays with it.

Each row's debug button exposes readable event content, metadata and a raw SDK
response inspector. Raw JSON renders only when opened. Open disclosures survive
refreshes while their row remains in the most recent 200 events. The service
(`get_user_agent_activity`) gives the trimmed-tail note as a tally of the events
before that window. The Activity tab shows no count.
The panel reads only new events on each refresh. `get_agent_events` exposes full stored history.
Initial reads and separately requested turn activity show a timeline-shaped
skeleton with row summaries, timestamps and trailing debug affordances. An empty
feed says **No activity recorded yet.**

## Changes tab

Changes shows uncommitted task changes from Git, including untracked files and
excluding ignored files. The selected task's changes are read in the background
so the tab count appears before Changes is opened. Data refreshes when the task's
status/turn changes, when Changes opens with stale data, or on **Refresh changes**.
The tab count and Details read only the totals (`get_user_agent_change_counts`),
without the file list or diff, so the full change read happens when Changes opens.
Committed work stays in Git history. **Whole task** is the default; **This turn**
appears after multiple turns.
First reads show file-card skeletons with headers, stats, actions and
line-numbered diff rows, and Details shimmers its change summary until the totals
arrive. Opening a changed file shows a centered loading spinner until its
first read finishes. When moving between files, the current preview stays visible
with loading progress until the next file replaces it.

### Change comparisons

The panel and agent APIs answer different questions:

| Consumer                                      | Comparison                                                                                                                                                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Panel (`get_user_agent_changes` and counts)   | Uncommitted changes. Worktrees include all changed files; current-repo tasks include only files attributed to the task and omit pre-existing edits. Later outside edits to those files can also appear.                           |
| Agents (`get_agent_changes`) and dependencies | All attributed changes, committed or not. Worktrees compare base to current tree, or retained branch after removal. Current-repo tasks compare start snapshot to the live tree while running and recorded end snapshot otherwise. |

**Current-repo limit:** other edits between task start and its recorded end can
be attributed to the task. If an end snapshot was not recorded, changes cannot
be distinguished from later edits and the service reports that limitation.

Snapshots use a temporary Git index without changing the user's index or files.
They write blob/tree objects and pin task baselines under
`refs/agent-tasks/<task-id>/`; deleting a worktree task's branch removes its
snapshot refs. See `src/service/features/workspaces/workspace.ts` for snapshot and paging
implementation; the browser-safe change contract lives in
`src/shared/workspaces/changes.ts`.

### Diffs and file previews

Files expand into complete diffs and previews; a text file's preview adds a
**Diff** view of its changes. The header of the file being read stays pinned at
the top while it scrolls. Binary files show size; images can preview, deleted
files show Deleted and their removed lines. A file the diff has no part for
still gets a section, marked Diff unavailable. The tab shows the changed-file count as a
circular superscript badge beside its label, and only when at least one file changed.
In long lists, only the first file opens by default; files the reader has opened
or closed keep that choice.
The badge pops in when a count first appears.
Counts above 999 abbreviate, such as 1.1K or 2K. The badge sits outside the tab's layout,
so the count never changes the tab's width. A mounted panel keeps the last known count during refresh.
Large content renders in deferred row blocks, collapsed files unmount rows, and
cursor pages are read to completion. Refresh retains the last result; failures
mark it stale. Switching comparison scope clears the old result while loading.

When you scroll down the Changes tab, **Scroll to top** returns to its beginning.
The control respects reduced-motion settings.

The **Viewed** checkbox in a file's header, in the list or the preview, marks
the file read and collapses it in the list; the header counts viewed files. It
shows only a box, with a Mark as viewed tooltip. A mark lasts until that file's
changes change; the file then opens again, unread. **Preview all** opens the
preview at the first file not yet viewed.

In the preview, view tabs replace the visible dialog title, and file navigation
stays on that row, even in narrow panels. **Ask Codex about this file** is first
in the file toolbar, followed by Copy when clipboard access is available; Viewed
is last. On narrow panels, the actions move below file details, with Ask Codex
at the start and Viewed at the end of the row. A lone Viewed checkbox stays at
the end. Marking a file viewed moves on to the next unread one, wrapping to the
start. The heading shows the position, such as `3 / 12`, before previous
and next buttons that step through the files in list order, wrapping at either
end; a lone file shows only its position. The chosen view carries over, and the
last file stays visible until the next one is read.
On narrow panels, scroll the view choices horizontally when they do not fit.
The **File preview options** menu after Next includes **Wrap lines**, disabled
by default. Turn it on to wrap source and diff lines. The choice lasts while the
preview is open, including when switching views or files.

### Worktree actions

Worktree headers offer branch/path and copyable checkout/diff/push commands.
**Remove worktree** keeps the branch and asks before discarding uncommitted
changes. **Delete branch** asks separately after removal. These actions are
disabled during work or when change reads are loading/failed. A later message
recreates the worktree from its branch, or base commit if the branch was deleted.
The panel does not apply or push changes.

## Handoff and deletion

**Bring to Codex** (console: **Copy for Codex**) prepares an editable message
with the latest reply and pointers to message/change tools. Delivery is offered
only when supported by the host and requires submission. Otherwise copy the
text. In thread mode, **Ask Codex about this reply/file** opens the same editable
message flow for the exact reply or file selected. It includes an excerpt and
identifiers for retrieving the full conversation or file changes. Nothing sends until you submit;
closing or sending a file handoff returns to the file preview. Hosts without
message delivery offer text to copy manually.

Selecting a task can share its identity when supported. Context sharing never
blocks inspection or triggers an automatic follow-up.

The circled ellipsis to the right of the task heading opens **Task actions**, including handoff
and deletion. **Delete task** stops running/queued/waiting work, then
removes task history, requests and its worktree/branch/refs.
Current-repo files stay intact. **Also delete the agent task**, off by default,
also removes the provider session. Provider cleanup failure retains the local
task for retry; later cleanup failure can leave earlier resources removed.
Dependent tasks must be deleted first.

## Transport

The panel refreshes when the service changes. The service keeps a revision for
each owner's tasks and the shared project list, and the panel refreshes when the
revision it hears differs from the last one, within about 100 ms. A task
streaming events refreshes at most every 100 ms. Refreshes preserve forms and
reading positions. A hidden panel waits until it is shown, and a panel
submitting a form waits until the submission finishes. A 30-second fallback
refresh, restarted by every completed refresh, catches writes the service can't
announce, such as the projects CLI's.

The embedded panel uses the MCP Apps bridge; it needs no direct service fetch,
credential entry or SSE connection. The stdio resource allows no external
assets/connections. It holds one `wait_user_agent_updates` call at a time (the
controller requests 20 seconds; the tool accepts up to 25), which returns when
the revision changes or, while Chat shows a running task, when its draft does.
Waits stay at least 100 ms apart, and one that returns at once with nothing new
pauses for a second. A failed wait shows **Reconnecting…** and retries after 2
seconds, doubling to 30. Changes use explicit refreshes; diff pages are limited
to 1,000,000 characters.

The standalone console uses authenticated HTTP and SSE: `/api/events` sends the
revision on connect and after each change, and streams drafts as they're
written. See
[Host capabilities](host-capabilities.md) for embedded network restrictions,
and [Local development](development.md#what-reloads-when) for activation/reloads.
