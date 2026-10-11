import { type ModelChoice } from "../../../src/shared/providers/types";
import { settingsSections } from "../../../src/shared/settings/settings-document";
import {
  windowActivity,
  windowTurnActivity,
} from "../../../src/shared/tasks/activity/activity-tail";
import { chatItems } from "../../../src/shared/tasks/conversation/chat";
import {
  budgetRaiseSchema,
  roles,
  type Task,
} from "../../../src/shared/tasks/model";
import { listedTask } from "../../../src/shared/tasks/task-list";
import {
  previewEvents,
  previewProjects,
  previewStreamingDraft,
  previewTasks,
} from "./fixtures";
import { PREVIEW_QUEUE_TOOLS, previewQueueTool } from "./queue-tools";

const streamStart = Date.now();

/**
 * The streaming fixture's draft so far: it grows about 60 characters a
 * second from when the preview loaded, then starts over after a pause.
 */
function streamingDraft() {
  const { messageId, text } = previewStreamingDraft;
  const length = ((Date.now() - streamStart) / 1000) * 60;

  return {
    message_id: messageId,
    text: text.slice(0, Math.max(1, Math.round(length % (text.length + 300)))),
  };
}

const previewModels: ModelChoice[] = [
  {
    value: "default",
    displayName: "Default (recommended)",
    description: "Opus 5.5 · Best for everyday, complex tasks",
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    value: "opus",
    displayName: "Opus 5.5",
    description: "For complex work and everyday tasks",
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    value: "sonnet",
    displayName: "Sonnet 5.5",
    description: "Most efficient for simpler tasks",
    supportedEffortLevels: ["low", "medium", "high"],
  },
  {
    value: "haiku",
    displayName: "Haiku 4.5",
    description: "Fastest for quick answers",
    supportsEffort: false,
  },
];

// A new user's settings with only Claude enabled, as the service reports them.
const previewSettingsDefaults = {
  default_provider: "claude",
  default_worker_profile: "reviewer",
  default_workspace_strategy: "current_repo",
  worktree_branch_prefix: "agent/",
  auto_register_chat_project: true,
  claude_permission_mode: "default",
  default_approval_decider: "user",
  claude_sandbox: "user_config",
  claude_environment: "inherit",
  claude_tools: "profile",
  claude_path_guard: "profile",
  claude_subagents: true,
  max_cost_usd: null,
  max_runtime_minutes: null,
  ...Object.fromEntries(
    [
      "default",
      "claude_default",
      ...roles.map((role) => `${role}_default`),
    ].flatMap((prefix) => [
      [`${prefix}_model`, ""],
      [`${prefix}_reasoning_effort`, "default"],
    ]),
  ),
};

const newestFirst = [...previewTasks].sort((a, b) =>
  b.created_at.localeCompare(a.created_at),
);

const inScope = (
  task: Task,
  scope: { conversation_id?: unknown; repository?: unknown },
) =>
  (typeof scope.conversation_id !== "string" ||
    task.conversation_id === scope.conversation_id) &&
  (typeof scope.repository !== "string" ||
    task.repository === scope.repository);

const previewClaudeDetails = { supported_versions: "2.1.285+" };

const previewClaudeReady = {
  ready: true,
  details: {
    executable: "/opt/homebrew/Caskroom/claude-code/2.1.290/claude",
    version: "2.1.290",
    ...previewClaudeDetails,
  },
};

/** A Homebrew install older than the supported range, worded as the service words it. */
const previewClaudeUnavailable = {
  ready: false,
  message:
    "Claude Code 2.1.200 at /opt/homebrew/Caskroom/claude-code/2.1.200/claude is older than the supported 2.1.285+. Update it with brew upgrade --cask claude-code (Homebrew installs don't update themselves), or set CODEX_SUBAGENT_EXTENSION_CLAUDE_PATH to a supported copy.",
  details: {
    executable: "/opt/homebrew/Caskroom/claude-code/2.1.200/claude",
    version: "2.1.200",
    ...previewClaudeDetails,
  },
};

/** Settings the dev host controls; the service reads them from user settings. */
export type PreviewOptions = {
  autoRegisterChatProject?: boolean;
  /** Reports Claude as not ready, as the service does for an unsupported CLI. */
  claudeUnavailable?: boolean;
  /** Applies budget changes to fixture tasks instead of rejecting the action. */
  successfulBudgetUpdates?: boolean;
  /** Repositories registered during the preview; the dev host keeps them. */
  addedProjects?: string[];
  removedProjects?: string[];
  projectNames?: Record<string, string>;
};

const projectsWith = ({
  addedProjects = [],
  removedProjects = [],
  projectNames = {},
}: PreviewOptions) =>
  [
    ...previewProjects,
    ...addedProjects
      .filter((path) => !previewProjects.some((p) => p.repository === path))
      .map((repository) => ({
        repository,
        name: repository.split("/").at(-1) ?? repository,
        kind: "repository",
      })),
  ]
    .filter((project) => !removedProjects.includes(project.repository))
    .map((project) => ({
      ...project,
      name: projectNames[project.repository] ?? project.name,
    }));

/**
 * Mirrors ProjectRegistry.register without touching the disk: an absolute
 * repository root. The caller decides whether to remember it.
 */
function registerProject(path: unknown, options: PreviewOptions) {
  if (typeof path !== "string" || !path.startsWith("/"))
    throw new Error("Registration requires an absolute path");
  const repository = path.replace(/\/+$/, "") || "/";
  // Stands in for a missing directory, as in directoryPath.
  if (/\s/.test(repository)) throw new Error("No Git repository at this path");
  // A folder inside a known repository is not its Git root.
  if (
    projectsWith(options).some(({ repository: root }) =>
      repository.startsWith(`${root}/`),
    )
  )
    throw new Error("Use repository root");

  return { repository, kind: "repository" };
}

/**
 * The path of a file URI directory hint; plain paths are ignored, as on the
 * server. Fixtures cannot run git, so a path with whitespace (usually two
 * paths typed into one field) stands in for a directory with no Git root.
 */
function directoryPath(directory: unknown) {
  if (typeof directory !== "string") return undefined;

  try {
    const url = new URL(directory);
    const path = decodeURIComponent(url.pathname);

    return url.protocol === "file:" && !/\s/.test(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

const registeredProject = (
  path: string | undefined,
  options: PreviewOptions,
) =>
  path === undefined
    ? undefined
    : projectsWith(options).find(
        ({ repository }) =>
          path === repository || path.startsWith(`${repository}/`),
      )?.repository;

/**
 * Mirrors resolvePanelContext in src/service/platform/panel/panel-context.ts: an explicit or
 * host-directory project wins, then the thread's latest task. Fixtures cannot
 * run git, so an unregistered directory is offered as the candidate as is.
 */
function panelContext(args: Record<string, unknown>, options: PreviewOptions) {
  const target =
    typeof args.task_id === "string"
      ? previewTasks.find((task) => task.id === args.task_id)
      : undefined;

  const directory =
    args.task_id === undefined ? directoryPath(args.host_directory) : undefined;

  const host = registeredProject(directory, options);

  const conversation =
    args.conversation_id === null
      ? null
      : ((args.conversation_id as string | undefined) ??
        target?.conversation_id ??
        null);

  const source =
    target ??
    (conversation
      ? newestFirst.find((task) => task.conversation_id === conversation)
      : undefined);

  const repository =
    (args.repository as string | undefined) ?? host ?? source?.repository;

  const candidate =
    !args.repository && !host && !target && args.conversation_id !== null
      ? directory
      : undefined;

  return {
    ...(candidate && candidate !== repository
      ? {
          panel_project_candidate: {
            repository: candidate,
            auto_register: options.autoRegisterChatProject ?? true,
          },
        }
      : {}),
    panel_scope: {
      conversation_id: conversation,
      ...(repository
        ? {
            repository,
            // An explicit revision wins; otherwise reuse the source task's.
            revision:
              (args.revision as string | undefined) ??
              (source?.repository === repository ? source.revision : "HEAD"),
          }
        : {}),
    },
    ...(target
      ? {
          panel_selection: {
            task_id: target.id,
            tab: "chat",
          },
        }
      : {}),
  };
}

/** Mirrors delegationPanel's open: the context plus the tasks in scope. */
function openPanel(args: Record<string, unknown>, options: PreviewOptions) {
  const context = panelContext(args, options);

  return {
    conversation_id: context.panel_scope.conversation_id,
    ...context,
    tasks: newestFirst.filter((task) => inScope(task, context.panel_scope)),
  };
}

/** Applies a budget increase to an idle preview task, matching the service. */
function raisePreviewBudget(taskId: unknown, value: unknown) {
  const task = previewTasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error("Task not found");
  if (["queued", "starting", "running", "waiting"].includes(task.status))
    throw new Error("A task's budget can only be changed while it is idle.");

  const raise = budgetRaiseSchema.parse(value);
  const originalBudget = task.budget;
  const budget = { ...originalBudget };

  for (const key of ["max_runtime_minutes", "max_cost_usd"] as const) {
    const next = raise[key],
      current = task.budget[key];

    if (next === undefined) continue;
    if (next !== null && (current === null || next < current))
      throw new Error(
        `The budget can only be raised: ${key} is ${current ?? "unlimited"}`,
      );
    budget[key] = next;
  }

  if (
    budget.max_runtime_minutes === task.budget.max_runtime_minutes &&
    budget.max_cost_usd === task.budget.max_cost_usd
  )
    throw new Error("Choose a changed budget limit to apply.");

  task.budget = budget;

  const previousRaise =
    task.budget_raised_for_turn?.turn === task.turn
      ? task.budget_raised_for_turn
      : undefined;

  const costRaised =
    budget.max_cost_usd !== null &&
    originalBudget.max_cost_usd !== null &&
    budget.max_cost_usd > originalBudget.max_cost_usd;

  const runtimeRaised =
    budget.max_runtime_minutes !== null &&
    originalBudget.max_runtime_minutes !== null &&
    budget.max_runtime_minutes > originalBudget.max_runtime_minutes;

  task.budget_raised_for_turn = {
    turn: task.turn,
    ...(previousRaise?.cost ? { cost: true } : {}),
    ...(previousRaise?.runtime ? { runtime: true } : {}),
    ...(costRaised ? { cost: true } : {}),
    ...(runtimeRaised ? { runtime: true } : {}),
  };

  return { budget: task.budget, status: task.status };
}

/**
 * Fixture tool results for the panel dev host. Tools in FIXTURE_SERVICE_TOOLS
 * are not here: the dev host sends them to the fixture service
 * (dev/panel/fixture-service/service.ts), which answers with the real service code.
 */
export function previewTool(
  name: string,
  args: Record<string, unknown> = {},
  options: PreviewOptions = {},
): unknown {
  if (name === "raise_user_agent_budget") {
    if (!options.successfulBudgetUpdates)
      throw new Error(
        "Design preview only. No worker or service action was executed.",
      );

    return raisePreviewBudget(args.task_id, args.budget);
  }

  if (name === "register_user_agent_project")
    return registerProject(args.repository, options);

  if (name === "rename_user_agent_project") {
    if (
      !projectsWith(options).some(
        (project) => project.repository === args.repository,
      )
    )
      throw new Error("Project is no longer registered");
    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (!name || name.length > 200)
      throw new Error("Project name must contain 1 to 200 characters");

    return { repository: args.repository, name };
  }

  if (name === "remove_user_agent_project") {
    if (args.delete_tasks)
      throw new Error(
        "Task data deletion requires a service; fixture tasks are preserved.",
      );

    return { repository: args.repository };
  }

  if (PREVIEW_QUEUE_TOOLS.includes(name))
    return previewQueueTool(
      previewTasks.find((task) => task.id === args.task_id),
      name,
      args,
    );

  if (name === "rename_user_agent_task") {
    const task = previewTasks.find((task) => task.id === args.task_id);
    if (!task) throw new Error("Task not found");
    const title = typeof args.title === "string" ? args.title.trim() : "";
    if (!title || title.length > 200)
      throw new Error("Task title must contain 1 to 200 characters");
    task.title = title;

    return task;
  }

  const fixtures: Record<string, unknown> = {
    open_codex_subagent_extension: openPanel(args, options),
    open_codex_subagent_extension_global: openPanel(
      { conversation_id: null },
      options,
    ),
    get_agent_panel_context: panelContext(args, options),
    list_agent_projects: projectsWith(options),
    list_agent_tasks: newestFirst
      .filter((task) => inScope(task, args))
      .map((task) => {
        const events = previewEvents.filter(
          (event) => event.task_id === task.id,
        );

        return listedTask(
          task,
          events.slice(-200),
          events.findLast((event) => event.type === "agent.reply"),
          task.id === previewStreamingDraft.taskId
            ? streamingDraft()
            : undefined,
        );
      }),
    get_user_agent_chat: (() => {
      const task = previewTasks.find((task) => task.id === args.task_id);
      if (!task) return { items: [], next_cursor: 0 };
      const after = Number(args.after ?? 0);
      const events = previewEvents.filter((event) => event.task_id === task.id);

      return {
        items: chatItems(task, events).filter(
          (item) =>
            item.event_id > after || (after === 0 && item.event_id === 0),
        ),
        next_cursor: Math.max(after, events.at(-1)?.id ?? 0),
      };
    })(),
    get_user_agent_draft: {
      draft:
        args.task_id === previewStreamingDraft.taskId ? streamingDraft() : null,
      running: previewTasks.some(
        (task) => task.id === args.task_id && task.status === "running",
      ),
    },
    get_user_agent_activity: windowActivity(
      previewEvents.filter((event) => event.task_id === args.task_id),
      Number(args.after ?? 0),
    ),
    get_user_agent_turn_activity: windowTurnActivity(
      previewEvents.filter((event) => event.task_id === args.task_id),
      Number(args.turn),
    ),
    list_available_workers: [
      {
        provider: "claude",
        profiles: ["reviewer", "researcher", "implementer", "debugger"],
        // The service skips model discovery while the CLI isn't ready.
        ...(options.claudeUnavailable
          ? { readiness: previewClaudeUnavailable }
          : { models: previewModels, readiness: previewClaudeReady }),
        capabilities: {
          cost_budget: true,
          interrupt: true,
          session_continue: true,
          interactive_input: true,
        },
      },
    ],
    // Built with the service's own section builder, so the preview matches it.
    get_agent_settings: (() => {
      const values = {
        ...previewSettingsDefaults,
        auto_register_chat_project: options.autoRegisterChatProject ?? true,
        claude_default_model: "sonnet",
      };

      return {
        schema: { type: "object", properties: {} },
        values,
        defaults: previewSettingsDefaults,
        sections: settingsSections({
          values,
          providers: ["claude"],
          catalogs: [{ provider: "claude", models: previewModels }],
          shown: values,
          remembered: { max_cost_usd: 5, max_runtime_minutes: 20 },
        }),
      };
    })(),
  };

  if (!(name in fixtures))
    throw new Error(
      "Design preview only. No worker or service action was executed.",
    );

  return fixtures[name];
}
