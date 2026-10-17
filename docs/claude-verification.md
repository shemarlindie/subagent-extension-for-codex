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
override them. An empty value inherits the Claude Code default:

```sh
CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 CODEX_SUBAGENT_EXTENSION_LIVE_MODEL=sonnet \
  CODEX_SUBAGENT_EXTENSION_LIVE_EFFORT=high npx tsx scripts/verify-live-claude.mjs read
```

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
