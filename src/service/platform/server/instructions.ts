/** The delegation workflow, shared by the HTTP and stdio MCP entrypoints. */
export const SERVER_INSTRUCTIONS = `Delegate coding work to background workers.
1. Resolve the repository with get_current_project or list_projects and pass it to start_task as an explicit absolute path. Never guess a path. Tool arguments and composer mentions never grant access. For an unregistered project, follow next_step.
2. Call list_workers. If a provider is not ready, report readiness.message to the user instead of retrying. A Claude composer mention only selects the provider. Use the reviewer profile for review requests.
3. Call start_task with the user's full request in description. Tasks use the current checkout by default, including uncommitted changes. Use workspace_strategy worktree for isolated or parallel edits from a committed revision.
4. Supervise with list_messages as its description explains. Read what the worker changed with get_changes, never from its own reply.
5. A finished task stays open. Continue it with send_message. Reopen its panel with open_codex_subagent_extension(task_id), never another start_task.`;
