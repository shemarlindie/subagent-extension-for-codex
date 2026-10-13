# Implementation status

This is a local, single-user Claude delegation service with a standalone console and embedded MCP App. [Architecture](architecture.md) describes the current boundaries; this page records evidence and remaining gaps.

## Implemented and covered locally

| Area                    | Implementation and checks                                                                                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tasks and conversations | SQLite persistence; queues, dependencies, concurrency, follow-ups, steers, interrupts and restart recovery in `src/service/features/tasks/` tests.                                                       |
| Workspaces and changes  | Approved Git roots, direct-checkout snapshots, isolated worktrees, per-turn and whole-task diffs, worktree removal and recreation. Git-backed tests cover these paths.                                   |
| Claude execution        | Agent SDK execution using the installed, qualified CLI; model discovery, native permissions, task policy and session-state checks in `src/service/features/providers/claude/` tests.                     |
| Budgets                 | Accumulated runtime and reported cost, native cost threshold, rejection of unsupported token budgets. Cost can exceed the threshold at a response boundary.                                              |
| Console and panel       | Shared React UI, Chat streaming drafts, input forms, Activity, Changes and settings. Component tests and synthetic/recorded SDK fixtures cover rendering and state.                                      |
| HTTP and MCP            | Authenticated loopback service, browser sessions and SSE, stdio proxy, HTTP MCP discovery/tools/resources. Transport and integration tests cover local behavior.                                         |
| Host integration        | Global/thread entrypoints, project/chat context, mention search and app-only authority boundaries have protocol coverage; see [Host capabilities](host-capabilities.md) for the limits of host evidence. |

Tests establish local behavior, not successful deployment in every host. Run the checks in [Local development](development.md#checks) after code changes.

## Recorded native execution

[Live verification evidence](live-claude-verification.json) records authenticated runs from **October 7, 2026**, using Agent SDK **0.3.289**. The current checkout records SDK **0.3.296** as its CLI qualification baseline; the recording does not certify that later SDK version.

The recording covers read-only execution, an opt-in Bash sandbox, resuming the same session after reopening the control plane, execution/reply retrieval through the stdio MCP proxy, cost-threshold failure, and CLI parity with a project skill, MCP server, subagent and hook. Credentials and account details were not recorded. Synthetic and recorded preview fixtures provide additional conversation coverage; they are not a new authenticated run.

See [Live Claude checks](development.md#live-claude-checks) to reproduce these scenarios. They make model calls and are excluded from the ordinary test suite.

## Parent message proof of concept

On **October 11, 2026**, Agent SDK **0.3.296** and Claude Code **2.1.296**
executed the injected `message_parent` tool with a read-only reviewer. The
standalone native probe queued its exact marker without a permission request.
A second task in this Codex chat also queued its marker; the mounted panel
claimed it and recorded successful host acceptance. The user confirmed both
the portable call and the explicit OpenAI `send: true` call appeared in the
composer or queue while the parent turn was active. After that turn ended, the
first marker arrived as an MCP App message and started a new parent turn.

Local checks on October 11, 2026 also verify ID-only parent notifications: polling
and notification retrieval share the same report ID in either arrival order,
lookup survives polling cursor advancement, ownership is enforced, and reports
wake long polls. The original live probes used parent instructions without durable
processing acknowledgement. A live Claude probe also produced `parent_76` with marker
`PARENT-ID-ONLY-POC-29`: polling and direct lookup returned the same stored
report after the cursor advanced, and the open panel recorded host acceptance.
After the parent turn ended, its ID-only notification arrived in the chat.
The parent recognized `parent_76` as already processed through polling and
ignored the notification without fetching or handling the report again.
This verifies the polling-first duplicate-handling instructions in the live host;
notification-first handling remains covered by local tests.

Current message tools add durable `ack_agent_message` acknowledgement for explicit
reports after processing. Reads expose acknowledgement state without changing
report IDs, and acknowledgements prevent new notification claims. Local checks verify idempotent acknowledgements, task ownership, persistence
across database reopening, unchanged report IDs/cursors and suppression of new
notification claims. The panel also rechecks acknowledgement after claiming and
before submission; local tests cover skipped delivery logging, lookup failures,
and conversation changes while that check is pending. HTTP and stdio integration checks verify both entrypoints
publish the shared parent protocol and model-visible acknowledgement tool. The
protocol covers polling timeouts, pending input, task completion and recovery
after context loss. See
[MCP reference](mcp-reference.md#parent-delegation-protocol) for the contract and
the processing-before-acknowledgement crash window. This addition has not yet
been verified in the live host.

This establishes provider tool execution, open-panel host submission and queued
continuation after the active parent turn ends. It does not establish mid-turn
steering, submission to an already idle thread, or background delivery.
The message API exposes no steer option. See
[Host capabilities](host-capabilities.md#worker-messages-to-the-parent-chat)
for the implementation and retry limits, and
[Live Claude checks](development.md#live-claude-checks) for the reproducible native probe.

## Remaining gaps and boundaries

- Native sidebar startup was user-confirmed on October 2, 2026. Composer selection/handoff, project metadata delivery, display-mode behavior still need live host verification.
- The service has no OAuth or public deployment. Local packaging does not establish public-distribution eligibility; [Host capabilities](host-capabilities.md) records integration support and verification limits.
- Claude's native permission mode is extension-controlled: the saved mode defaults to `default`, and a task-level `inherit` uses that saved mode. User, project and local Claude Code settings still load for instructions, hooks, permission allow/deny rules, MCP, sandbox configuration and environment; `permissions.defaultMode` does not choose the native mode. Read-only profiles retain tool restrictions; the optional extension sandbox covers Bash, while the model/API harness remains outside it. Full-harness containment is unverified. See [Configuration](configuration.md#claude-permissions) and [session restrictions](configuration.md#claude-session-restrictions).
- Interrupted turns have no independent cost report. Resuming the same session can recover that cost through a later cumulative report; starting a new session leaves it uncounted. Reported SDK cost is not audited billing, and the threshold is not a hard billing cap.
- Native session state is tied to its service worker and machine. Preserve it alongside service data for continuation. Worktree changes are never automatically merged; token budgets are unsupported.
