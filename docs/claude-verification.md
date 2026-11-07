# Claude execution verification

Use this guide to check compatibility after a Claude Code CLI or Agent SDK
update, and to verify native execution against a live model. For ordinary local
checks, see [Checks](development.md#checks). For executable selection and
readiness, see [Claude Code CLI](claude-cli.md).

## Qualifying Claude Code versions

`claudeCliSupport` in
`src/service/features/providers/claude/configuration/executable.ts` pairs the
minimum CLI version with the Agent SDK version it was qualified against. Newer
CLI releases are accepted without an upper limit. A test fails when the
installed SDK no longer matches the recorded version, so every SDK update needs
these checks. Run them when you update the SDK or change the minimum:

1. Run `npm test`, which includes type checks. Recorded fixtures cover the SDK
   message mapping. The packed-artifact suite checks model discovery when a
   supported CLI is installed and skips that check otherwise. Typecheck fails
   when the SDK adds a message type, system subtype or assistant error. Check
   how `src/service/features/providers/claude/events/activity.ts` presents it,
   then list it in `sdk-message-coverage.ts` beside that file.
2. Select the version through `PATH` or
   `SUBAGENT_EXTENSION_FOR_CODEX_CLAUDE_PATH` and run the
   [live Claude checks](#live-claude-checks).
3. In a live task from the panel, steer, interrupt and answer a question.
4. Run `npm run check:claude-policy`. It makes no model calls and needs no org.
   The org policy checks rely on `getSettings`, which the SDK doesn't declare,
   and on how Claude Code words a rejected permission mode. If it fails, the
   panel stops locking blocked modes.

Keep the minimum at or below the SDK's paired version, `claudeCodeVersion` in
the SDK's `package.json`. Check the current stable and latest releases with
`npm view @anthropic-ai/claude-code dist-tags`.

## Live Claude checks

These checks make authenticated model calls with your Claude Code credentials,
so the ordinary test suite excludes them. Run `npm run build` first. The script
runs service source through `tsx`, and the `mcp` scenario also reads
`dist/stdio.js` and `dist/app.html`. Each run opts in explicitly and runs one
scenario. They enable full-event recording so original responses are available
for inspection and fixture recording:

```sh
SUBAGENT_EXTENSION_FOR_CODEX_LIVE_VERIFY=1 npx tsx scripts/verify-live-claude.mjs <scenario>
```

| Scenario   | Checks                                                                                                                                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read`     | A reviewer task reads a file with the native Read tool. This is the default scenario.                                                                                                                                             |
| `edits`    | Recorded file edits. See [Edit recording](#edit-recording).                                                                                                                                                                       |
| `folders`  | Folders without Git or commits: edits in Claude Code's sandbox, a blocked outside write, blocked `.git` writes and a resumed session. Run it with `edits` when you qualify a CLI or SDK version.                                  |
| `resume`   | The worker asks a native question, and the session resumes after the answer.                                                                                                                                                      |
| `sandbox`  | Claude Code's sandbox with the sandbox setting on: a workspace write runs, and writes to home and `.git/hooks` and a local listener are blocked. Unsandboxed retries are denied.                                                  |
| `mcp`      | A task started and completed through the built stdio MCP server.                                                                                                                                                                  |
| `budget`   | Budget enforcement. The task is expected to fail on its cost limit.                                                                                                                                                               |
| `parity`   | Claude Code settings loading, with default settings and a project-local skill, `.mcp.json` stdio server and `PreToolUse` hook. It approves only fixture tools and runs a subagent.                                                |
| `isolated` | Settings loading off excludes the project hook and external MCP servers. A second task keeps settings on with user MCP off, checking that the hook runs while external servers stay absent. Both tasks read a file.               |
| `token`    | A worktree task in the data directory can't read a fake admin token with the Read tool or `cat`, with the sandbox off and on, or with Python when sandboxed. It still reads its own files. Run it when you qualify a CLI version. |

Each scenario uses a temporary fixture and a small native cost limit. Claude
checks cost after each response, so a response can exceed the limit.

Tasks run on `haiku` at `medium` effort to keep costs low. Set
`SUBAGENT_EXTENSION_FOR_CODEX_LIVE_MODEL` to a model ID or alias, or
`SUBAGENT_EXTENSION_FOR_CODEX_LIVE_EFFORT` to `default` or a reasoning level, to
override them. An empty value inherits the Claude Code default:

```sh
SUBAGENT_EXTENSION_FOR_CODEX_LIVE_VERIFY=1 SUBAGENT_EXTENSION_FOR_CODEX_LIVE_MODEL=sonnet \
  SUBAGENT_EXTENSION_FOR_CODEX_LIVE_EFFORT=high npx tsx scripts/verify-live-claude.mjs read
```

Run `parity` and `isolated` together before releasing settings-loading or MCP
policy changes. The `isolated` scenario uses two tasks, each with a $0.25 cost
limit. It checks native startup tools, servers and skill visibility, plus the
fixture's hook and server startup markers. These checks cover the project
fixture. They do not inventory every user configuration source.

### Edit recording

The `edits` scenario runs file edits through Claude and checks the recorded rows
through `get_changes`. It covers Write, Edit, NotebookEdit, a 3 MB file, files
created and deleted by commands, binary-file warnings, subagent hooks and
turn-end shutdown.

- `git restore git-only.txt` checks the warning for a command whose checkout
  diff the CLI skips. Other Git commands, such as `git restore -- file.txt`, can
  return precise diffs. Read-only `git status` may return no edit data and
  creates no warning.
- The main task runs in `default` mode. Two more tasks check Bash recording in
  `auto` and `bypassPermissions` modes, and a fourth checks that a background
  subagent stops at turn end. Their cost limits are $1.50, $0.25, $0.25 and
  $0.50.
- The script saves raw hook responses to `edit-hooks.json` in its temporary
  evidence directory, even when an assertion fails. Review and sanitize them
  before committing them as fixtures.

Run this scenario whenever you qualify a CLI or SDK version. The local mapper
fixtures hold captured CLI 2.1.300 responses for the main worker, subagents and
skipped diffs, plus synthetic cases. The captured large-file case replaces its 3
MB original content with a size marker and keeps its hunks. These fixtures do
not establish compatibility with a different live CLI.

Some cases have no live coverage:

- The service always sets the Bash edit diff flag and closes each query at turn
  end, so the scenario never runs Bash without the flag or leaves a query open
  after a result.
- Claude Code 2.1.300 does not emit staged results, so only synthetic mapping
  tests cover them.
- The scenario checks the optional `gitDiff` status only when the CLI includes
  it. A run that omits it does not verify that field.
