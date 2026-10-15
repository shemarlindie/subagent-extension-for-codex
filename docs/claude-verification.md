# Claude execution verification

For maintainers qualifying a Claude CLI or Agent SDK update and running native
execution checks. These procedures make authenticated model calls; ordinary
local checks are in [Development](development.md#checks).

## Qualifying Claude Code versions

`claudeCliSupport` in `src/service/features/providers/claude/configuration/executable.ts` holds the
minimum version beside the Agent SDK version it was qualified with. Newer
CLI releases are accepted without an upper bound. A test fails when the installed
SDK no longer matches that version, so an SDK update requires compatibility
checks. Run these checks when updating the SDK or changing the minimum:

1. Run `npm run typecheck` and `npm test`. Recorded fixtures cover the SDK message mapping, and the
   packed-artifact suite runs model discovery through the host's CLI.
2. Run the [live Claude checks](#live-claude-checks) with that
   version selected (through `PATH` or `CODEX_SUBAGENT_EXTENSION_CLAUDE_PATH`).
   They cover reads, resume, the sandbox, MCP, budgets and CLI parity
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
override them; an empty value inherits the Claude Code default:

```sh
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 CODEX_SUBAGENT_EXTENSION_LIVE_MODEL=sonnet \
  CODEX_SUBAGENT_EXTENSION_LIVE_EFFORT=high npx tsx scripts/verify-live-claude.mjs read
```

The `parent` scenario verifies the injected SDK tool queues a message with no
permission prompt. It does not exercise the Codex host bridge; use an open
thread panel for that check.

Each uses a temporary Git fixture and a native cost limit of $0.25, or $0.50 for
parity. The budget scenario sets $0.001 and expects budget failure. Claude checks
cost after a response, so it can exceed the configured amount; this is not a
hard billing cap. These checks are excluded from the ordinary test suite.

The sandbox scenario enables the extension sandbox, approves only its five
exact fixture commands, denies unexpected permissions and uses a local listener.
Parity uses default settings and project-local skill, `.mcp.json` stdio server
and `PreToolUse` hook fixtures; it approves only fixture tools and checks a
subagent run. Select a CLI with `PATH` or
`CODEX_SUBAGENT_EXTENSION_CLAUDE_PATH` when qualifying versions.
