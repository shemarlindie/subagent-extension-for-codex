import { applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import {
  previewTasks,
  previewEvents,
  previewArtifacts,
} from "../codex-fixtures";
import type { Transport, TransportEvents } from "../core/types";
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
          max_runtime_minutes: 20,
          max_cost_usd: 5,
        },
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
