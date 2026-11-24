# Delegated Work panel

Use this guide to operate Delegated Work or check its user-visible behavior. The
embedded panel and [standalone console](development.md#run-the-service) share
one frontend.

- [Panel architecture](panel-architecture.md) covers implementation, including
  [loading and pending UI](panel-architecture.md#loading-and-pending-ui).
- [Local development](development.md) covers setup.
- [UI verification](ui-verification.md) covers browser checks.

## Project and chat integration

- **Thread launch** shows the conversation's tasks and chat project. It offers
  **Allow tasks here** when the project needs registration.
- **Global launch** shows tasks across conversations and offers project
  selection and **All chats**.
- Opening an owned task uses that task's scope.

Global history never selects a project. See
[Host capabilities](host-capabilities.md#project-context-and-registration) for
how the panel resolves context.

Project dropdowns include a search field that matches saved names and repository
paths. On narrow panels, header actions such as **Settings** move into **Panel
actions**, with **Allow tasks here** first when needed.

Changing scope closes unsent forms. An action you already submitted still
completes, but its result never selects work in the new scope.

Inline mode shows the scope, nonzero counts and one task. Click the task to open
it, or **Open panel** to expand when the host supports it. Returning to inline
mode keeps the selection and form drafts.

### Manage projects

**Manage projects…** appears last in the global project dropdown. It opens a
full-width Projects page that lists saved names and folder paths, including
parent approvals. A folder without Git or a repository with no commit shows a
slashed icon beside its name, and its note explains the effect. **Back to
Tasks** returns to the previous task view.

- **Add project** opens a dialog where you enter a path or use the service
  host's folder picker.
- Click a project name to rename it. Enter or an outside click saves, and Escape
  cancels. Names may repeat because paths identify projects. Rename drafts
  survive refresh and failed saves.
- **Remove project** asks for confirmation.

By default, removal deletes only the saved registration. Files, task history and
worktrees remain. Running turns may finish, and later turns need approval again.
Parent approvals still apply, and starting a task from the repository's chat can
register it again. Parent approvals set in
`SUBAGENT_EXTENSION_FOR_CODEX_ALLOWED_ROOTS` return when the service restarts
unless you remove them from that setting.

**Also remove extension task data**, off by default, stops and removes every
task with that exact repository path across all chats. This includes
conversations, activity, requests, and task worktrees and local branches with
uncommitted changes. Checkout files remain. Turn on **Also delete the agent
tasks** to remove their provider sessions too. Removing a parent approval leaves
descendant repositories' tasks in place.

- Dependent tasks in the same repository are removed first.
- Dependent tasks in other projects block removal before cleanup starts.
- If cleanup fails, the approval and remaining tasks stay available for retry.
  The error warns that earlier removals cannot be undone.
- The confirmation lists the project registration and each task resource it will
  remove. If tasks or resources change, refresh the list and review it again.

Removing the selected project returns the task list to **All projects**.

## How tasks run

- **Workspace.** Tasks work in the approved checkout by default, including its
  uncommitted changes. Choose `worktree` to work from a committed revision in a
  separate checkout. The service never merges changes. Worktrees separate
  checkouts but don't restrict commands, so they aren't security sandboxes. See
  [Worktree actions](#worktree-actions).
- **Folders without commits.** Worktrees need a Git repository with a commit, so
  tasks in other folders edit them directly. Without Git, those edits can't be
  undone with Git. If your default is a worktree, the task uses the project
  folder and warns you that it isn't isolated.
- **Permissions.** The researcher and reviewer profiles start in plan mode,
  which asks before edits. The implementer profile follows your saved
  [Claude permissions](configuration.md#claude-permissions). All follow your
  [session restrictions](configuration.md#claude-session-restrictions).
- **Budgets.** Runtime and cost budgets span turns. Claude checks cost after
  each response, so a response can exceed the limit. Costs are estimates at API
  list prices, and cost limits apply to these estimates. See
  [Steering, queues and budgets](#steering-queues-and-budgets).

## Tasks and settings

### About

**Settings > About**, the last section, provides copyable diagnostics for bug
reports, including the selected CLI path and the data directory. Local commit
and working tree details describe the build or source startup. Rebuild to update
a built service's snapshot, or restart a service running from source.

**Built at** shows the build time in local time. Copied diagnostics include its
exact UTC timestamp. Source runs show **Not recorded**, since they have no
build.

The upgrade icon beside the CLI version expands guidance and **Recheck
version**. See [Upgrade guidance](claude-cli.md#upgrade-guidance) for supported
installations and fallbacks.

### Find and inspect tasks

The task list offers search and these filters:

| Filter          | Tasks                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------- |
| Unread          | Tasks with something you haven't seen. See [Read and unread tasks](#read-and-unread-tasks). |
| Needs attention | Tasks waiting on a question, permission request, blocked wrap-up or rate limit reset.       |
| Failed          | Errors, reached limits, service restarts and compaction failures.                           |
| Working         | Other unfinished tasks, including tasks with queued follow-up turns.                        |
| Done            | Completed tasks and tasks you stopped.                                                      |
| All             | Every task.                                                                                 |

The default is the first nonempty filter after Unread. Counts respect the
project and search filters. Press `/` to search and Escape to clear it.

Under **All projects**, tasks group by project, ordered by each group's newest
task. Project headers stay visible as their rows scroll.

Each row shows the worker icon, the title, [plan](#chat-tab) progress such as
`3/7`, and at most one dot: yellow when the task needs input or waits for a rate
limit, gray while it is queued, pulsing gray while it works, and the accent
color when it is unread. An idle task shows its worker's open question under the
title. Hover a long title to see the rest. **Details** shows the task's total
runtime. **Settings > Appearance** can hide worker icons.

- Click a project header to collapse its group. The panel remembers collapsed
  groups across reloads where browser storage is available.
- A collapsed header shows its task count, and dots when a hidden task needs
  attention, works or is unread.
- When several projects are listed, a long group shows its first five tasks and
  **Show N more**, which flags hidden tasks the same way. **Show less** folds it
  again. The selected task always stays listed. Searching shows every match.
- Choosing a task from outside the list, such as from a toast, opens its group.
- **Show only this project** in the header's actions menu selects that project.

While you view a task, a toast announces new tasks in the current scope.
**View** opens the task. The current task, draft, reading position and focus
stay in place until you navigate. If several other tasks arrive together, the
toast shows the newest one. Notifications stay quiet while you compose a task,
have a dialog open, wait for a submitted request or browse the list or another
page.

Use the header's task list toggle to show or hide the list. Wide panels show a
resizable list beside the inspector and remember its width and collapsed state.
Narrow panels switch between the list and task content without changing those
preferences.

### Act on several tasks

Command-click a row (Ctrl-click on Windows or Linux), press Shift+Space on it,
or choose **Select task** after right-clicking or holding it. Click or press
Space to toggle more rows. For a range, click either endpoint, then Shift-click
the other.

The list header shows the selection count. Right-click or hold the list, or
press Shift+F10, to archive the selection, mark it read or unread, or select all
shown rows. A row you right-click joins the selection, and selections in
collapsed groups still count. **Undo** reverses the whole action. Press Escape
or click blank space to exit. Changing the search, filter, project, or
conversation clears the selection.

### Read and unread tasks

A task becomes unread when it has a worker message or reply, a turn end, a
failure, or a question or permission request you haven't seen. Your own messages
never make a task unread. The compact panel adds **N unread** to its counts.

A task becomes read when its Chat tab shows the latest message. Opening an
unread task places a **New** divider above the first unseen item and scrolls to
it.

- **Task actions → Mark unread** or **Mark read** changes read state.
  Right-click or long-press a task row for the same actions.
- **Mark unread from here**, the eye icon on a reply, marks the task unread from
  that reply on.
- **Mark all read** beside the filter count marks every listed task.

The service stores read state, so the embedded panel and the console agree and
the state survives reloads. The console's tab title starts with the unread
count. Codex reading replies through `list_messages` doesn't mark tasks read.

### Archive tasks

Archiving hides a stopped task with nothing waiting from the task list.

- Hover over a task row or focus it with the keyboard to reveal **Archive
  task**. You can also choose **Archive** from **Task actions** or from the
  row’s context menu (right-click or long-press).
- Under **All projects**, each project header has an actions menu. **Archive
  completed** archives the project's completed tasks in the current scope, and
  **Archive all** archives every stopped one. Search and filters don't limit
  either action.

Archiving also removes a task's worktree when it has no uncommitted changes,
keeping its branch. A worktree with uncommitted changes stays. Unarchiving or
undoing leaves a removed worktree removed, and the next message recreates it.

Archiving a Claude task also archives its Claude session. Unarchiving or undoing
unarchives it. A message that returns the task to the list unarchives it once
its prompt reaches the session. A session that can't be archived doesn't stop
the task archive.

The **View archived tasks** icon beside a project on the Projects page lists
that project's archived tasks from any chat, newest first. Select tasks to act
on them, or select none to act on all.

- **Unarchive** returns the tasks to the task list.
- **Delete** asks first, then deletes the tasks like **Delete task**. Turn on
  **Also delete the agent tasks** to include provider sessions.

A task also returns to the task list when Codex sends it a message.

### Undo and redo

Undo reverses your recent changes in the panel, up to the last 20.

| Keys                                | Action |
| ----------------------------------- | ------ |
| Cmd+Z or Ctrl+Z                     | Undo   |
| Shift+Cmd+Z, Shift+Ctrl+Z or Ctrl+Y | Redo   |

You can undo these changes:

- Archiving, unarchiving and renaming tasks.
- Marking tasks read or unread, including **Mark unread from here** and **Mark
  all read**. Undo puts back each task's **New** divider.
- Removing, clearing, editing and reordering queued messages.
- Adding, renaming and removing projects. Removing a project's tasks with it and
  removing a parent folder grant can't be undone.
- Changing the composer's model or reasoning, which saves the profile's default.
- Marking a file viewed in Changes.

Undo and redo always show a toast that says what changed, and name the task when
it isn't on screen. Pressing them again while the toast is open adds each step
to its list, and the toast's **Undo** or **Redo** button reverses every step it
lists. Quick presses all count, in order.

Archiving or unarchiving, removing or clearing queued messages, removing a
project, and bulk read changes show an **Undo** toast. Bulk changes list up to
three affected tasks or messages.

- If undo or redo fails, a warning toast says why, for example when a queued
  message was already sent. The panel forgets a change that failed entirely.
  When only some tasks fail, the ones that changed stay reversible.
- Text fields, open dialogs and the Settings page keep their own undo. Settings
  saves nothing until you choose **Save**.
- A new change clears what you could redo. The history lasts while the panel is
  open, including after you switch project or conversation.
- Undo puts removed queued messages back in their places with their original
  text and sender. A task that isn't working keeps them in a paused queue, so
  undo never starts a turn.
- Undoing an archive reopens the task that archiving closed, when the current
  task list includes it.

Sending, steering, interrupting, resuming a queue, answering requests, raising
budgets and deleting can't be undone.

### Create and rename tasks

**New task** and **Advanced task…** are on the split button, or in **Panel
actions** on narrow panels. In a thread panel, new tasks belong to that
conversation.

**New task** opens a draft in the inspector. Your first message becomes the
request. Enter starts the task and Shift+Enter adds a line. Below the message,
choose the project, profile, model, reasoning and permission mode. Selecting a
profile resets model and reasoning to the profile's settings and the mode to its
default. A read-only profile starts in plan mode, and other profiles use your
saved mode. The mode you choose applies to this task only. Expand the profile
summary to change individual choices.

**Add project…** at the end of the project menu opens **Add project**. The added
project becomes the composer's choice, and the task list keeps its project
filter.

The model and reasoning chips edit the selected profile's settings, so the
profile starts with your last choice next time. **Default** clears the profile's
setting and names the provider default it then inherits. A failed save shows an
error below the composer, and the choice still applies to the task. Workspace,
revision, budgets and the Bash sandbox use your settings defaults.

**More options…** carries the draft into **Advanced task**, which adds workspace
and revision, approval decision maker, Bash sandbox and budgets. The mode and
sandbox apply to this task only. Saving them would change later tasks, including
those agents start, so change the defaults in **Settings**. The form blocks
unsupported cost budgets and notes that a response can exceed the cost limit.

Neither form attaches conversation text, and Advanced task does not change
settings. The composer keeps its draft until you send it or the panel reloads.
Switching to another conversation closes it. Existing tasks show their starting
profile, model, reasoning and permission mode below Chat, and later turns keep
them.

The service derives a title from the request. Click the inspector title to edit
it. Enter or an outside click saves, Escape cancels, and a blank or failed save
stays open.

### Edit settings

**Settings** opens a full-width page with **Back to Tasks**. It offers
per-section resets, validates budgets and asks before discarding unsaved edits.
**Save** sends changed fields and keeps the page open. Drafts survive switching
sections, and failed reads offer a retry. See [Configuration](configuration.md)
for permission and approval defaults.

**Inherit** names the model and reasoning a row lands on: a profile's Claude
setting, then the runtime default, which Claude Code or your organization sets.
See [Org policy](configuration.md#org-policy).

Search settings by section name, label, description, setting path or choice.
Press `/` to start searching. Results appear together under section headings and
remain editable. The count includes each setting row, profile row or About
detail once, and **Organization policy** counts once as a whole. Matching words
are highlighted, and choice or alias matches explain why the result appears. For
example, “timeout” finds Runtime limit and “spending” finds Cost limit.
Searching for custom instructions opens matching instruction editors.

Search keeps drafts and stays open after saving. **Save** includes changes
outside the current results. Clear search or press Escape in its field to
restore your browsing section, scroll position and expanded editors. An invalid
hidden field clears search and receives focus. Section resets are available
after clearing search.

Use **Import and export** to save, copy or import your defaults as JSON. Save
your settings changes first. If copying fails, select and copy the text shown in
the panel. For exported settings and file locations, see
[Copy settings between computers](configuration.md#copy-settings-between-computers).

Tabs, drafts, answers, reading positions and viewed files last for the panel
session. The standalone console and development host also keep view state and
dialog drafts across reloads. See
[State and persistence](panel-architecture.md#state-and-persistence) for what
each host keeps.

## Chat tab

The inspector offers Chat, Activity, Changes and Details. Chat shows requests,
follow-ups, worker messages, replies and turn outcomes. Reports the worker sends
to Codex appear in Activity only. Worker and parent-agent text renders as
[Markdown](../src/panel/features/file-preview/README.md#markdown), and your text
shows as typed. Draft replies stream a paragraph at a time, and the stored
message replaces them, adding the last paragraph. Code blocks in Chat and
Activity have a copy action in their header.

[Attachments](mcp-reference.md#attachments) on the request or a follow-up show
as chips under it, with a summary on hover or focus. Chips that don't fit fold
behind **+N more**, and a chip opens its attachment in a file viewer.

In **New task** or a follow-up, choose **Attach files**, drop files onto the
composer, or paste a copied file or screenshot. You can attach UTF-8 text, PNG,
JPEG, GIF and WebP files. Each message allows up to 20 files, 2 MiB each and 10
MiB total. Remove a file from the draft by selecting its remove button.

Your messages offer **Copy message** and the time sent. Actions appear on hover
or keyboard focus, and stay visible on touch devices.

Turn outcomes show duration, estimated cost and time. Their actions copy the
response, ask Codex about it or open that turn's activity. Hover or activate a
timestamp for its full date and time. Failures keep their error. Notes mark
compaction, new sessions and recreated worktrees.

A worker's [plan](mcp-reference.md#worker-plans) shows as a card above the
working status until it finishes or its turn ends, then stays in Chat as a
collapsed row. After you message the worker mid-turn, the card reads **Plan from
before your last message** until the worker updates it.

A worker's [wrap-up](mcp-reference.md#worker-wrap-ups) shows in a box under its
reply: a recap, then any question with buttons that answer it. A reply button
sends its label as your message. Buttons show on the latest turn until you or
Codex send the next message. A worker that can't go on until you answer marks
the task **Needs input** until that message.

[Visuals](mcp-reference.md#worker-visuals) a worker shows, such as charts and
diagrams, show in Chat in the panel's theme. Each runs in a sandboxed frame
without network access. A link you click in a visual shows below it, and opens
outside the panel from there. The menu in a visual's corner copies its code or
downloads it in the current theme, as an HTML page or, for one sized SVG, a PNG.

| Composer action                   | Behavior                                               |
| --------------------------------- | ------------------------------------------------------ |
| Enter                             | Start an idle task's next turn, or steer during a run. |
| Cmd/Ctrl+Enter during a run       | Queue a later turn.                                    |
| Shift+Enter                       | Insert a newline.                                      |
| `/` at the start of a message     | List the task's commands. Enter or Tab completes one.  |
| Waiting for a question/permission | Messages can only be queued.                           |

A failed send keeps the draft and its error. Unless the service confirms that it
rejected the message, the error says delivery could not be confirmed. This
covers lost responses and 30 seconds without confirmation, after which the panel
stops waiting. The service may still accept the message. Sending the same text
again from the same panel reuses the original request, so it can't create a
duplicate. A late confirmation clears the unchanged draft. After a reload, check
Chat before resending. See
[Retrying message sends](mcp-reference.md#retrying-message-sends) for the
service rules.

### Steering, queues and budgets

- **Steer** sends a queued message into the current turn after its next tool
  call. It is unavailable while the worker waits for input or for an earlier
  steer.
- A pending steer offers **Interrupt and send now**. An unconsumed steer stays
  at the front of the queue.
- Queued messages offer **Edit** and **Remove**. Reorder them by dragging, or
  with Alt+Up and Alt+Down on a focused message. See
  [Undo and redo](#undo-and-redo) to reverse these changes.
- A paused queue offers **Resume** and **Clear**. Sending the next message also
  resumes it.
- A task holds at most 10 waiting messages, queued or steered.
- A message that starts with a Claude Code command, such as `/compact` or a
  skill's `/name`, runs in a turn of its own. Sent while the task is busy, it
  waits at the front of the queue. A command fails when the task's session can't
  resume. Skills and plugin commands always run. Claude Code's own commands run
  only once checked to work in a task. The rest, such as `/model`, `/clear` and
  `/config`, are refused and left out of suggestions.
- When a budget runs out, Chat shows the cost and runtime limits in a warning.
  **Apply** saves a higher limit without sending a message. Limits can only
  increase.

You can hide the composer and keep its draft. A pending question or permission
request collapses it.

The first run setting estimates how long the task's prompt cache stays warm. A
reply sent before it runs out reuses the cached conversation and costs less. The
next shows how full the context window was after the latest response, with a
breakdown in its tooltip.

### Questions and permissions

Questions appear as inline cards with single or multiple choices, custom
answers, skips and **Respond**. Several questions form a stack you can step
through. Unsent answers survive switching tasks until reload.

Permission requests show their full payload in Chat, with commands formatted as
code. Add an optional message, then choose **Deny** or **Approve**. Requests
default to deny.

### Reading position

Chat and Activity follow new content while you are at the end. Chat glides to
new content as incoming messages and streamed paragraphs expand and fade in. The
working status stays above the composer as the conversation scrolls. Sending a
message returns Chat to the latest content and resumes following. Replies keep
their place when the saved message arrives. When you scroll into history, your
position holds as content streams or loads, and a button returns to the latest
content. Each tab remembers its own position.

## Activity timeline

Activity lists events oldest first. It groups related tools, hooks, background
work, streamed responses and routine updates, and keeps messages, failures and
lifecycle changes separate. Progress moves an operation to the end. Stopped or
cancelled work never appears successful.

- Worker and parent-agent text renders as Markdown, as in Chat. Your messages
  and tool output show as written.
- Thinking shows elapsed time.
- Rate-limit groups show the latest utilization and reset time for each window.
- Turn outcomes show duration, token usage and cumulative session cost.
- File tool rows show the path and options. Successful results show "File
  content isn't stored." The **Changes** tab shows the edits, and tasks run with
  full events also show file contents.
- **Debug details** shows an event's readable content, metadata and event data
  JSON. Tasks run with [full events](configuration.md#environment-variables)
  also show the original Claude response. Objects and arrays below the second
  level start folded.

**View activity** on a Chat outcome opens that turn. Recent turns scroll into
view. Older turns load separately under **Showing activity for turn n** until
you choose **Show latest activity** or another task. A turn covers the events
after the previous turn's closing status through its own, including queued
messages delivered as it ends.

The latest view keeps the most recent 200 events and counts earlier ones in a
trimmed-history note. `list_events` returns the full history.

## Changes tab

Changes shows the task's recorded tool edits. It refreshes when the task's
status or turn changes, when you open a stale tab, or when you choose **Refresh
changes**.

**Whole task** is the default. **This turn** appears after several turns and
shows the latest turn's edits. Failed and interrupted turns keep their recorded
edits.

### Change comparisons

Changes shows net diffs, so a reverted file drops out. Committing files,
removing a worktree or deleting its branch keeps the recorded diff.

- Files edited by a command have a **command** tag.
- A file with an unrecorded edit shows **An edit to this file wasn't recorded.**
  without a diff.
- When the service couldn't capture a command's changed paths, the tab shows
  **Some changes made by commands weren't recorded.**
- In a folder without Git, the tab says edits made by commands may be missing
  after any command, and `git init` records them from the next turn.

The service records Claude's edit tools and Bash commands. See
[Recording limits](mcp-reference.md#recording-limits) for what it misses.

### Diffs and file previews

Expand a file to read its diff, or open **Preview** for format-specific views.
Previews show the file as it is now, including later edits by others. Deleted
files show removed lines. Files without a matching diff show **Diff
unavailable**. Long lists open only the first file and remember your choices.
See [file previews](../src/panel/features/file-preview/README.md#large-content)
for supported formats and size limits.

**Viewed** marks a file read and collapses it. A later change to the file makes
it unread again. **Preview all** starts at the first unviewed file, and marking
a file viewed in the preview moves to the next one.

With two or more files, a floating **Files** button stays near the bottom while
you scroll. It opens a file tree grouped by folder, with status letters, viewed
checks and a highlight for the file being read. Picking a file opens its diff
and scrolls it to the top, adding space after the last file when needed. The
navigator stays open between picks. Collapse it with its close button, **Files**
or Escape. It starts collapsed when you open Changes.

**File preview options → Wrap lines** wraps source and diff lines. **Ask Codex
about this file** opens the [handoff flow](#handoff-and-deletion).

### Worktree actions

Worktree headers show the branch and path, with copyable checkout, diff and push
commands.

- **Remove worktree** keeps the branch and asks before discarding uncommitted
  changes.
- **Delete local branch** asks separately after removal. Remote branches stay.

These actions are disabled while the task works or while change reads are
loading or failed. A later message recreates the worktree from its branch, or
from the base commit if the branch was deleted. The panel never applies or
pushes changes.

## Plan usage

With a Claude plan sign-in, turn on **Settings > Appearance > Plan usage meter**
to show the most-used usage window's percentage beside **Settings**. Hover or
tap it for every window and its reset time.

## Pending worker updates

In thread mode, the header counts worker updates Codex hasn't seen: turn
replies, failed turns, budget stops, blocked wrap-ups and questions or
permission requests routed to Codex. The count turns the warning color while a
worker waits for an answer. Codex sees an update when it reads it with
`list_messages`, or a reply with `get_message`. Archived and deleted tasks don't
count.

Select the count to review the updates by task. **Send to Codex** sends the
checked ones in one message, and they stay counted until Codex reads them.
**Mark seen** stops counting them without telling Codex.

## Handoff and deletion

**Bring to Codex**, called **Copy for Codex** in the console, prepares an
editable message with the latest reply and pointers to the message and change
tools. In thread mode, **Ask Codex about this reply** and **Ask Codex about this
file** prepare the same kind of message for the selected reply or file, with an
excerpt and the identifiers needed to read the rest.

Nothing sends until you submit. Hosts without message delivery offer the text to
copy instead.

**Task actions** in the task heading includes handoff and deletion. **Delete
task** stops the task if it is working, queued or waiting, then removes the
task's history, requests, recorded edits, worktree and local branch. Files in
the project folder and remote branches stay intact.

- **Also delete the agent task**, off by default, also removes the provider
  session. It is unavailable when the service cannot verify where the session
  files are. With several tasks selected, one unverified session makes it
  unavailable for all of them, and the note names that task. Tasks without a
  recorded session don't block it. You can still delete the extension's task
  record and leave the provider session alone. If session cleanup fails, the
  local task stays for retry.
- Folder removal includes all contents. If a listed resource changes, refresh
  the removal list and review it again before deleting.
- A worktree outside the managed worktree folder and its local branch stay.
- A later cleanup failure can leave earlier resources removed.

## Transport

The panel updates as the service reports changes. Refreshes keep forms and
reading positions, and hidden or submitting panels wait to refresh. The header
shows connection status only when there is a problem. A failed connection shows
**Reconnecting…** in the header toolbar and retries, and a failed first
connection shows **Connection failed**. Narrow panels show a warning icon
instead, and hovering or tapping it shows the status. While a
[plugin update](task-continuation.md#updates-and-service-handoff) waits for
running turns to finish, the header shows **Updating…**. Changes has
[its own refresh rules](#changes-tab).

See [Panel network access](host-capabilities.md#panel-network-access) for how
each host connects and [Local development](development.md#what-reloads-when) for
applying source changes.
