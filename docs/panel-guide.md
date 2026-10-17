# Delegated Work panel

Use this guide to operate Delegated Work or check its user-visible behavior.
The embedded panel and standalone console share one frontend. [Panel architecture](panel-architecture.md), including its
[loading and pending UI approach](panel-architecture.md#loading-and-pending-ui), covers
implementation. [Local development](development.md) covers setup, and
[UI verification](ui-verification.md) covers browser checks.

## Project and chat integration

- **Thread launch** shows the conversation's tasks and chat project, with
  **Add chat project** when registration is needed.
- **Global launch** shows tasks across conversations and offers project selection,
  **All chats** and **Manage**.
- Opening an explicit owned task uses its scope. Conflicting task, conversation,
  repository or revision arguments are rejected.

Explicit launch context takes precedence over optional host hints and owned
conversation history. Global history never selects a project implicitly. See
[Host capabilities](host-capabilities.md#project-context-and-registration) for
context resolution and host support.

On narrow panels, header actions move into **Panel actions**, including
**Settings**, with **Add chat project** first when registration is needed.

Project dropdowns include a search field that matches saved names and repository paths.

Changing scope invalidates reads, clears old evidence and closes unsent forms.
A mutation already submitted cannot be retracted or automatically retried. Its
late result never selects work into the new scope. Task creation validates
approved project containment. Worktrees start from a committed revision.

Inline mode shows a compact scope/count/status summary. **Open panel** requests
fullscreen only when the host advertises it. Collapse preserves selection and
form drafts. A standalone console always shows the full layout. The host owns
placement and available display modes. See [Host capabilities](host-capabilities.md).

### Manage projects

**Manage** is available only in global mode. It opens a full-width Projects page
with **Back to Tasks** to return to the previous task view. The page lists saved
names and repository paths, including parent approvals. **Add project** opens a focused
dialog for entering a path or using the service host's folder picker.
Click a project name to edit it inline, like a task title. Press Enter or click outside to save, or press Escape to cancel. Renaming changes
the display name only. Names may repeat because paths identify projects.

Removal asks for confirmation. By default it removes the saved registration while
preserving files, task history and worktrees. Running turns may finish. Later
turns require approval. Parent grants still apply, and automatic chat registration
can add the repository again when a task starts from its chat. Parent approvals
configured in `CODEX_SUBAGENT_EXTENSION_ALLOWED_ROOTS` return on service restart.
Remove them from that configuration to keep them removed.

**Also remove extension task data**, off by default, stops and removes that repository's
tasks across all chats, matching its exact saved repository path. Removing a
parent approval does not remove descendant repositories' tasks. Removal includes
conversations, activity, requests and task worktrees/branches with uncommitted changes. Checkout files
and provider sessions remain. Tasks in other projects that depend on these tasks
block removal before cleanup starts. Dependent tasks within the repository are removed first.
If cleanup fails, the approval and remaining tasks stay available for retry.
The error warns that earlier task removals cannot be undone.

Removing the selected project returns to **All projects** and clears stale task
selection and dialogs while keeping the Projects page open. Other panels reconcile registry changes on their next
refresh. Rename drafts survive refresh and failed saves. Destructive choices
are not restored after reload.

## Tasks and settings

### Find and inspect tasks

The task rail searches and filters by **Unread**, **Needs input**, **Failed**,
**Active**, **Done**, then **All**. The default is the first nonempty filter
other than Unread. Questions and
permissions count as Needs input. Failures, interruptions and compaction
failures count as Failed. Other unfinished tasks count as Active. Queued follow-up turns
keep a task active between runs. Unread applies across the other filters. See
[Read and unread tasks](#read-and-unread-tasks). Counts respect project and
search filters.
Press `/` for search and Escape to clear it.

Each row shows the task title, then the worker profile icon, runtime and status
icon. Hover the icon for the worker's name. Under **All projects**, tasks are
grouped under a header for each project. A project's group appears where its
newest task would be, and the header stays at the top while its rows scroll.

Wide panels show the task rail and inspector together. Narrow ones switch
between them with a back action. Drag the divider to resize the rail, or focus
it and use Left/Right arrows. Home/End choose its limits and double-click restores
the default. The width is saved when browser storage is available.

Details includes task creation and latest activity dates, description, worker,
revision, turns, budgets, session, workspace/branch, changes, dependencies and
usage. Dates follow the host locale and time zone. Runtime in the rail and
Details accumulates across turns and includes the active run.

### Read and unread tasks

A task becomes unread when it has something you haven't viewed: a worker
message or reply, a turn's end, a failure, or a question or permission request.
Your own messages never make a task unread. Unread tasks show an accent dot after
the worker icon in their row, and the compact panel adds **N unread** to its
counts.

A task becomes read when its Chat is on screen and scrolled to the latest
message: the panel must be visible, on the Tasks page and the Chat tab. Only
loaded content counts as read. A new reply stays unread until Chat shows it.

Opening an unread task places a **New** divider above the first worker message,
outcome or failure after what you had read, and Chat opens with the divider at
the top. If everything new fits on screen, the task is read at once. Otherwise
it stays unread until you scroll to the latest message, and the
**Scroll to unread messages** button carries a dot. The divider stays until you
leave the task or mark it read. A task you marked unread with nothing new opens
at the end.

- Use **Task actions → Mark unread** or **Mark read** to change read state
  manually. These actions also appear when you right-click a task row or
  long-press it on touch. A task you mark unread
  while reading it stays unread until you scroll its Chat or open another task.
- A reply's copy button row has **Mark unread from here**, an eye icon. It
  marks the task unread from that reply on, so earlier messages stay read. The
  **New** divider moves above that reply and scrolls into view when needed.
- **Unread** lists unread tasks. The task you open stays listed after it is
  read until you choose another, and the filter is never picked by default,
  since reading empties it. **Mark all read** beside the count marks every
  listed task. With no search to clear, it takes **Clear filter**'s place.

The standalone console's tab title leads with the unread count, as in
**(2) Delegated Work**. Read state is stored by the service, so the embedded
panel and the standalone console agree and it survives reloads. Codex reading
replies through `get_agent_messages` doesn't mark tasks read.

### Create and rename tasks

Global launch offers **New task** and **Advanced task…** from the split button
or, on narrow panels, **Panel actions**.

**New task** opens a draft in the inspector. Your first message becomes the
request: Enter starts the task and Shift+Enter adds a line. Choose the project,
profile, model, reasoning and permission mode below the message. Selecting a
profile resets model and reasoning to that profile's settings. Read-only profiles
keep read-only permissions. Expand the profile summary to edit individual choices.
Workspace, revision and budgets use your settings defaults.

**More options…** carries the draft into Advanced task, where you can also set
explicit context, workspace/revision, approval decision maker, dependencies and
budgets. **Wait for tasks** searches titles or IDs within the selected project
and accepts multiple dependencies. Unsupported cost budgets block submission.
The form explains that Claude checks cost after each response, so a response
can exceed the limit.

Neither form changes settings or attaches conversation text automatically.
Controls that need defaults or worker availability wait for those reads. Leaving
the composer retains its draft until it is sent or the panel reloads. Changing
to chat scope closes it. Existing tasks show their starting profile, model,
reasoning and permission mode below Chat. Later turns keep these choices.

The service derives a title from the request. Click the inspector title to edit:
Enter or an outside click saves, Escape cancels, and blank or failed saves stay open.

### Edit settings

**Settings** opens a full-width page with **Back to Tasks** to return. It
supports per-section resets, validates budgets and asks before discarding unsaved
edits. **Save** sends changed fields and keeps the page open. Section changes
preserve drafts. Failed reads offer a retry. See
[Configuration](configuration.md) for permission and approval defaults.

Per-task tabs, composer drafts/visibility, question answers, Chat/Activity
reading positions and the Changes position, opened files and viewed files last
for the panel session. The standalone console and development host also persist view state and
dialog form drafts across reloads. The production embedded panel keeps them
only while mounted. For the storage boundaries, see [State and persistence](panel-architecture.md#state-and-persistence).

## Chat tab

The inspector offers Chat, Activity, Changes and Details. Chat shows requests,
follow-ups, worker messages, replies and turn outcomes. Worker and parent-agent
text renders as Markdown under the
[shared Markdown rules](../src/panel/features/file-preview/README.md#markdown).
User text shows as typed. Draft replies stream until replaced by their stored
message.

Turn outcomes show duration, cost and time, with actions to copy a response,
ask Codex about it or view that turn's activity. Hover a timestamp for its full
date and time. Failures retain their error. Notes mark compaction, new sessions
and recreated worktrees.

| Composer action                   | Behavior                                               |
| --------------------------------- | ------------------------------------------------------ |
| Enter                             | Start an idle task's next turn, or queue during a run. |
| Cmd/Ctrl+Enter during a run       | Steer the running turn after its next tool call.       |
| Shift+Enter                       | Insert a newline.                                      |
| Waiting for a question/permission | Messages can only be queued.                           |

### Steering, queues and budgets

Pending steers offer **Interrupt and send now**. Queued messages offer Edit and
Remove. During a run, **Steer** sends a queued message into the current turn
after its next tool call, preserving its sender. Steer is unavailable while the
worker waits for input or for a steer already sent to the worker. Queued messages
can be reordered by dragging or with Alt+Up/Alt+Down on a focused
message. A paused queue offers Resume and Clear. An unconsumed steer stays at
its front and can't be moved or passed. Sending the next message also resumes a
paused queue. When a budget is exhausted, Chat shows the relevant cost and
runtime controls together in the warning notice. **Apply** saves a higher limit
without sending a message. Limits can only increase.
The composer can be hidden while retaining its draft. Stop remains available.
Every pending question or permission request collapses it automatically,
including requests opened through **Review request**. It can be reopened to
queue a message without changing its ordinary visibility preference.

### Questions and permissions

Questions appear as inline cards, with single/multiple choices, custom answers,
skips and **Respond**. Several questions form a navigable stack. Switching tasks
preserves unsent answers until reload. Permission requests show their complete
payload in Chat, with commands formatted as code and **Deny**/**Approve** actions
available inline. You can add a message before deciding. Requests
default to deny. Replies include the exact request ID. The service rejects
stale answers. Mutations are never automatically retried.

### Reading and loading

Chat follows new messages while the reader is at the end. Scrolling into history
preserves the visible message as replies stream or earlier pages load, and a
button above the composer returns to the latest message. Reduced motion turns
that return into an immediate jump.

Loading preserves navigation and shows a placeholder until content arrives.
An empty conversation says **No messages yet.**

## Activity timeline

Activity lists events oldest first. It groups related tools, hooks, background
work, streamed responses and routine updates while keeping messages, failures
and lifecycle transitions distinct. Progress moves an operation to the end.
Stopped or cancelled work never appears successful. Thinking shows elapsed time,
and rate-limit groups show the latest reported utilization and reset time for
each window. Turn outcomes include duration, token usage and cumulative session
cost.

Chat holds complete replies. Activity keeps response previews and original SDK
events for inspection: **Debug details** exposes readable content, metadata and
raw JSON. Raw JSON renders only when its disclosure opens. Times use the host's
locale and time zone.

Like Chat, Activity follows new content at the end and preserves position while
you read history. Each tab remembers its own position and offers a return to the
latest content. Reduced motion suppresses animation.

**View activity** on a Chat outcome opens that turn. Recent turns scroll into
view. Older turns load separately under **Showing activity for turn n** until
**Show latest activity** or another task is selected. A turn includes events
after the previous closing status through its own, including queued messages
delivered as the turn ends.

The latest view keeps the most recent 200 events and tallies earlier events in a
trimmed-history note. Open debug disclosures survive refresh while their rows
remain in that window. `get_agent_events` exposes the full stored history. An
empty feed says **No activity recorded yet.**

## Changes tab

Changes shows the task's recorded tool edits. The tab count loads in the
background. The file list and diffs load when Changes opens. Reads refresh on
task status or turn changes, when stale Changes opens, or with **Refresh changes**.
**Whole task** is the default. **This turn** appears after multiple turns and shows
the latest turn's edits. Failed and interrupted turns keep their recorded edits.

### Change comparisons

The panel, agent tools and dependency prompts read the same stored net diffs in
both workspace strategies. A reverted file drops out. Committing files, removing
a worktree or deleting its branch leaves the recorded diff available.

Files edited by a command have a **command** tag and the note **Changed by a
command.** An incomplete file shows **An edit to this file wasn't recorded.**,
without a diff. It counts as a file but adds no lines to the totals. Once a
file's record becomes incomplete, later edits cannot restore that scope's diff. When a command's changed paths could not be captured, the tab
shows **Some changes made by commands weren't recorded.**

Claude's edit tools and Bash commands are recorded. File-writing MCP tools and
processes a command leaves running are outside the record. Some Git checkout
commands, such as `git restore file.txt`, produce the command warning without
file diffs. Other Git commands can return precise diffs or no edit data.
Read-only commands with no edit data create no warning. Highly repetitive text can
produce a valid diff that is not minimal. An `Edit` to an existing empty file
appears as added. Renames appear as a deletion and an addition. See
[the change tools](mcp-reference.md#recorded-changes) for paging and read access.

### Diffs and file previews

Expand a file to read its diff or open **Preview** for format-specific views.
File previews show the file as it is now, including later edits by others.
Images can preview. Deleted files show removed lines. Files without a matching
diff are marked **Diff unavailable**. Long lists open only the first file by
default and remember your choices. Large files defer offscreen rendering. See
[file previews](../src/panel/features/file-preview/README.md#large-content) for
limits.

Refresh keeps the last result visible and marks it stale on failure. Changing
comparison scope clears the old result. When stepping between previews, the
current file stays visible with progress until the next file loads.

**Viewed** marks a file read and collapses it. Further changes to the file make
it unread and reopen it. **Preview all** starts at the first
unviewed file. In the preview, marking a file viewed advances to the next unread
one, wrapping to the start. Previous and Next step through the full file list.
The chosen view carries across files.

**File preview options → Wrap lines** wraps source and diff lines. Wrapping is
off by default, and your choice lasts while the preview remains open. **Ask Codex about this file**
opens the handoff flow described below.

### Worktree actions

Worktree headers offer branch/path and copyable checkout/diff/push commands.
**Remove worktree** keeps the branch and asks before discarding uncommitted
changes. **Delete branch** asks separately after removal. These actions are
disabled during work or when change reads are loading/failed. A later message
recreates the worktree from its branch, or base commit if the branch was deleted.
The panel does not apply or push changes.

## Handoff and deletion

**Bring to Codex**, called **Copy for Codex** in the console, prepares an editable message
with the latest reply and pointers to message/change tools. Delivery is offered
only when supported by the host and requires submission. Otherwise copy the
text. In thread mode, **Ask Codex about this reply/file** opens the same editable
message flow for the exact reply or file selected. It includes an excerpt and
identifiers for retrieving the full conversation or file changes. Nothing sends until you submit.
Closing or sending a file handoff returns to the file preview. Hosts without
message delivery offer text to copy manually.

Selecting a task can share its identity when supported. Context sharing never
blocks inspection or triggers an automatic follow-up.

The task heading's **Task actions** menu includes handoff and deletion.
**Delete task** stops running, queued or waiting work, then removes task history,
requests, recorded edits, the worktree and branch.
Current-repo files stay intact. **Also delete the agent task**, off by default,
also removes the provider session. Provider cleanup failure retains the local
task for retry. Later cleanup failure can leave earlier resources removed.
Dependent tasks must be deleted first.

## Transport

The embedded panel uses the authenticated MCP Apps bridge without direct service
fetches or credential entry. It long-polls for revisions and running reply drafts.
The standalone console uses authenticated HTTP and SSE. Failed connections show
**Reconnecting…** and retry with backoff.

Refreshes preserve forms and reading positions. Hidden or submitting panels defer
refresh until ready, and a periodic fallback catches changes the service cannot
announce. Changes has its own refresh rules, described above. See
[Host capabilities](host-capabilities.md) for embedded network restrictions and
[Local development](development.md#what-reloads-when) for applying source changes.
