# Configuration and permissions

Use this guide to configure the service, approve repositories, set task
defaults and control what delegated Claude sessions may do.

- Environment variables control startup and storage.
- Per-user settings supply defaults for new tasks. Task arguments can override
  ordinary defaults.
- Raising permissions or relaxing session restrictions requires user authority.

The [README](../README.md#install) covers installation.
[Local development](development.md#connect-codex-from-a-checkout) covers
connecting a checkout, and [Task continuation](task-continuation.md) covers
continuing tasks and preserving state.

## Environment variables

Checkout commands load an optional `.env`, and shell variables take precedence.
The packaged stdio launcher uses its MCP environment. To share one service,
give every client the same absolute data directory.

| Variable                                     | Default                                   | Meaning                                                                                                                                   |
| -------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `CODEX_SUBAGENT_EXTENSION_DATA`              | `~/.local/share/codex-subagent-extension` | Database, approved roots, worktrees, logs, service lease and token. A relative path resolves from the command's working directory.        |
| `CODEX_SUBAGENT_EXTENSION_ALLOWED_ROOTS`     | `[]`                                      | JSON array of parent directories to approve at startup. See [Repository access](#repository-access) for revoking them.                    |
| `CODEX_SUBAGENT_EXTENSION_URL`               | Discovered service or port 17317          | Plain loopback HTTP origin for the stdio proxy, without `/mcp`. An explicit URL requires a running service.                               |
| `CODEX_SUBAGENT_EXTENSION_CONCURRENCY`       | `3`                                       | Maximum active tasks, 1 to 20.                                                                                                            |
| `CODEX_SUBAGENT_EXTENSION_TOKEN`             | Generated locally                         | Admin token override, at least 32 characters.                                                                                             |
| `CODEX_SUBAGENT_EXTENSION_LOG_LEVEL`         | `info`                                    | Minimum service log level: `debug`, `info`, `warn` or `error`. Invalid values prevent startup. See [Logging and diagnostics](logging.md). |
| `CODEX_SUBAGENT_EXTENSION_CLAUDE_PATH`       | First `claude` on the service's `PATH`    | Absolute path to the Claude Code executable. See [Claude Code CLI](claude-cli.md#which-claude-runs).                                      |
| `PORT`                                       | `17317`                                   | Service listener port, on loopback by default. Setting it stops the plugin from moving the service off a port another program holds.      |
| `CODEX_SUBAGENT_EXTENSION_ORIGIN`            | `http://127.0.0.1:<PORT>`                 | Standalone origin and CORS allowlist.                                                                                                     |
| `CODEX_SUBAGENT_EXTENSION_MENTION_TEST_MODE` | Disabled                                  | Local testing only. `1` returns a sample Claude mention and logs searches to `<data-directory>/mention-search.jsonl`.                     |

The installed plugin uses the same default data directory as every other way of
running the service. It avoids the `PLUGIN_DATA` directory Codex gives plugins
because Codex may delete that directory on uninstall, along with task history
and worktree records.

See [Local development](development.md) for `.env`, startup conflicts and
packaging.

## Admin token

Every API request needs the admin token, because loopback clients can start
workers that edit files and run commands.

Without `CODEX_SUBAGENT_EXTENSION_TOKEN`, the service creates
`<data-directory>/admin-token` when needed and keeps it across restarts. An
environment override replaces the file's token without writing to the file.
Give clients the same override. The service applies owner-only permissions to
the data directory and token file on each start.

- Console login exchanges the token for an HttpOnly session cookie that lasts
  one hour. A service restart ends browser sessions.
- The stdio proxy reads the token and adds it to forwarded requests. When it
  connects, it sends `/health` a random challenge, and the service answers with
  an HMAC of it keyed by the token. The proxy sends the token only after
  checking that answer, so another process holding the port can't collect it.
- The panel dev host adds the token server-side through the Vite proxy without
  that check. Don't run it on a computer shared with other users.

Do not paste the token into a chat or commit it. Treat any authenticated raw
service client as a trusted administrator.

## Repository access

A task target must be a canonical Git repository root with at least one commit.
A model-supplied path never grants access. Approve a repository through global
**Manage → Add project**, **Browse…** in Advanced task, or the local CLI:

```sh
node dist/projects-cli.js register /absolute/path/to/repository
node dist/projects-cli.js list
```

To approve every repository under a directory:

```sh
node dist/projects-cli.js approve-parent /absolute/path/to/projects
```

A parent approval permits validated descendant roots. Register a child to list
it in project selectors. Registering a repository does not approve independent
repositories nested inside it. Canonical path and symlink containment checks
apply. Approvals persist in SQLite and take effect without a restart.

The service also saves parent approvals from
`CODEX_SUBAGENT_EXTENSION_ALLOWED_ROOTS`. To revoke one, remove it from the
variable and from **Manage**. While the variable still lists it, the next
service start approves it again. See
[Manage projects](panel-guide.md#manage-projects) for renaming, removal and
task data cleanup.

**Automatically add chat projects** (`auto_register_chat_project`, default
`true`) is a user-only setting. When a task starts from a chat whose Git root
is unapproved, it registers that root using the host's sandbox metadata.

- Explicit task paths and `host_directory` hints never grant access.
- Listing projects, discovering context and opening panels never register
  anything.
- Turning the setting off keeps existing approvals.

Delivery of that metadata from a given host is unverified. See
[Host capabilities](host-capabilities.md#project-context-and-registration).

Read-only Git root validation probes time out after five seconds. A timeout
keeps the approval requirement and reports a retryable validation failure.

Existing tasks keep their original repository and workspace. See
[Task tools](mcp-reference.md#task-tools) for how agents choose a repository.

## Task defaults

Open **Settings** in the panel header. Values persist per user and apply to new
tasks. Existing tasks keep their resolved settings.

| Setting                 | Initial value                                        |
| ----------------------- | ---------------------------------------------------- |
| Provider                | Claude when enabled, otherwise the first enabled one |
| Worker profile          | `reviewer`                                           |
| Workspace strategy      | `current_repo`                                       |
| Worktree branch prefix  | `agent/`                                             |
| Runtime limit           | No limit                                             |
| Cost limit              | No limit                                             |
| Claude permission mode  | `default`                                            |
| Approval decision maker | `user`                                               |

The worker profile setting applies to agent calls and the Advanced task dialog.
The panel's **New task** composer starts with the General profile instead. Its
model and reasoning choices save to the selected profile's
`<profile>_default_model` and `<profile>_default_reasoning_effort` settings.
See [Create and rename tasks](panel-guide.md#create-and-rename-tasks).

Agents use `get_settings` to discover fields and `update_settings` to change
ordinary defaults. User-only settings need the app-only `app_update_settings`
tool or an authenticated console. See
[App and user authority](mcp-reference.md#app-and-user-authority).

A budget limit can be turned off while its amount stays saved. Editing the
amount leaves the limit off until you turn it on. The app sets no upper bound
on runtime or cost, and a provider rejects limits it cannot support before the
task runs. See [Raise a task budget](task-continuation.md#raise-a-task-budget)
for existing tasks.

Model defaults for a disabled provider stay saved but hidden. If the saved
provider becomes unavailable, new tasks use the first enabled provider.

## Model and reasoning defaults

The service resolves the model and the reasoning effort separately. Each takes
the first value set in this order:

| Scope    | Model                     | Reasoning effort                     |
| -------- | ------------------------- | ------------------------------------ |
| Task     | `model`                   | `reasoning_effort`                   |
| Profile  | `<profile>_default_model` | `<profile>_default_reasoning_effort` |
| Provider | `claude_default_model`    | `claude_default_reasoning_effort`    |
| Global   | `default_model`           | `default_reasoning_effort`           |

A blank model and `default` reasoning inherit from the next scope. When every
scope inherits, the provider runtime's default applies. Task values come from
`start_task`, the New task composer or the Advanced task dialog. Permission
mode and session restrictions follow their own rules below.

Profile defaults apply to every provider, so choose a model each provider
accepts or override it on the task. Claude accepts `low`, `medium`, `high`,
`xhigh` and `max`, subject to model support. When model metadata is known, the
service rejects unsupported choices before queuing. Otherwise the provider may
fail the task when it runs.

Claude model suggestions come from the installed CLI. Discovery submits no
user turn and turns off tools, settings-file hooks and external MCP servers.
Custom model IDs work when discovery is unavailable, but effort support may
then be unknown.

## Claude permissions

The extension passes Claude's native permission mode to every session. Claude
Code's own `permissions.defaultMode` does not apply, so choosing `auto` here
selects Auto whatever that setting says. The parent agent's mode is not
inherited either.

- `claude_permission_mode` sets the default for new tasks.
- `provider_options.claude.permission_mode` overrides it for one task.
  `inherit` uses the saved setting.
- Each task stores its resolved mode and whether it came from the task or the
  setting.

| Mode                | Behavior                                                |
| ------------------- | ------------------------------------------------------- |
| `inherit`           | Task option only. Use the saved Claude permission mode. |
| `default`           | Standard native permission checks.                      |
| `acceptEdits`       | Approve file edits automatically.                       |
| `plan`              | Plan and inspect without ordinary mutating tools.       |
| `dontAsk`           | Deny actions that need permission instead of prompting. |
| `auto`              | Let the native classifier decide permissions.           |
| `bypassPermissions` | Skip ordinary native approval checks.                   |

Enabled session restrictions apply in every mode. An agent cannot choose a
mode with more authority than the saved setting. A task you submit from the
panel can.

`provider_options.claude.approval_decider` chooses who answers permission
requests that native checks leave unresolved. It accepts `user` or
`parent_agent` and defaults to the `default_approval_decider` setting. An agent
can choose `parent_agent` only when that setting already allows it.

- It never makes every action prompt.
- User decisions require **Approve** or **Deny** in the panel.
- The parent can answer through `submit_input` only when it is the approver.
- Stale request IDs and answers from another owner are rejected.
- `dontAsk` may deny questions without asking anyone.

The extension has no auto-approval policy of its own for Claude. Repository
approval and session restrictions stay separate from the permission mode.

## Claude session restrictions

Delegated sessions load your user, project and local Claude Code settings. These
include `CLAUDE.md`, rules, skills, hooks, permission allow and deny rules, MCP
servers, connectors, sandbox settings and environment settings. A native allow
or deny rule may decide a call before the extension sees it.

These user-only settings restrict delegated sessions. Each task stores its
resolved restrictions, so later changes never broaden an existing task.

| Setting              | Default       | Choices                                                                                                                                                                                                                                                                                                                 |
| -------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude_sandbox`     | `user_config` | `user_config` uses your Claude Code sandbox settings. `extension` limits Bash writes to the workspace, protects Git metadata, blocks reads of home, the data directory and sibling worktrees, blocks the network, and never runs Bash unsandboxed. `extension_locked` also ignores network domains your settings allow. |
| `claude_environment` | `inherit`     | `inherit` passes the service environment except `CODEX_SUBAGENT_EXTENSION_*`, `OPENAI_*` and `CLAUDE_CODE_OAUTH_TOKEN`. `filtered` passes basic process variables plus `CLAUDE_CONFIG_DIR`, `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`. Settings-file `env` applies in both.                                        |
| `claude_tools`       | `profile`     | `all` offers every native tool. `restricted` offers file, search, Bash, question, skill and MCP tools, and gives read-only work only read, question and skill tools plus the parent report tool. `profile` restricts read-only profiles only.                                                                           |
| `claude_path_guard`  | `profile`     | `on` keeps file tools inside the workspace and out of Git metadata. `off` relies on native rules. `profile` turns the guard on for read-only profiles.                                                                                                                                                                  |
| `claude_subagents`   | `true`        | `false` blocks the Agent tool and its legacy Task name.                                                                                                                                                                                                                                                                 |

The read-only profiles are `researcher`, `reviewer` and `security_reviewer`.

Sandboxed tasks fail to start when sandbox dependencies are missing or the
platform is unsupported. Claude Code sandbox list settings, such as excluded
commands and allowed domains, add to the extension sandbox. `extension_locked`
blocks this for network domains only.

On Linux, the sandbox uses bubblewrap, which needs unprivileged user
namespaces. Ubuntu 24.04 blocks them by default. A sandboxed task then fails to
start or every Bash command in it fails, and nothing runs unsandboxed. To use
the extension sandbox there, install `bubblewrap` and `socat`, then allow user
namespaces, for example with an AppArmor profile for `bwrap` or by setting
`kernel.apparmor_restrict_unprivileged_userns=0`. The second option applies to
every program on the computer.

Worktrees separate checkouts but do not restrict commands. With default
settings, a task with a write profile has your full Claude Code capabilities.
The model and API harness run outside the Bash sandbox, and containment of the
whole harness is unverified. The service is meant for local, single-user use
and listens on loopback by default. For trusted LAN development, see
[Access from your local network](development.md#access-from-your-local-network).
