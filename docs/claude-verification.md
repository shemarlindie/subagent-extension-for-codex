# Claude execution verification

Use this guide to verify compatibility after a Claude CLI or Agent SDK update
and to check native execution. The live checks make authenticated model calls.
For ordinary local checks, see [Development](development.md#checks).

## Qualifying Claude Code versions

`claudeCliSupport` in `src/service/features/providers/claude/configuration/executable.ts` holds the
minimum version beside the Agent SDK version it was qualified with. Newer
CLI releases are accepted without an upper bound. A test fails when the installed
SDK no longer matches that version, so an SDK update requires compatibility
checks. Run these checks when updating the SDK or changing the minimum:

1. Run `npm run typecheck` and `npm test`. Recorded fixtures cover the SDK message mapping, and the
   packed-artifact suite checks model discovery when a supported host CLI is
   available. That check is skipped otherwise.
2. Run the [live Claude checks](#live-claude-checks) with that
   version selected (through `PATH` or `CODEX_SUBAGENT_EXTENSION_CLAUDE_PATH`).
   They cover reads, recorded edits, resume, the sandbox, MCP, budgets and CLI parity
   (project settings, hooks, skills and MCP servers).
3. In a live task from the panel, steer, interrupt and answer a question.

Keep the minimum at or below the SDK's paired version (`claudeCodeVersion` in its
`package.json`). Check the current stable and latest releases
(`npm view @anthropic-ai/claude-code dist-tags`) when qualifying compatibility.

## Live Claude checks

These checks make authenticated model calls and require configured Claude Code
credentials. Build first: the script runs service source through `tsx`, while
the `mcp` scenario also reads `dist/stdio.js` and `dist/app.html`. Explicitly opt
in for each scenario:

```sh
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 npx tsx scripts/verify-live-claude.mjs read
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 npx tsx scripts/verify-live-claude.mjs edits
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 npx tsx scripts/verify-live-claude.mjs resume
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 npx tsx scripts/verify-live-claude.mjs sandbox
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 npx tsx scripts/verify-live-claude.mjs mcp
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 npx tsx scripts/verify-live-claude.mjs budget
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 npx tsx scripts/verify-live-claude.mjs parity
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 npx tsx scripts/verify-live-claude.mjs parent
```

Tasks run on `haiku` at `medium` effort to keep checks cheap. Set
`CODEX_SUBAGENT_EXTENSION_LIVE_MODEL` (a model ID or alias) or
`CODEX_SUBAGENT_EXTENSION_LIVE_EFFORT` (`default` or a reasoning level) to
override them. An empty value inherits the Claude Code default:

```sh
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 CODEX_SUBAGENT_EXTENSION_LIVE_MODEL=sonnet \
  CODEX_SUBAGENT_EXTENSION_LIVE_EFFORT=high npx tsx scripts/verify-live-claude.mjs read
```

The `edits` scenario runs file-edit cases through Claude and checks recorded
rows through `get_changes`. It checks Write, Edit, NotebookEdit, a 3 MB
file, command-created and deleted files, binary-file warnings, subagent hooks
and turn-end shutdown. It uses `git restore git-only.txt` to check the warning
for a command whose checkout diff the CLI skips. Other Git commands can
return precise diffs, including `git restore -- file.txt`. Read-only `git status`
may return no edit data and creates no warning. Separate tasks check Bash recording in `auto` and
`bypassPermissions` modes alongside the main task's `default` mode.

The four tasks configure cost limits of $1.50, $0.25, $0.25 and $0.50. The script
saves raw hook responses to `edit-hooks.json` in its temporary evidence directory,
including when an assertion fails. Review and sanitize those captures before
using them as committed fixtures. Re-run the scenario when qualifying a CLI or
SDK version. Local mapper fixtures include captured 2.1.300 main-worker
responses, subagent and skipped-diff hook responses, and synthetic cases.
The captured large-file case replaces its 3 MB
original content with a size marker while keeping its hunks. These cases do
not establish compatibility with a different live CLI.

The original probes cover Bash without flag settings and a query deliberately
left open after a result. The service scenario closes each query at turn end.
Staged results use synthetic mapping tests because Claude Code 2.1.300 does not
emit them. The optional `gitDiff` status is checked only when the CLI includes
it. A live run that omits it does not verify that status field.

The `parent` scenario verifies the injected SDK tool queues a message with no
permission prompt. It does not exercise the Codex host bridge. Use an open
thread panel for that check.

Each scenario uses a temporary Git fixture and a small native cost limit. The budget
scenario deliberately expects budget failure. Cost is checked after a response
and can exceed the limit. These checks are excluded from the ordinary test suite.

The sandbox scenario enables the extension sandbox, permits only expected
fixture commands and uses a local listener.
Parity uses default settings with project-local fixtures for a skill, a
`.mcp.json` stdio server and a `PreToolUse` hook. It approves only fixture tools and checks a
subagent run.
