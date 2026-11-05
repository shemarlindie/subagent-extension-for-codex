# Configuration and permissions

Use this guide to configure the service, approve repositories, set task defaults
and control what delegated Claude sessions may do.

- Environment variables control startup and storage.
- Per-user settings supply defaults for new tasks. Task arguments can override
  ordinary defaults.
- Raising permissions or relaxing session restrictions requires user authority.

[Local development](development.md#connect-codex-from-a-checkout) covers
connecting a checkout, and [Task continuation](task-continuation.md) covers
continuing tasks and preserving state.

## Environment variables

Checkout commands load an optional `.env`, and shell variables take precedence.
The packaged stdio launcher uses its MCP environment. To share one service, give
every client the same absolute data directory.

| Variable                                     | Default                                       | Meaning                                                                                                                                   |
| -------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `SUBAGENT_EXTENSION_FOR_CODEX_DATA`          | `~/.local/share/subagent-extension-for-codex` | Database, approved roots, worktrees, logs, service lease and token. A relative path resolves from the command's working directory.        |
| `SUBAGENT_EXTENSION_FOR_CODEX_ALLOWED_ROOTS` | `[]`                                          | JSON array of parent directories to approve at startup. See [Repository access](#repository-access) for revoking them.                    |
| `SUBAGENT_EXTENSION_FOR_CODEX_URL`           | Discovered service or port 17317              | Plain loopback HTTP origin for the stdio proxy, without `/mcp`. An explicit URL requires a running service.                               |
| `SUBAGENT_EXTENSION_FOR_CODEX_CONCURRENCY`   | `3`                                           | Maximum active tasks, 1 to 20.                                                                                                            |
| `SUBAGENT_EXTENSION_FOR_CODEX_TOKEN`         | Generated locally                             | Admin token override, at least 32 characters.                                                                                             |
| `SUBAGENT_EXTENSION_FOR_CODEX_LOG_LEVEL`     | `info`                                        | Minimum service log level: `debug`, `info`, `warn` or `error`. Invalid values prevent startup. See [Logging and diagnostics](logging.md). |
| `SUBAGENT_EXTENSION_FOR_CODEX_CLAUDE_PATH`   | First `claude` on the service's `PATH`        | Absolute path to the Claude Code executable. See [Claude Code CLI](claude-cli.md#which-claude-runs).                                      |
| `SUBAGENT_EXTENSION_FOR_CODEX_FULL_EVENTS`   | Unset                                         | Set to `1` when starting the service to retain original responses for diagnostics and fixture recording.                                  |
| `SUBAGENT_EXTENSION_FOR_CODEX_IDLE_GRACE_MS` | `15000`                                       | For tests. Milliseconds a plugin service waits unused before it exits.                                                                    |
| `PORT`                                       | `17317`                                       | Service listener port, on loopback by default.                                                                                            |
| `SUBAGENT_EXTENSION_FOR_CODEX_ORIGIN`        | `http://127.0.0.1:<PORT>`                     | Standalone origin and CORS allowlist.                                                                                                     |

The installed plugin uses the same default data directory as every other way of
running the service. It avoids the `PLUGIN_DATA` directory Codex gives plugins
because Codex may delete that directory on uninstall, along with task history
and worktree records.

See [Local development](development.md) for `.env`, startup conflicts and
packaging.

### Service address

The plugin uses port 17317 by default. If another program holds it and no
service owns the data directory, the proxy chooses a free port. The service
saves its address as `origin` in `<data-directory>/service.json`, where proxies
and console users can find it.

Setting `PORT`, `SUBAGENT_EXTENSION_FOR_CODEX_ORIGIN` or
`SUBAGENT_EXTENSION_FOR_CODEX_URL` fixes the address and disables port recovery.
If it is taken, choose a free port or remove the override.

## Admin token

Every API request needs the admin token, because loopback clients can start
workers that edit files and run commands.

Without `SUBAGENT_EXTENSION_FOR_CODEX_TOKEN`, the service creates
`<data-directory>/admin-token` when needed and keeps it across restarts. An
environment override replaces the file's token without writing to the file. Give
clients the same override. The service applies owner-only permissions to the
data directory and token file on each start.

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

A task target must be an approved folder, or a Git repository root under an
approved parent. A model-supplied path never grants access. Approve a folder
through global **Manage projects… → Add project**, **Browse…** in Advanced task,
**Allow tasks here** in a chat, or the local CLI:

```sh
node dist/projects-cli.js register /absolute/path/to/folder
node dist/projects-cli.js list
```

The service reads a project's Git state from its folder, so `git init` or a
first commit takes effect without adding it again:

| `git`        | Meaning                   | Worktrees | Bash edits recorded |
| ------------ | ------------------------- | --------- | ------------------- |
| `ready`      | Git root with a commit    | Yes       | Yes                 |
| `no_commits` | Git root without a commit | No        | Yes                 |
| `none`       | Not inside a work tree    | No        | No                  |

Without Git, only the exact approved folder can run tasks. A subfolder of it
can't, and parent approvals permit only Git roots. Under the `extension`
sandboxes, a worker can't create `.git`, so run `git init` yourself.
Registration rejects:

- a folder inside a Git repository, and the error names the root to add
- the filesystem root, the home directory and its ancestors
- any path that contains or sits inside the data directory

A task can reach everything inside its folder, including nested repositories
that aren't separately approved.

macOS privacy controls can block the service from `~/Documents`, `~/Desktop` and
`~/Downloads`. A folder the service can't read isn't added, and a task in one
stops before Claude runs. The error says where to allow access. Granting it may
not be enough, because access in these locations hasn't been verified. Keep
projects elsewhere if the error persists.

To approve every repository under a directory:

```sh
node dist/projects-cli.js approve-parent /absolute/path/to/projects
```

A parent approval permits validated descendant roots. Register a child to list
it in project selectors. Registering a repository does not approve independent
repositories nested inside it. Canonical path and symlink containment checks
apply. Approvals persist in SQLite and take effect without a restart.

The service also saves parent approvals from
`SUBAGENT_EXTENSION_FOR_CODEX_ALLOWED_ROOTS`. To revoke one, remove it from the
variable and from **Manage projects…**. While the variable still lists it, the
next service start approves it again. See
[Manage projects](panel-guide.md#manage-projects) for renaming, removal and task
data cleanup.

**Automatically add chat projects** (`projects.auto_register_chat`, default
`true`) is a user-only setting. When a task starts from a chat whose Git root is
unapproved, it registers that root using the host's sandbox metadata. A chat's
folder without Git is only offered through **Allow tasks here**.

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

Settings are grouped by what they control:

| Group            | Contents                                                                                   | Who can change it |
| ---------------- | ------------------------------------------------------------------------------------------ | ----------------- |
| `task`           | Defaults for `start_task`, under its field names, plus `worktree_branch_prefix`            | Agents and you    |
| `models`         | Model and reasoning defaults for `global`, each provider and each worker profile           | Agents and you    |
| `profiles`       | Custom instructions for each worker profile                                                | You only          |
| `approvals`      | The approval decision maker for every provider, and the execution approval mode            | You only          |
| `projects`       | `auto_register_chat`                                                                       | You only          |
| `providers.<id>` | Settings native to one provider, such as Claude's permission mode and session restrictions | You only          |

| Setting                 | Path                               | Initial value                                        |
| ----------------------- | ---------------------------------- | ---------------------------------------------------- |
| Provider                | `task.provider`                    | Claude when enabled, otherwise the first enabled one |
| Worker profile          | `task.worker_profile`              | `reviewer`                                           |
| Workspace strategy      | `task.workspace_strategy`          | `current_repo`                                       |
| Worktree branch prefix  | `task.worktree_branch_prefix`      | `agent/`                                             |
| Runtime limit           | `task.budget.max_runtime_minutes`  | Off, 20 minutes                                      |
| Cost limit              | `task.budget.max_cost_usd`         | Off, 5 USD                                           |
| Claude permission mode  | `providers.claude.permission_mode` | `default`                                            |
| Approval decision maker | `approvals.decider`                | `user`                                               |

The worker profile setting applies to agent calls and the Advanced task dialog.
The panel's **New task** composer starts with the General profile instead. Its
model and reasoning choices save to the selected profile's
`models.profiles.<profile>` settings. See
[Create and rename tasks](panel-guide.md#create-and-rename-tasks).

Agents use `get_settings` to discover fields and `update_settings` to change
`task` and `models` defaults. An update is a nested partial of the values:
groups merge and values replace. The other groups are marked `userOnly` in the
schema and need the app-only `app_update_settings` tool or an authenticated
console. See [App and user authority](mcp-reference.md#app-and-user-authority).

Each budget limit has `enabled` and `amount`, so turning a limit off keeps its
amount. Editing the amount leaves the limit off until you turn it on. New tasks
get the amount as their limit when it's on, and no limit when it's off. The app
sets no upper bound on runtime or cost, and a provider rejects limits it cannot
support before the task runs. See
[Raise a task budget](task-continuation.md#raise-a-task-budget) for existing
tasks.

Model defaults for a disabled provider stay saved but hidden. If the saved
provider becomes unavailable, new tasks use the first enabled provider.

### Copy settings between computers

Open **Settings** and choose **Import and export**.

Exports include your saved defaults, including the amounts of budget limits that
are off. Approved projects aren't included. Add them separately on each
computer.

**Export file** saves a JSON file. In a browser, it's a normal download that
follows your browser's preferences. In a host that supports file downloads, the
host saves it. Otherwise, the service creates the file in the home folder of the
computer running it and shows the full path. **Copy JSON** copies the same
export for pasting elsewhere, including when saving a file fails.

To import a saved file, open it and paste its JSON into **Paste copied
settings**.

**Import settings** replaces matching defaults with valid values from the
export. It can also change permissions and other user-only settings. Import
skips unknown settings, invalid values and an unavailable default provider, then
lists what it skipped. Omitted and skipped settings keep their current values.
If the export uses a newer format, update the extension before importing it.
Exports from before settings were grouped can't be imported. Export them again.

Tool integrators should see
[App and user authority](mcp-reference.md#app-and-user-authority).

## Model and reasoning defaults

The service resolves the model and the reasoning effort separately. Each takes
the first value set in this order:

| Scope    | Model                             | Reasoning effort                             |
| -------- | --------------------------------- | -------------------------------------------- |
| Task     | `model`                           | `reasoning_effort`                           |
| Profile  | `models.profiles.<profile>.model` | `models.profiles.<profile>.reasoning_effort` |
| Provider | `models.providers.claude.model`   | `models.providers.claude.reasoning_effort`   |
| Global   | `models.global.model`             | `models.global.reasoning_effort`             |

A blank model and `default` reasoning inherit from the next scope. When every
scope inherits, the provider runtime's default applies. Task values come from
`start_task`, the New task composer or the Advanced task dialog. Permission mode
and session restrictions follow their own rules below.

Profile defaults apply to every provider, so choose a model each provider
accepts or override it on the task. Claude accepts `low`, `medium`, `high`,
`xhigh` and `max`, subject to model support. When model metadata is known, the
service rejects unsupported choices before queuing. Otherwise the provider may
fail the task when it runs.

Claude model suggestions come from the installed CLI. Discovery submits no user
turn and turns off tools, settings-file hooks and external MCP servers. It uses
the same environment as tasks and follows your settings-file choice. Discovery
runs in the service directory, so project-specific model configuration can
differ from a task workspace. Custom model IDs work when discovery is
unavailable, but effort support may then be unknown.

## Custom instructions for worker profiles

In **Settings > Worker profiles**, select a profile's name to edit its custom
instructions, saved at `profiles.<profile>.instructions`. Each holds up to 4,000
characters.

A new task keeps a copy of its profile's instructions and shows it in Details.
Later edits apply only to new tasks. Claude receives the instructions at the end
of its system prompt, after the extension's own rules. They can't lift
permission, sandbox or read-only limits, which are enforced outside the prompt.

## Claude permissions

The extension passes Claude's native permission mode to every session. Claude
Code's own `permissions.defaultMode` does not apply, so choosing `auto` here
selects Auto whatever that setting says. The parent agent's mode is not
inherited either.

- `providers.claude.permission_mode` sets the default for new tasks.
- `provider_options.claude.permission_mode` overrides it for one task. `inherit`
  uses the saved setting.
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

Enabled session restrictions apply in every mode. An agent cannot choose a mode
with more authority than the saved setting. A task you submit from the panel
can.

`provider_options.claude.approval_decider` chooses who answers permission
requests that native checks leave unresolved. It accepts `user` or
`parent_agent` and defaults to the `approvals.decider` setting. An agent can
choose `parent_agent` only when that setting already allows it.

- User decisions require **Approve** or **Deny** in the panel.
- The parent can answer through `submit_input` only when it is the approver.
- Stale request IDs and answers from another owner are rejected.
- `dontAsk` may deny questions without asking anyone.

## Claude session restrictions

By default, delegated sessions load your user, project and local Claude Code
settings. These include `CLAUDE.md`, rules, skills, hooks, permission allow and
deny rules, MCP servers, connectors, sandbox settings and environment settings.
A native allow or deny rule may decide a call before the extension sees it.

Delegated sessions receive the service's environment variables, except
`SUBAGENT_EXTENSION_FOR_CODEX_*` and `OPENAI_*`.

These user-only settings under `providers.claude` restrict delegated sessions.
Each task stores its resolved restrictions, so later changes never broaden an
existing task.

| Setting          | Default       | Choices                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sandbox`        | `user_config` | `user_config` uses your Claude Code sandbox settings. `extension` limits Bash writes to the workspace, protects Git metadata, blocks reads of home, the data directory and sibling worktrees, blocks the network, and never runs Bash unsandboxed. `extension_locked` also ignores network domains your settings allow. |
| `tools`          | `profile`     | `all` offers every native tool. `restricted` offers file, search, Bash, question, skill and MCP tools, and gives read-only work only read, question and skill tools. `profile` restricts read-only profiles only.                                                                                                       |
| `path_guard`     | `profile`     | `on` keeps file tools inside the workspace and out of Git metadata. `off` relies on native rules. `profile` turns the guard on for read-only profiles.                                                                                                                                                                  |
| `subagents`      | `true`        | `false` blocks the Agent tool and its legacy Task name.                                                                                                                                                                                                                                                                 |
| `settings_files` | `true`        | `false` loads no user, project or local settings files, so their instructions, skills, hooks, permission rules, sandbox settings and MCP servers don't apply. With `sandbox: user_config`, the sandbox then follows Claude Code's defaults.                                                                             |
| `user_mcp`       | `true`        | `false` ignores MCP servers from your Claude Code configuration, including `.mcp.json`, user-scope and plugin servers. `settings_files: false` does the same.                                                                                                                                                           |

The read-only profiles are `researcher`, `reviewer` and `security_reviewer`.

Sandboxed tasks fail to start when sandbox dependencies are missing or the
platform is unsupported. Claude Code sandbox list settings, such as excluded
commands and allowed domains, add to the extension sandbox. `extension_locked`
blocks this for network domains only.

On Linux, the sandbox uses bubblewrap, which needs unprivileged user namespaces.
Ubuntu 24.04 blocks them by default. A sandboxed task then fails to start or
every Bash command in it fails, and nothing runs unsandboxed. To use the
extension sandbox there, install `bubblewrap` and `socat`, then allow user
namespaces, for example with an AppArmor profile for `bwrap` or by setting
`kernel.apparmor_restrict_unprivileged_userns=0`. The second option applies to
every program on the computer.

Worktrees separate checkouts but do not restrict commands. With default
settings, a task with a write profile has your full Claude Code capabilities.
The model and API harness run outside the Bash sandbox, and containment of the
whole harness is unverified. The service is meant for local, single-user use and
listens on loopback by default. For trusted LAN development, see
[Access from your local network](development.md#access-from-your-local-network).
