import { type ModelChoice } from "../../../src/shared/providers/types";
import { settingsSections } from "../../../src/shared/settings/settings-document";
import {
  settingsDefaults,
  withSetting,
} from "../../../src/shared/settings/settings-schema";
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
import { listedTask, readFields } from "../../../src/shared/tasks/task-list";
import {
  PREVIEW_ARCHIVE_TOOLS,
  previewArchivedAt,
  previewArchiveTool,
} from "./archive-tools";
import { previewProjects, previewTasks } from "./fixtures";
import { livePreview, type PreviewData } from "./live-preview";
import {
  originalResponseResult,
  withoutOriginalResponses,
} from "./original-response-tools";
import { PREVIEW_PENDING_TOOLS, previewPending } from "./pending-update-tools";
import { PREVIEW_QUEUE_TOOLS, previewQueueTool } from "./queue-tools";
import {
  PREVIEW_UNREAD_TOOLS,
  previewReadState,
  previewUnreadTool,
} from "./unread-tools";

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
const previewSettingsDefaults = (() => {
  const defaults = settingsDefaults("claude");
  const { claude } = defaults.models.providers;

  return { ...defaults, models: { ...defaults.models, providers: { claude } } };
})();

const newestFirst = (tasks: Task[]) =>
  [...tasks].sort((a, b) => b.created_at.localeCompare(a.created_at));

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
    "Claude Code 2.1.200 at /opt/homebrew/Caskroom/claude-code/2.1.200/claude is older than the supported 2.1.285+. Update it with brew upgrade --cask claude-code (Homebrew installs don't update themselves), or set SUBAGENT_EXTENSION_FOR_CODEX_CLAUDE_PATH to a supported copy.",
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
  /** Leaves launch task data to the delayed list read when inspecting loading. */
  deferTaskList?: boolean;
  /** Replaces the preview tasks and their reads, as the showcase does with its story. */
  data?: PreviewData;
  /** Repositories registered during the preview; the dev host keeps them. */
  addedProjects?: string[];
  removedProjects?: string[];
  projectNames?: Record<string, string>;
};

const tasksOf = (options: PreviewOptions) =>
  options.data?.tasks ?? previewTasks;

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
        // Fixtures cannot run git, so the path says what it would find.
        ...(repository.includes("no-git") ? { git: "none" } : {}),
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
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new Error("Registration requires an absolute path");
  }

  const repository = path.replace(/\/+$/, "") || "/";
  // Stands in for a missing directory, as in directoryPath.
  if (/\s/.test(repository)) throw new Error("No Git repository at this path");

  // A folder inside a known repository is not its Git root.
  if (
    projectsWith(options).some(({ repository: root }) =>
      repository.startsWith(`${root}/`),
    )
  ) {
    throw new Error("Use repository root");
  }

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
  const tasks = tasksOf(options);

  const target =
    typeof args.task_id === "string"
      ? tasks.find((task) => task.id === args.task_id)
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
      ? newestFirst(tasks).find((task) => task.conversation_id === conversation)
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

/** Mirrors delegationPanel's open: the context plus the tasks in scope, with their read state. */
function openPanel(args: Record<string, unknown>, options: PreviewOptions) {
  const context = panelContext(args, options);

  return {
    conversation_id: context.panel_scope.conversation_id,
    ...context,
    ...(!options.deferTaskList
      ? {
          tasks: newestFirst(tasksOf(options))
            .filter((task) => inScope(task, context.panel_scope))
            .map((task) => ({
              ...task,
              ...readFields(previewReadState(task.id)),
            })),
        }
      : {}),
  };
}

/** Applies a budget increase to an idle preview task, matching the service. */
function raisePreviewBudget(taskId: unknown, value: unknown) {
  const task = previewTasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error("Task not found");

  if (["queued", "starting", "running", "waiting"].includes(task.status)) {
    throw new Error("A task's budget can only be changed while it is idle.");
  }

  const raise = budgetRaiseSchema.parse(value);
  const originalBudget = task.budget;
  const budget = { ...originalBudget };

  for (const key of ["max_runtime_minutes", "max_cost_usd"] as const) {
    const next = raise[key],
      current = task.budget[key];

    if (next === undefined) continue;

    if (next !== null && (current === null || next < current)) {
      throw new Error(
        `The budget can only be raised: ${key} is ${current ?? "unlimited"}`,
      );
    }

    budget[key] = next;
  }

  if (
    budget.max_runtime_minutes === task.budget.max_runtime_minutes &&
    budget.max_cost_usd === task.budget.max_cost_usd
  ) {
    throw new Error("Choose a changed budget limit to apply.");
  }

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
  if (name === "app_raise_budget") {
    if (!options.successfulBudgetUpdates) {
      throw new Error(
        "Design preview only. No worker or service action was executed.",
      );
    }

    return raisePreviewBudget(args.task_id, args.budget);
  }

  if (name === "app_register_project") {
    return registerProject(args.repository, options);
  }

  if (name === "app_rename_project") {
    if (
      !projectsWith(options).some(
        (project) => project.repository === args.repository,
      )
    ) {
      throw new Error("Project is no longer registered");
    }

    const name = typeof args.name === "string" ? args.name.trim() : "";

    if (!name || name.length > 200) {
      throw new Error("Project name must contain 1 to 200 characters");
    }

    return { repository: args.repository, name };
  }

  const deletesTasks =
    name === "app_delete_tasks" ||
    (name === "app_remove_project" && args.delete_tasks);

  if (deletesTasks) {
    throw new Error(
      "Task data deletion requires a service; fixture tasks are preserved.",
    );
  }

  if (name === "app_remove_project") {
    return { repository: args.repository };
  }

  if (PREVIEW_QUEUE_TOOLS.includes(name)) {
    return previewQueueTool(
      previewTasks.find((task) => task.id === args.task_id),
      name,
      args,
    );
  }

  if (PREVIEW_UNREAD_TOOLS.includes(name)) return previewUnreadTool(name, args);
  if (PREVIEW_PENDING_TOOLS.includes(name)) return previewPending(name, args);

  if (PREVIEW_ARCHIVE_TOOLS.includes(name)) {
    return previewArchiveTool(previewTasks, args);
  }

  if (name === "app_rename_task") {
    const task = previewTasks.find((task) => task.id === args.task_id);
    if (!task) throw new Error("Task not found");
    const title = typeof args.title === "string" ? args.title.trim() : "";

    if (!title || title.length > 200) {
      throw new Error("Task title must contain 1 to 200 characters");
    }

    task.title = title;

    return task;
  }

  const tasks = tasksOf(options);

  const { taskFor, eventsFor, draftFor, revision } =
    options.data ?? livePreview();

  const lightEventsFor = (id: unknown) =>
    withoutOriginalResponses(eventsFor(id));

  const fixtures: Record<string, unknown> = {
    open_subagent_extension_for_codex: openPanel(args, options),
    app_open_subagent_extension_for_codex_global: openPanel(
      { conversation_id: null },
      options,
    ),
    get_panel_context: panelContext(args, options),
    list_projects: projectsWith(options),
    list_tasks: newestFirst(tasks)
      .filter((task) => inScope(task, args))
      .map((task) => {
        const events = lightEventsFor(task.id);

        return listedTask(
          taskFor(task),
          events.slice(-200),
          events.findLast((event) => event.type === "agent.reply"),
          draftFor(task.id),
          previewReadState(task.id),
          previewArchivedAt(task.id),
        );
      }),
    app_get_chat: (() => {
      const task = tasks.find((task) => task.id === args.task_id);
      if (!task) return { items: [], next_cursor: 0 };
      const after = Number(args.after ?? 0);
      const events = lightEventsFor(task.id);

      return {
        items: chatItems(taskFor(task), events).filter(
          (item) =>
            item.event_id > after || (after === 0 && item.event_id === 0),
        ),
        next_cursor: Math.max(after, events.at(-1)?.id ?? 0),
      };
    })(),
    // Activity boundaries refresh persisted reads; draft deltas update between them.
    app_wait_for_updates: (() => {
      const target = args.draft as { task_id?: unknown } | undefined;

      return {
        revision,
        ...(target
          ? {
              draft: draftFor(target.task_id) ?? null,
              running: tasks.some(
                (task) =>
                  task.id === target.task_id &&
                  taskFor(task).status === "running",
              ),
            }
          : {}),
      };
    })(),
    app_record_timing: {},
    app_get_original_response: originalResponseResult(
      eventsFor(args.task_id),
      args,
    ),
    app_get_activity: windowActivity(
      lightEventsFor(args.task_id),
      Number(args.after ?? 0),
    ),
    app_get_turn_activity: windowTurnActivity(
      lightEventsFor(args.task_id),
      Number(args.turn),
    ),
    list_workers: [
      {
        provider: "claude",
        profiles: [...roles],
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
    get_settings: (() => {
      const values = withSetting(
        withSetting(
          previewSettingsDefaults,
          "projects.auto_register_chat",
          options.autoRegisterChatProject ?? true,
        ),
        "models.providers.claude.model",
        "sonnet",
      );

      return {
        schema: { type: "object", properties: {} },
        values,
        defaults: previewSettingsDefaults,
        sections: settingsSections({
          values,
          providers: ["claude"],
          catalogs: [{ provider: "claude", models: previewModels }],
        }),
      };
    })(),
    app_export_settings: { document: JSON.stringify(previewSettingsDefaults) },
  };

  if (!(name in fixtures)) {
    throw new Error(
      "Design preview only. No worker or service action was executed.",
    );
  }

  return fixtures[name];
}
