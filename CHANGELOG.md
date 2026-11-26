# Changelog

Each release's notes come from its section here. The release workflow fails
without one. Write for users: what changed, and anything to do by hand.

## 0.11.0

### Workers

- Claude workers can end a turn with a wrap-up: a short recap and, when the next
  move waits on someone, one question with reply buttons. A worker that can't go
  on marks the task **Needs input**, and an idle task row shows the open
  question. Codex reads the wrap-up through `list_tasks` and answers questions
  on turns it sent (#184).
- Workers keep a shorter, more current plan of at most 12 steps, and plan
  read-only research turns too (#182).
- Workers link the workspace files they mention. In Codex, those links in Chat
  and Activity open the file (#186).

### Visuals

- Download a visual as an HTML page, or as a PNG when it's one sized SVG, or
  copy its code from the menu in its corner. Each visual sits in a card that
  fits its content (#180).
- A `visual_guide` tool gives workers style rules, so charts, diagrams and
  mockups match the panel in light and dark themes. Visual text now matches
  Chat's size (#181).

### Chat and composer

- Choose, drop or paste local files into new tasks, Advanced task and
  follow-ups: text, images, PDFs and Office or OpenDocument files, up to 50 MiB
  per message. In Codex, a file chip opens the file in Codex's side panel
  (#185).

### Panel

- The Changes file preview has an **Open** action that opens the file in Codex
  (#186).

## 0.10.0

### Workers

- Claude workers show a step-by-step plan. An open plan sits above the composer
  and collapses to its current step, the task row shows its progress, such as
  3/7, and Chat keeps each finished plan as a row. Codex reads the plan through
  `get_task`, `list_tasks` and `list_messages` (#174, #176).
- Workers can show charts, diagrams and small interactive pages in Chat with the
  `show_visual` tool. Visuals follow the panel theme and can't reach the
  network. Codex sees each one as a `visual` line in `list_messages` (#178).
- Workers can no longer use Claude Code's `Artifact` tool, which publishes pages
  to claude.ai that Codex can't open (#177).

### Chat and composer

- Follow-up messages can carry attachments, like the request. `send_message` and
  `app_send_message` accept `attachments`, and Chat shows them under each
  message (#172).

### Panel

- Turn on **Settings → Appearance → Plan usage meter** to see your Claude plan
  usage in the panel header. Hover or tap it for each limit window's usage and
  reset time. It turns the warning color at 80% (#169).
- Task rows show Archive on hover or keyboard focus. On touch, long-press a row
  to archive it (#170).

## 0.9.0

### Chat and composer

- Chat keeps the answers to Claude's questions in the conversation (#154).
- Claude's working status stays visible above the composer while a reply streams
  (#164, #166).
- The composer separates run settings from usage indicators. Hover over the
  context ring to see the percentage (#159).

### Task list and inline view

- Tasks fit on one line with a status dot. Use **Needs attention** to find tasks
  waiting for input or a rate limit reset, and **Working** to find active and
  queued tasks (#156).
- Click a task in the inline view to open it directly. The inline view shows
  only nonzero counts (#161).

### Panel preferences

- **Wrap lines** remembers your choice separately for change and attachment
  previews (#163).
- Settings imports and exports now include panel preferences. If you previously
  hid worker icons, turn them off again in **Settings → Appearance** (#157).

### Fixes

- Reopening a hidden panel skips announcements for tasks created while it was
  hidden (#155).
- Dropdown search fields and footers have clearer backgrounds in both themes
  (#153, #162).
- Dev servers started in delegated sessions can choose their own port because
  the extension keeps its `PORT` out of those sessions (#160).

### Diagnostics

- Performance logs include panel view sizes alongside delivery times (#158).

## 0.8.0

### Breaking changes

- Block tool calls when the PreToolUse guard fails (#144). This requires Claude
  Code 2.1.324 or later. Update Claude Code before you update the extension.

### Features

- Archive Claude sessions with their tasks (#147)
- Warn when the claude.ai sign-in ends within 10 days (#146)
- Select tasks to archive or mark read in bulk (#142)

### Fixes

- Update context usage and its compaction note after compaction (#151)
- Title informational and lost-write rows and mark warnings (#150)
- Show hook heartbeats as a status, not a stuck tool row (#145)
- Lift menus, toasts and dialogs off the page (#143)

## 0.7.0

### Features

- Show context usage beside run settings (#138)
- Name the resolved default model, reasoning and permission mode (#137)

### Fixes

- Clean up compaction and command output in chat and activity (#139)

## 0.6.0

### Features

- Remove clean worktrees when archiving tasks (#131)

### Fixes

- Keep panels connected through plugin updates (#132)
- Archive tasks without waiting for worktree cleanup (#134)
- Make the panel more responsive while typing and as tasks update (#123, #125,
  #126, #128, #129)

## 0.5.0

### Features

- Run only supported built-in commands in tasks (#114)
- Run and suggest slash commands (#110)
- Show how long a task's prompt cache stays warm (#111)
- Scroll long message queues (#103)
- Limit queued messages and simplify undo (#101)
- Name worktrees and branches from the task title (#100)
- Start new tasks from thread panels (#99)
- Fill the sidebar icon while the task list is open (#97)
- Add user message actions (#85)

### Fixes

- Clarify the prompt cache tooltip (#116)
- Stop the prompt cache timer overstating how long it stays warm (#112)
- Stabilize and summarize removal previews (#107)
- Collapse thread composers by default (#106)
- Stop reduced motion painting entrance animations' first frame (#105)
- List the 5-hour rate-limit window before 7-day windows (#102)
- Keep the last task marked in the mobile task list (#98)
- Stop chat bouncing when the composer collapses (#96)
- Retain bottom pin when the composer collapses (#94)
- Keep the task list toggle on mobile (#93)
- Show model details in the collapsed composer (#92)
- Wrap composer details only when needed (#91)
- Keep read-only profiles from exiting plan mode (#82)
- Default new tasks to implementer (#83)
- Mute completed task checks (#81)
- Resume chat following when sending messages (#80)
- Swap queue and steer keyboard shortcuts (#79)

## 0.4.0

### Features

- Polish settings About and fix scroll leaks (#73)
- Follow the org's default model, reasoning cap and other policy (#71)
- Show the data directory in About (#69)
- Default the permission mode to auto (#68)
- Stream chat replies a paragraph at a time (#55)
- Let users hide the task list (#54)
- Refine worker profiles (#52)

### Fixes

- Move off a port held by another data directory's service (#72)
- Restore search scroll position as sections regrow (#56)

## 0.3.0

### Features

- Replace start_task context with task attachments (#47)
- Add an about section with claude upgrade guidance (#42)
- Remove task dependencies (#39)
- Return task summaries from list_tasks (#35)
- Refine session settings to match sdk options (#29)
- Respect org policy and explain what it changes (#21)

### Fixes

- Prevent duplicate activity rows (#50)
- Keep chat pinned through fast streaming replies (#49)
- Identify delegated sessions as the extension (#48)
- Review deletion targets and finish Claude session cleanup (#44)
- List models when the org policy fetch hangs (#26)
- Return plain errors from the stdio proxy (#25)
- Stop losing replies and error messages (#24)

## 0.2.0

### Features

- Support folders without Git or commits (#15)

### Fixes

- Let the host or browser save exports (#17)
- Stop reporting saved settings exports as failed (#18)
- Stop reduced motion delaying layout changes by a frame (#14)
- Keep upward scrolls from resuming follow (#10)

## 0.1.1

### Features

None

### Fixes

- Keep focus where it moved while a new task loads (#6)

## 0.1.0

First release, installed as a Codex plugin from this repository's marketplace.

- Install with
  `codex plugin marketplace add shemarlindie/subagent-extension-for-codex`, then
  `codex plugin add subagent-extension-for-codex@shemarlindie`.
