import { z } from "zod";

import type { Control } from "../../features/tasks/control.js";
import type { Task } from "../../shared/contracts.js";
import { hostProjectCandidate, withHostRepository } from "./host-context.js";

export const panelContextInput = z.object({
  conversation_id: z.string().min(1).max(256).nullable().optional(),
  repository: z.string().min(1).optional(),
  revision: z.string().min(1).optional(),
  task_id: z.string().optional(),
  host_directory: z
    .string()
    .max(4096)
    .optional()
    .describe(
      "Optional local file URI directory hint. Validated against registered Git roots; never an access grant.",
    ),
});

export type PanelContextInput = z.infer<typeof panelContextInput>;

export function taskPanelContext(task: Task) {
  return {
    panel_scope: {
      conversation_id: task.conversation_id ?? null,
      repository: task.repository,
      revision: task.revision,
    },
    panel_selection: { task_id: task.id, tab: "chat" as const },
  };
}

/** Correlation and defaults only. Registry and task ownership remain authoritative. */
export async function resolvePanelContext(
  c: Control,
  owner: string,
  args: PanelContextInput,
) {
  args = (await withHostRepository(c, args)) as PanelContextInput;
  const target = args.task_id ? c.store.get(args.task_id, owner) : undefined;
  if (
    target &&
    args.conversation_id != null &&
    target.conversation_id !== args.conversation_id
  )
    throw new Error("Task belongs to a different conversation");

  const conversationId =
    args.conversation_id === null
      ? null
      : (args.conversation_id ?? target?.conversation_id ?? null);

  const latest = conversationId
    ? c.store.all(owner).find((t) => t.conversation_id === conversationId)
    : undefined;

  const source = target ?? latest;
  let repository = args.repository ?? source?.repository;

  if (repository) {
    try {
      repository = c.projects
        ? await c.projects.resolve(repository)
        : await c.workspaces.repository(repository);
    } catch (error) {
      if (args.repository || target) throw error;
      // History is a default, not a requirement to keep an old checkout alive.
      repository = undefined;
    }
  }

  if (target && repository !== target.repository)
    throw new Error("Task belongs to a different repository");
  if (target && args.revision && args.revision !== target.revision)
    throw new Error("Task uses a different revision");

  const candidate =
    !args.repository && !target && args.conversation_id !== null
      ? await hostProjectCandidate(args.host_directory)
      : undefined;

  return {
    ...(candidate && candidate !== repository
      ? {
          panel_project_candidate: {
            repository: candidate,
            // New task may offer it; starting that task adds it with the user's choice.
            auto_register:
              !!c.projects &&
              c.settings.values(owner).auto_register_chat_project,
          },
        }
      : {}),
    panel_scope: {
      conversation_id: conversationId,
      ...(repository
        ? {
            repository,
            revision:
              args.revision ??
              (source?.repository === repository ? source.revision : "HEAD"),
          }
        : {}),
    },
    ...(target
      ? {
          panel_selection: {
            task_id: target.id,
            tab: "chat" as const,
          },
        }
      : {}),
  };
}
