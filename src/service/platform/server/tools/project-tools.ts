import { z } from "zod";

import { browseProject } from "../../../features/projects/project-picker.js";
import type { Control } from "../../../features/tasks/runtime/control.js";
import { tool } from "./definition.js";

/** App-only tools for the user's registered projects. */
export function projectTools(c: Control, owner: string) {
  return {
    app_register_project: tool({
      description:
        "User interface only: approve and persist a folder selected by the user, with or without Git. Does not approve its parent or nested repositories.",
      schema: z.strictObject({ repository: z.string().min(1).max(4096) }),
      run: async (a) => {
        if (!c.projects) {
          throw new Error(
            "Project registration is unavailable in this service.",
          );
        }

        return c.projects.register(a.repository);
      },
    }),
    app_browse_project: tool({
      description:
        "User interface only: open a native folder picker on the local macOS service host. Returns a path or null on cancellation; never registers a project.",
      schema: z.strictObject({}),
      run: () => browseProject(),
    }),
    app_rename_project: tool({
      description:
        "User interface only: rename a registered project without changing its repository or tasks.",
      schema: z.strictObject({
        repository: z.string().min(1).max(4096),
        name: z.string().trim().min(1).max(200),
      }),
      run: (a) => {
        if (!c.projects) {
          throw new Error("Project management is unavailable in this service.");
        }

        return c.projects.rename(a.repository, a.name);
      },
    }),
    app_remove_project: tool({
      description:
        "User interface only: remove a saved project approval. Optionally stop and delete this user's project tasks, history and task worktrees and local branches, and with delete_agent_task their provider sessions. Checkout files stay intact.",
      schema: z
        .strictObject({
          repository: z.string().min(1).max(4096),
          delete_tasks: z.boolean().default(false),
          delete_agent_task: z.boolean().default(false),
          confirmation: z
            .string()
            .regex(/^[0-9a-f]{64}$/)
            .optional(),
        })
        .refine(
          (a) => !a.delete_tasks || !!a.confirmation,
          "Review the task removal list before deleting project task data.",
        )
        .refine(
          (a) => a.delete_tasks || !a.delete_agent_task,
          "Provider sessions are removed only with project task data.",
        ),
      run: (a) => {
        if (!c.projects) {
          throw new Error("Project management is unavailable in this service.");
        }

        return c.removeProject(
          owner,
          a.repository,
          a.delete_tasks,
          a.confirmation,
          a.delete_agent_task,
        );
      },
    }),
  };
}
