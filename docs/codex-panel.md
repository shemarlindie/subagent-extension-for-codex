# Delegated Work panel

The embedded panel and standalone console share one frontend. This guide owns
user-visible behavior; [React UI architecture](react-ui.md) covers implementation,
[Local development](development.md) covers setup, and
[UI verification](ui-verification.md) covers browser checks.

## Project and chat integration

Task creation and both openers return the `ui://codex-subagent-extension/app-v6`
resource. Their `panel_scope` and `panel_selection` open the selected task on
Chat. Task creation preserves its ordinary `structuredContent.result` too.
Only explicit opener scope changes are applied; unrelated tool results do not
change the conversation.

- **Thread launch:** scopes tasks to the conversation, with a read-only project
  name/path and **Add chat project** when registration is needed.
- **Global launch:** shows all conversations and offers the project selector,
  **All chats** and **Browse** to register a repository.
- An explicit owned task supplies its own scope. Conflicting explicit task,
  conversation, repository or revision arguments are rejected.
- Context resolution prefers explicit arguments, then validated optional Codex
  directory metadata, then an owned task in the conversation. New task defaults
  can also use the selected task or only registered project. User preferences
  remain intact. `conversation_id: null` explicitly opts out of correlation.
- The adapter accepts local `sandboxCwd` file URIs through
  `codex/sandbox-state-meta`; explicit context wins and invalid hints fall back.
  Conversation correlation uses explicit arguments, `threadId` and
  `openai/session`. Actual desktop delivery must be checked in the host.

Changing scope invalidates reads, clears old evidence and closes unsent forms.
A mutation already submitted cannot be retracted or automatically retried; its
late result never selects work into the new scope. Task creation validates
approved project containment; worktrees start from a committed revision.

Inline mode shows a compact scope/count/status summary. **Open panel** requests
fullscreen only when the host advertises it; Collapse preserves selection and
form drafts. A standalone console always shows the full layout. The host owns
placement and available display modes; see [Host capabilities](host-capabilities.md).

## Panel behavior

The task rail searches and filters by **Needs input**, **Failed**, **Active**,
**Done**, then **All**. The default is the first nonempty filter. Questions and
permissions count as Needs input; failures, interruptions and compaction
failures as Failed; other unfinished tasks as Active. Queued follow-up turns
keep a task active between runs. Counts respect project and search filters.
Press `/` for search and Escape to clear it.

Wide panels show rail and inspector together; narrow ones switch between them
with a back action. Details includes description, worker, revision, turns,
budgets, session, workspace/branch, changes, dependencies and usage. Runtime in
the rail and Details accumulates across turns and includes the active run.

**New task** reads defaults and worker availability without changing settings.
It collects the request, explicit context, workspace/revision, dependencies and
budgets. Conversation text is not attached automatically. Unsupported numeric
cost budgets block submission; Claude's response-boundary limit is disclosed.
The service derives a title from the request. Click the inspector title to edit:
Enter or an outside click saves, Escape cancels, and blank/failed saves stay open.
`rename_user_agent_task` accepts a trimmed title of 1–200 characters.

**Settings** uses server-defined sections and rows, supports per-section resets,
validates budgets, and asks before discarding unsaved edits. Saving sends only
changed fields through the app-only `update_user_agent_settings`. Permission and
approval defaults are described in [Configuration](configuration.md).

Per-task tabs, composer drafts/visibility, question answers and Chat/Activity
reading positions last for the panel session. Browser view state and dialog
form drafts have separate reload persistence; see
[State and persistence](react-ui.md#state-and-persistence).

## Chat tab

Chat is the first inspector tab, followed by Changes, Activity and Details.
It shows requests, follow-ups, worker messages, replies and turn outcomes.
Worker text renders as Markdown; a reply that repeats the last message replaces
it. Outcome rows show turn, duration, cost and **View activity**; failures retain
their error. Notes mark compaction, new sessions and recreated worktrees.
Draft text streams with a caret and is replaced by its stored message.

| Composer action                         | Behavior                                                |
| --------------------------------------- | ------------------------------------------------------- |
| Enter                                   | Start an idle task's next turn or steer a running turn. |
| Shift+Enter                             | Insert a newline.                                       |
| Tab with text during a run              | Queue a message.                                        |
| Escape with composer focus during a run | Stop the turn.                                          |
| Waiting for a question/permission       | Messages can only be queued.                            |

Pending steers offer **Interrupt and send now**. Queued messages offer Edit and
Remove; a paused queue offers Resume and Clear. An unconsumed steer stays at
its front. Sending the next message also resumes a paused queue. When a budget
is exhausted, the composer offers to raise its limit; limits can only increase.
The composer can be hidden while retaining its draft; Stop remains available.
Questions collapse it automatically for the current request.

Questions appear as inline cards, with single/multiple choices, custom answers,
skips and **Respond**. Several questions form a navigable stack. Switching tasks
preserves unsent answers until reload. Permissions show the complete payload
and default to deny. Replies include the exact request ID; the service rejects
stale answers. Mutations are never automatically retried.

Chat follows new messages while the reader is at the end. Scrolling into history
preserves the visible message as replies stream or earlier pages load, and a
button above the composer returns to the latest message. Reduced motion turns
that return into an immediate jump.

Chat reads cursor-paged `get_user_agent_chat`; sending, queue editing and draft
reads use app-only tools. Stop uses `interrupt_agent_task`. See the
[MCP reference](mcp-reference.md) for tool contracts.

## Activity timeline

The timeline lists activity oldest first, like Chat. It groups tools, hooks,
background tasks, streamed responses and adjacent routine updates while keeping
original SDK events for inspection. Progress moves an operation's row to the
end. Messages, failures and lifecycle transitions remain distinct;
stopped/cancelled operations are not shown as successful. Thinking shows a live clock, then its elapsed time.

Activity scrolls like Chat: it follows new events while the reader is at the
end, preserves the visible row while they read history, and shows the same
button to return to the latest activity. The task header and tabs stay fixed
when enough height remains; a short frame scrolls the whole inspector.
Chat and Activity keep separate positions. Reduced motion suppresses animation.

Each row's debug button exposes readable event content, metadata and a raw SDK
response inspector. Raw JSON renders only when opened. Open disclosures survive
refreshes while their row remains in the most recent 200 events. A trimmed-tail
summary describes earlier events the panel has read; `get_agent_events` exposes
full stored history.

## Changes tab

Changes shows uncommitted task changes from Git, including untracked files and
excluding ignored files. It refreshes when opened, when status/turn changes, or
on **Refresh changes**. Committed work stays in Git history. **Whole task** is
the default; **This turn** appears after multiple turns.

The panel and agent APIs answer different questions:

| Consumer                                      | Comparison                                                                                                                                                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Panel (`get_user_agent_changes`)              | Uncommitted changes. Worktrees include all changed files; current-repo tasks include only files attributed to the task and omit pre-existing edits. Later outside edits to those files can also appear.                           |
| Agents (`get_agent_changes`) and dependencies | All attributed changes, committed or not. Worktrees compare base to current tree, or retained branch after removal. Current-repo tasks compare start snapshot to the live tree while running and recorded end snapshot otherwise. |

**Current-repo limit:** other edits between task start and its recorded end can
be attributed to the task. If an end snapshot was not recorded, changes cannot
be distinguished from later edits and the service reports that limitation.

Snapshots use a temporary Git index without changing the user's index or files.
They write blob/tree objects and pin task baselines under
`refs/agent-tasks/<task-id>/`; deleting a worktree task's branch removes its
snapshot refs. See `src/service/features/workspaces/changes.ts` for snapshot and paging
implementation; the browser-safe change contract lives in
`src/shared/workspaces/changes.ts`.

Files expand into complete diffs and previews. Binary files show size; images
can preview, deleted files show Deleted. Large content renders in deferred row
blocks, collapsed files unmount rows, and cursor pages are read to completion.
Refresh retains the last result; failures mark it stale. Switching comparison
scope clears the old result while loading.

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
text. Selecting a task can share its identity; **Ask Codex about this file/reply**
adds structured selection only when supported. Context sharing never blocks
inspection or triggers an automatic follow-up.

**Delete task** in the task's more menu stops running/queued/waiting work, then
removes task history, requests, webhook deliveries and its worktree/branch/refs.
Current-repo files stay intact. **Also delete the agent task**, off by default,
also removes the provider session. Provider cleanup failure retains the local
task for retry; later cleanup failure can leave earlier resources removed.
Dependent tasks must be deleted first.

## Transport

The embedded panel uses the MCP Apps bridge; it needs no direct service fetch,
credential entry or SSE connection. The stdio resource allows no external
assets/connections. Reads poll every five seconds while visible and not
submitting, preserving forms and reading positions. Running Chat drafts use
chained `get_user_agent_draft` long polls (the controller requests 20 seconds;
the tool accepts up to 25), with at least 100 ms between reads. They pause when
hidden or no longer viewing running Chat. Changes use explicit refreshes rather
than polling; diff pages are limited to 1,000,000 characters.

The standalone console uses authenticated HTTP and SSE. See
[Host capabilities](host-capabilities.md) for embedded network restrictions,
and [Local development](development.md#what-reloads-when) for activation/reloads.
