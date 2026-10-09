# MCP reference

Both the stdio proxy and authenticated HTTP `/mcp` endpoint expose task tools and the Delegated Work MCP App. The HTTP endpoint additionally serves native task/input forms and webhook events. See [host capabilities](host-capabilities.md) for host context, entrypoints, mention integration and verification gaps; [configuration](configuration.md) owns settings and authority rules.

## Task tools

Tool schemas are the authoritative field reference. The normal delegation flow is:

1. Discover the repository with `get_current_agent_project` and approved roots with `list_agent_projects`; inspect enabled profiles with `list_available_workers`.
2. If access needs approval, use `request_agent_project` and wait for acceptance. Pass an explicit absolute `repository` to `start_agent_task`.
3. Read replies with `get_agent_messages`, which supports long polling. Read live Git changes with `get_agent_changes`, using `scope: "turn"` for one turn.
4. Continue with `send_agent_message`; inspect pending input before answering with its request ID.

`start_agent_task` requires `description` containing the full request (1–20,000 characters; whitespace-only text is rejected). The default title comes from its first line or sentence, limited to 120 characters. Optional `title` accepts 1–120 characters. Workers receive the description, while lists show the title.

Task creation defaults to the current repository, including existing changes. `workspace_strategy: "worktree"` starts from a committed revision on a task branch. Conversation scope and workspace are retained for continuations; selecting a project for a new task does not change other chats. See [setup and continuation](setup-and-resume.md) for recovery semantics.

## App and user authority

Model-visible tools may read settings and change ordinary defaults. App-only aliases (`start_user_agent_task`, `submit_user_agent_input`, `update_user_agent_settings`) authorize user task overrides, user permission answers and sensitive settings. Direct registration and folder browsing are also app-only. MCP hosts must enforce their visibility. Authenticated raw service clients are trusted administrators.

For Claude permissions routed to `parent_agent`, model-visible `submit_agent_input` can approve or deny the exact pending request. User-routed permissions require app buttons or `request_agent_input`. Questions can use model-visible submission. All answers enforce ownership and request identity.

The App resource is `ui://codex-subagent-extension/app-v6` with empty network allowlists. The standalone console uses authenticated HTTP tools and SSE; the embedded app uses portable MCP Apps calls. Panel HTML is read from `dist` on every resource request, so a rebuild can update it without restarting the service. Server changes need a restart; changed resource URIs or opener metadata need MCP reconnection.

## Host forms

`request_agent_task` asks the user to confirm or complete a task request, including its description, worker, workspace/revision and budgets. `request_agent_input` presents the exact pending question or permission request. Forms generate titles from descriptions rather than showing a title field. Discovered models become labelled choices; without discovery, the model field accepts text. Direct task creation and panel settings also accept custom model IDs.

Question forms support titled choices and multiple selection. Permission forms default to deny; cancellation preserves the pending request. The panel uses direct **Approve**/**Deny** buttons for permissions.

HTTP forms use MCP `input_required` round trips. Hosts return opaque `requestState` together with `inputResponses.form`. State is durable, bound to the authenticated owner and original arguments, and expires after ten minutes. Identical repeat submissions return the original outcome. Changed arguments, invalid responses, expired state and stale input IDs are rejected. Interrupted submissions are not replayed after recovery; inspect tasks before submitting a replacement request.

Task and worker-input forms are HTTP-only. `request_agent_project` uses the durable HTTP flow or SDK form elicitation over stdio when supported. Otherwise use **Add project**, **Browse** or the local registration CLI; supplying a path cannot bypass confirmation. Without task/input form support, use `start_agent_task` and `submit_agent_input` for questions and parent-approved permissions, and panel buttons for user permissions.

Local tests exercise actual protocol round trips with fixture workers. Native host rendering remains unverified.

## Webhook events

The HTTP endpoint uses the MCP 2.0 server SDK for protocol revision `2026-07-28`, including `server/discover`, tools, resources and stateless connections. It implements `events/list`, `events/subscribe` and `events/unsubscribe`.

| Event                       | Trigger                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `agent_task.completed`      | A successful turn ends with nothing queued; fires each time the task goes idle. Payload includes turn and a reply excerpt. |
| `agent_task.failed`         | Task execution fails.                                                                                                      |
| `agent_task.input_required` | A worker needs an answer or permission decision.                                                                           |

Subscriptions filter by task, conversation or provider. Notifications are compact; fetch the full conversation with `get_agent_messages`. There is no event replay cursor or pre-subscription history delivery.

Callbacks require public HTTPS on port 443. The service verifies a signed single-use challenge, rechecks DNS on each delivery, rejects non-public addresses, pins the validated address for TLS and does not follow redirects. Secrets are encrypted in SQLite using `<data-directory>/events-key`; preserve that file with database backups. Subscriptions and pending deliveries survive restarts.

Successful delivery is recorded idempotently. Transient failures retry with exponential backoff, up to eight attempts. Redirects and permanent client errors are not retried; HTTP `410` disables a subscription. Signing-key rotation permits both signatures for five minutes. Grants expire after one day by default, with requested lifetimes capped at seven days; an omitted expiry still gets a finite grant.

Local protocol tests verify subscription and delivery behavior. Registered-host event delivery still needs a reachable authenticated endpoint and live verification. This does not make the loopback service ready for public hosting; see [implementation status](implementation-status.md).
