---
name: delegation
description: Delegate coding investigations, reviews, and implementation tasks through the Codex subagent extension's MCP server.
---
Use list_agent_projects and explicitly choose the task repository. A registered repository grants that Git root only; an approved parent directory permits validated child repositories. If the intended project is missing, have the user register it locally with `node <plugin-root>/dist/projects-cli.js register /absolute/path/to/repository`. Never run registration for a model-selected path without the user’s authorization. `current` does not identify the active chat project.

Use list_available_workers to discover supported providers and limits. Start independent tasks with start_agent_task; use depends_on for ordering and conversation_id for conversation scope. Reviewer, researcher, and security reviewer profiles are read-only. All tasks use isolated worktrees.
Tasks are asynchronous. Continue primary work and retrieve state with get_agent_task. Use get_agent_events for execution activity, get_agent_result for structured findings, and get_agent_artifacts for reports and diffs.
If a task requires input, show the pending question or command to the user and submit their answer with the exact request_id. Do not approve sensitive commands on the user's behalf. Interrupt preserves session state; continue requires its original worker. Steering interrupts the current turn and starts another turn with the instruction. Cancellation retains artifacts. Retry creates a new task.
Inspect returned diffs before applying them. A worktree is code isolation, not an operating-system sandbox. Do not describe interrupted Claude sessions as instruction-pointer pause/resume or promise session portability. Never expose service or provider credentials.
