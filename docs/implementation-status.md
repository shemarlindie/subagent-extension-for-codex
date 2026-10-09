# Implementation status

This is a local, single-user Claude delegation service with a standalone console and embedded MCP App. [Architecture](architecture.md) describes the current boundaries; this page records evidence and remaining gaps.

## Implemented and covered locally

| Area                    | Implementation and checks                                                                                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tasks and conversations | SQLite persistence; queues, dependencies, concurrency, follow-ups, steers, interrupts and restart recovery in `src/service/features/tasks/` tests.                                                             |
| Workspaces and changes  | Approved Git roots, direct-checkout snapshots, isolated worktrees, per-turn and whole-task diffs, worktree removal and recreation. Git-backed tests cover these paths.                                         |
| Claude execution        | Agent SDK execution using the installed, qualified CLI; model discovery, native permissions, task policy and session-state checks in `src/service/features/providers/claude/` tests.                           |
| Budgets                 | Accumulated runtime and reported cost, native cost threshold, rejection of unsupported token budgets. Cost can exceed the threshold at a response boundary.                                                    |
| Console and panel       | Shared React UI, Chat streaming drafts, input forms, Activity, Changes and settings. Component tests and synthetic/recorded SDK fixtures cover rendering and state.                                            |
| HTTP and MCP            | Authenticated loopback service, browser sessions and SSE, stdio proxy, HTTP MCP discovery/tools/resources, durable rich forms and signed webhook events. Transport and integration tests cover local behavior. |
| Host integration        | Global/thread entrypoints, project/chat context, mention search and app-only authority boundaries have protocol coverage; see [Host capabilities](host-capabilities.md) for the limits of host evidence.       |

Tests establish local behavior, not successful deployment in every host. Run the checks in [Local development](development.md#checks) after code changes.

## Recorded native execution

[Live verification evidence](live-claude-verification.json) records authenticated runs from **October 7, 2026**, using Agent SDK **0.3.289**. The current checkout qualifies its installed CLI range against SDK **0.3.293**; the recording does not certify that later SDK version.

The recording covers read-only execution, an opt-in Bash sandbox, resuming the same session after reopening the control plane, execution/reply retrieval through the stdio MCP proxy, cost-threshold failure, and CLI parity with a project skill, MCP server, subagent and hook. Credentials and account details were not recorded. Synthetic and recorded preview fixtures provide additional conversation coverage; they are not a new authenticated run.

See [Live Claude checks](development.md#live-claude-checks) to reproduce these scenarios. They make model calls and are excluded from the ordinary test suite.

## Remaining gaps and boundaries

- Native sidebar startup was user-confirmed on October 2, 2026. Composer selection/handoff, project metadata delivery, rich-form rendering, display-mode behavior and webhook delivery still need live host verification.
- The service has no OAuth or public deployment. Local packaging does not establish public-distribution eligibility; [Host capabilities](host-capabilities.md) records integration support and verification limits.
- Claude inherits the user's CLI authority by default. Read-only profiles add restrictions; the optional extension sandbox covers Bash, while the model/API harness remains outside it. Full-harness containment is unverified. See [Configuration](configuration.md#claude-session-restrictions).
- Interrupted turns have no independent cost report. Resuming the same session can recover that cost through a later cumulative report; starting a new session leaves it uncounted. Reported SDK cost is not audited billing, and the threshold is not a hard billing cap.
- Native session state is tied to its service worker and machine. Preserve it alongside service data for continuation. Worktree changes are never automatically merged; token budgets are unsupported.
