import { applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import {
  previewTasks,
  previewEvents,
  previewArtifacts,
} from "../codex-fixtures";
import type { Transport, TransportEvents } from "../core/types";
const previewModels = [
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
const previewScopes = [
  ["default", "Global"],
  ["claude_default", "Claude"],
  ["reviewer_default", "Reviewer"],
  ["implementer_default", "Implementer"],
];
export class PreviewTransport implements Transport {
  readonly embedded = false;
  readonly preview = true;
  async connect(_events: TransportEvents) {
    applyDocumentTheme(
      new URLSearchParams(location.search).get("theme") === "dark"
        ? "dark"
        : "light",
    );
  }
  async tool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const fixtures: Record<string, unknown> = {
      get_agent_panel_context: {
        panel_scope: {
          conversation_id: null,
          repository: "/demo/project",
          revision: "HEAD",
        },
      },
      list_agent_projects: [
        {
          repository: "/demo/project",
          name: "Demo project",
          kind: "repository",
        },
      ],
      list_agent_tasks: previewTasks,
      get_agent_events: previewEvents.filter(
        (event) =>
          event.task_id === args.task_id && event.id > Number(args.after ?? 0),
      ),
      get_agent_artifacts: previewArtifacts.filter(
        (artifact) => artifact.task_id === args.task_id,
      ),
      list_available_workers: [
        {
          provider: "claude",
          profiles: ["reviewer", "researcher", "implementer", "debugger"],
          models: previewModels,
          capabilities: {
            cost_budget: true,
            interrupt: true,
            session_continue: true,
            interactive_input: true,
          },
        },
      ],
      get_agent_settings: {
        values: {
          default_provider: "claude",
          default_worker_profile: "reviewer",
          default_workspace_strategy: "current_repo",
          max_runtime_minutes: 20,
          use_cost_budget: true,
          max_cost_usd: 5,
          ...Object.fromEntries(
            previewScopes.flatMap(([key]) => [
              [`${key}_model`, key === "claude_default" ? "sonnet" : ""],
              [`${key}_reasoning_effort`, "default"],
            ]),
          ),
        },
        schema: {
          type: "object",
          properties: {
            default_provider: {
              type: "string",
              title: "Default provider",
              enum: ["claude"],
            },
            default_worker_profile: {
              type: "string",
              title: "Default worker profile",
              enum: ["reviewer", "researcher", "implementer", "debugger"],
            },
            default_workspace_strategy: {
              type: "string",
              title: "Workspace strategy",
              enum: ["current_repo", "worktree"],
            },
            max_runtime_minutes: {
              type: "number",
              title: "Default runtime budget (minutes)",
              minimum: 0.01,
              maximum: 120,
            },
            use_cost_budget: {
              type: "boolean",
              title: "Apply a default cost limit",
            },
            max_cost_usd: {
              type: "number",
              title: "Default cost budget (USD)",
              minimum: 0.01,
              maximum: 100,
            },
            ...Object.fromEntries(
              previewScopes.flatMap(([key, title]) => [
                [
                  `${key}_model`,
                  {
                    type: "string",
                    title: `${title} model`,
                    enum: ["", ...previewModels.map((model) => model.value)],
                  },
                ],
                [
                  `${key}_reasoning_effort`,
                  {
                    type: "string",
                    title: `${title} reasoning effort`,
                    enum: ["default", "low", "medium", "high"],
                  },
                ],
              ]),
            ),
          },
        },
        layout: [
          {
            kind: "group",
            title: "Delegation defaults",
            items: [
              "default_provider",
              "default_worker_profile",
              "default_workspace_strategy",
              "max_runtime_minutes",
              "use_cost_budget",
              "max_cost_usd",
            ].map((property) => ({ kind: "property", property })),
          },
          ...previewScopes.map(([key, title]) => ({
            kind: "group",
            title: `${title} defaults`,
            items: [`${key}_model`, `${key}_reasoning_effort`].map(
              (property) => ({ kind: "property", property }),
            ),
          })),
        ],
      },
    };
    if (!(name in fixtures))
      throw new Error(
        "Design preview only. No worker or service action was executed.",
      );
    return fixtures[name] as T;
  }
  watch() {}
  dispose() {}
}
