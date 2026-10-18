import type { Task } from "../types";

export type HandoffTarget =
  { kind: "reply"; id: string } | { kind: "file"; path: string };

const excerpt = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}… (truncated)` : text;

export function handoffMessage(
  task: Task,
  target?: HandoffTarget,
  contextText?: string,
) {
  if (target) {
    const identity =
      target.kind === "reply"
        ? `Reply ID: ${JSON.stringify(target.id)}`
        : `File path: ${JSON.stringify(target.path)}`;

    const instructions =
      target.kind === "reply"
        ? `Retrieve the conversation with list_messages using task_id=${JSON.stringify(task.id)} and find the reply with this exact ID, following next_cursor if needed.`
        : `Retrieve the task diff with get_changes using task_id=${JSON.stringify(task.id)}, following next_cursor if needed, and locate this exact file path. Read its contents with get_changed_file using task_id=${JSON.stringify(task.id)} and path=${JSON.stringify(target.path)}. For large files, pass next_cursor back as cursor until all contents are read.`;

    return `Help me with this ${target.kind} from delegated task ${task.id}: ${task.title} (${task.provider}, ${task.status}).\n${identity}\nRetrieve current task state with get_task using task_id=${JSON.stringify(task.id)}. ${instructions} Inspect the evidence before proposing next steps or applying changes.\n\nRepository: ${task.repository}\nRevision: ${task.revision}\n${task.branch ? `Branch: ${task.branch}\n` : ""}${target.kind === "reply" ? "Selected reply" : "Selected file"} excerpt: ${contextText === undefined ? "Retrieve the selected context with the tools above." : excerpt(contextText, 5000)}`;
  }

  const reply = task.reply?.text;

  return `Review delegated task ${task.id}: ${task.title} (${task.provider}, ${task.status}).\nRetrieve current state with get_task and the conversation, including the worker's replies, with list_messages using task_id=${JSON.stringify(task.id)}. Read what it changed with get_changes, and send follow-ups with send_message. Inspect the evidence before proposing next steps or applying changes.\n\nRepository: ${task.repository}\nRevision: ${task.revision}\n${task.branch ? `Branch: ${task.branch}\n` : ""}Description excerpt: ${excerpt(task.description, 1500)}\nLatest reply excerpt: ${reply === undefined ? "No reply yet." : excerpt(reply, 2500)}`;
}
