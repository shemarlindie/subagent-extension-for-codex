# Configuration and permissions

Use this guide to configure service startup, repository access and delegated
execution authority. Environment variables control startup and storage. Per-user settings control new tasks, and task arguments can override ordinary defaults. Permission increases require user authority.

See [task continuation](task-continuation.md) for continuing tasks and preserving state, and the [README](../README.md#connect-codex) for client connection setup.

## Environment variables

Checkout commands load an optional `.env`, and shell variables take precedence. The packaged stdio launcher uses its MCP environment. Give every client the same absolute data override to share a service.

| Variable                                     | Default                                   | Meaning                                                                                                                                           |
| -------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CODEX_SUBAGENT_EXTENSION_DATA`              | `~/.local/share/codex-subagent-extension` | Database, approved roots, worktrees, logs, service lease and token. Relative overrides resolve from the working directory where the command runs. |
| `CODEX_SUBAGENT_EXTENSION_ALLOWED_ROOTS`     | `[]`                                      | JSON array of parent-directory approvals persisted at startup. Removing an entry does not revoke its saved approval.                              |
| `CODEX_SUBAGENT_EXTENSION_URL`               | Discovered service or port 17317          | Plain loopback HTTP origin for the stdio proxy, without `/mcp`. An explicit URL requires a running service.                                       |
| `CODEX_SUBAGENT_EXTENSION_CONCURRENCY`       | `3`                                       | Maximum active tasks, 1 to 20.                                                                                                                    |
| `CODEX_SUBAGENT_EXTENSION_TOKEN`             | Generated locally                         | Admin token override, at least 32 characters.                                                                                                     |
| `CODEX_SUBAGENT_EXTENSION_CLAUDE_PATH`       | First `claude` on service `PATH`          | Absolute executable override. Failed validation blocks Claude execution.                                                                          |
| `PORT`                                       | `17317`                                   | Service listener port (loopback by default).                                                                                                      |
| `CODEX_SUBAGENT_EXTENSION_ORIGIN`            | `http://127.0.0.1:<PORT>`                 | Standalone origin and CORS allowlist.                                                                                                             |
| `CODEX_SUBAGENT_EXTENSION_MENTION_TEST_MODE` | Disabled                                  | `1` returns a sample Claude mention and logs searches to `<data-directory>/mention-search.jsonl` for local testing only.                          |

See [local development](development.md) for `.env`, startup conflicts and packaging, and [Claude CLI readiness](claude-cli.md) for executable selection.

## Admin token

Loopback clients can start workers that edit files and run commands, so API requests require authentication. Without `CODEX_SUBAGENT_EXTENSION_TOKEN`, the service creates `<data-directory>/admin-token` when needed and reapplies owner-only permissions on each start. The file's token persists across restarts. An environment override replaces it without writing the override to that file. Configure the same override on clients. The data directory always gets owner-only permissions.

- Console login exchanges the token for an HttpOnly session cookie valid for one hour. A service restart invalidates browser sessions.
- The stdio proxy reads the token and adds it to forwarded requests.
- The panel dev host adds the token server-side through the Vite proxy.

Do not paste the token into a chat or commit it. Authenticated raw service clients are trusted administrators.

## Repository access

Targets must be canonical Git repository roots with at least one commit. A model-supplied path never grants access. Approve individual roots through global **Manage → Add project**, **Browse** in Advanced task, or the local CLI:

```sh
node dist/projects-cli.js register /absolute/path/to/repository
node dist/projects-cli.js list
```

To authorize repositories throughout a directory explicitly:

```sh
node dist/projects-cli.js approve-parent /absolute/path/to/projects
```

Parent approval permits validated descendant roots. Register individual children to include them in project selectors. Registering a root alone does not approve independent nested repositories. Canonical path and symlink containment checks apply. Registration persists in SQLite and takes effect without a restart.

Environment-provided parent approvals are saved too. To revoke one, remove its environment entry and revoke the saved approval through Manage. If the environment entry remains, the next service start grants it again. Use global **Manage** to rename or remove saved approvals. See [Manage projects](panel-guide.md#manage-projects) for task-data deletion and remaining grants.

**Automatically add chat projects** (`auto_register_chat_project`, default `true`) is a user-only setting. It registers an unapproved chat Git root only when a task starts for that root, using original host sandbox metadata. Explicit task paths and `host_directory` hints do not grant access. Project listing, context discovery and opening panels remain read-only. Disabling the setting preserves existing grants. Host metadata delivery from registered hosts is unverified. See [host capabilities](host-capabilities.md).

Use `list_agent_projects`, then pass the intended absolute `repository` to `start_agent_task`. `get_current_agent_project` discovers the chat root. Direct the user to the panel or local CLI if registration is needed. Existing tasks keep their original repository and workspace.

## Task defaults

Open **Settings** in the panel header. Values persist per user in SQLite and apply to new tasks. Existing tasks retain their resolved settings.

| Setting                 | Initial value                                         |
| ----------------------- | ----------------------------------------------------- |
| Provider                | Claude when enabled, otherwise first enabled provider |
| Worker profile          | `reviewer`                                            |
| Workspace strategy      | `current_repo`                                        |
| Worktree branch prefix  | `agent/`                                              |
| Runtime limit           | No limit                                              |
| Cost limit              | No limit                                              |
| Claude permission mode  | `default`                                             |
| Approval decision maker | `user`                                                |

The worker profile setting applies to model calls and the Advanced task dialog.
The panel's **New task** composer starts with the General profile.

For programmatic updates, use `get_agent_settings` to discover supported fields and `update_agent_settings` to change ordinary defaults. User-only settings require app-only `update_user_agent_settings` or authenticated console authority. See [app and user authority](mcp-reference.md#app-and-user-authority) for the host enforcement boundary.

Budget controls can disable a limit while remembering its amount. Editing that amount leaves the limit disabled until enabled again. The app sets no upper bound on runtime or cost. Providers reject limits they cannot support before execution. See [continuation and budgets](task-continuation.md#raise-a-task-budget) for raising limits on existing tasks.

Disabled providers' model defaults remain saved but hidden. An unavailable saved provider falls back to the first enabled provider.

## Model and reasoning defaults

Each field resolves independently: task override → worker profile → provider → global → provider runtime default. Blank model fields and `default` reasoning inherit. This precedence resolves model and effort only. Permission and session restrictions have their own rules below.

- Global: `default_model`, `default_reasoning_effort`.
- Provider: `claude_default_model`, `claude_default_reasoning_effort` (or `fixture`).
- Profile: `reviewer_default_model`, `reviewer_default_reasoning_effort` (or another worker profile).
- Task: `model`, `reasoning_effort` in `start_agent_task`, the panel's New task chips or the Advanced task dialog.

Profile defaults apply across providers, so choose a compatible model or override it on the task. Claude accepts `low`, `medium`, `high`, `xhigh` and `max`, subject to model support. Unsupported choices are rejected before queuing when metadata is known. Otherwise native validation may fail during execution.

Claude model suggestions come from the installed harness. Discovery submits no user turn and disables tools, settings-file hooks and external MCP servers. Custom model IDs remain supported when discovery is unavailable. Effort support may then be unknown.

## Claude permissions

The extension owns Claude's native permission mode. `claude_permission_mode` applies to new tasks and defaults to `default`. The SDK receives the resolved mode explicitly. Choosing `auto` in extension settings therefore selects Auto even when Claude Code's own `permissions.defaultMode` is different. `provider_options.claude.permission_mode` overrides the saved setting when it selects a mode. For new tasks, `inherit` means use the saved extension setting. The parent agent's permission mode is not inherited. The task stores the resolved value and its source.

| Mode                | Behavior                                                             |
| ------------------- | -------------------------------------------------------------------- |
| `inherit`           | Task-level option: use the extension's saved Claude permission mode. |
| `default`           | Standard native permission checks.                                   |
| `acceptEdits`       | Automatically approve file edits.                                    |
| `plan`              | Plan and inspect without ordinary mutating tools.                    |
| `dontAsk`           | Deny actions that require permission instead of prompting.           |
| `auto`              | Use the native classifier for permission decisions.                  |
| `bypassPermissions` | Skip ordinary native approval checks.                                |

Enabled session restrictions apply in every mode. Model-selected overrides cannot increase authority beyond the user-approved baseline. A trusted panel task submission can authorize a broader task-level override.

Approval routing is separate: `provider_options.claude.approval_decider` accepts `user` or `parent_agent`, inheriting `default_approval_decider`. It handles requests left unresolved by native checks. It does not force every action to prompt. User permission decisions require panel **Approve**/**Deny**. Model-visible `submit_agent_input` can decide permissions only when the parent is the approver. Stale request IDs and cross-owner answers are rejected. `dontAsk` may deny questions without invoking the callback.

There is no extension-wide auto-approval policy for Claude. Repository approval and resolved session restrictions remain separate from native permission mode.

## Claude session restrictions

Claude continues to load user, project and local Claude Code settings, including `CLAUDE.md`, rules, skills, hooks, permission allow/deny rules, MCP servers and connectors. These sources also supply sandbox configuration and environment settings where applicable. Native allow/deny rules may resolve a call before extension routing. Use the user-only extension settings below to restrict delegated sessions. Each task stores its resolved policy.

| Setting              | Default       | Choices                                                                                                                                                                                                                                                        |
| -------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude_sandbox`     | `user_config` | Use Claude Code sandbox settings. `extension` adds workspace-only Bash writes, Git metadata protection, no home/sibling-worktree reads, no network and no unsandboxed fallback. `extension_locked` also locks network domains against settings-file additions. |
| `claude_environment` | `inherit`     | Service environment excluding `CODEX_SUBAGENT_EXTENSION_*`, `OPENAI_*` and `CLAUDE_CODE_OAUTH_TOKEN`. `filtered` passes basic process variables plus `CLAUDE_CONFIG_DIR`, `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`. Settings-file `env` also applies.    |
| `claude_tools`       | `profile`     | `all` offers all native tools. `restricted` offers file/search, Bash, questions, skills and MCP tools, with only read/question/skill tools and the injected parent-report tool for read-only work. `profile` restricts read-only profiles only.                |
| `claude_path_guard`  | `profile`     | `on` limits file tools to the workspace and denies Git metadata. `off` relies on native rules. `profile` enables the guard for read-only profiles.                                                                                                             |
| `claude_subagents`   | `true`        | `false` disallows the Agent and legacy Task tools.                                                                                                                                                                                                             |

If sandbox dependencies are missing or the platform is unsupported, sandboxed tasks fail to start. Claude Code sandbox list settings, such as excluded commands and allowed domains, can add to extension policy. `extension_locked` blocks this only for network domains.

Worktrees separate checkouts without restricting command execution. Default write-profile tasks have the host user's Claude Code capabilities. The model/API harness is outside the Bash sandbox, and full-harness containment is unverified. The service is intended for local, single-user use and listens on loopback by default. For trusted LAN development, see [local network access](development.md#access-from-your-local-network).
