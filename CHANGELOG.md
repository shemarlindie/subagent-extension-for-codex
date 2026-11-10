# Changelog

Each release's notes come from its section here. The release workflow fails
without one. Write for users: what changed, and anything to do by hand.

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
