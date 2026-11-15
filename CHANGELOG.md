# Changelog

Each release's notes come from its section here. The release workflow fails
without one. Write for users: what changed, and anything to do by hand.

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
