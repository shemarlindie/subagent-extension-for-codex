import type {
  ParentUpdate,
  PendingTaskUpdates,
} from "../../../../shared/tasks/conversation/parent-updates";

export const UPDATE_LABELS: Record<ParentUpdate["kind"], string> = {
  reply: "Reply",
  request: "Waiting for answer",
  failed: "Failed",
  budget: "Budget reached",
};

/**
 * One message asking Codex to read the selected updates. Each task's cursor
 * sits just before its oldest selected update, so `list_messages` returns them
 * and records them as seen.
 */
export function pendingUpdatesMessage(tasks: PendingTaskUpdates[]) {
  const sections = tasks.map((task) => {
    const after = Math.min(...task.updates.map((u) => u.event_id)) - 1;

    const updates = task.updates.map(
      (u) => `  - ${UPDATE_LABELS[u.kind]}: ${u.text.replace(/\s+/g, " ")}`,
    );

    return [
      `- ${task.title} (task_id=${JSON.stringify(task.task_id)}, after=${after})`,
      ...updates,
    ].join("\n");
  });

  return `Delegated tasks have updates you haven't seen:\n\n${sections.join("\n")}\n\nRead each task's updates with list_messages using its task_id and after, following next_cursor. Check its state with get_task, and answer a waiting question or permission request with submit_input. Inspect the evidence before deciding next steps.`;
}
