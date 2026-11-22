import type {
  AttachmentInput,
  TaskAttachment,
} from "../../../../shared/attachments/model.js";
import { slashCommand } from "../../../../shared/tasks/conversation/commands.js";
import type { Task, TaskMessage } from "../../../../shared/tasks/model.js";
import type { Attachments } from "../../attachments/attachments.js";

/** Refuses attachments on a command, which needs the whole prompt to itself. */
export function refuseAttachedCommand(
  runsCommands: boolean,
  message: string,
  attachments: number,
) {
  if (attachments && runsCommands && slashCommand(message)) {
    throw new Error("A slash command can't carry attachments.");
  }
}

/**
 * Snapshots a message's attachments from the approved project folder, also
 * for worktree tasks, then sends it. A failed send keeps none of them.
 */
export async function sendAttached<T>(
  attachments: Attachments,
  t: Task,
  m: TaskMessage,
  inputs: AttachmentInput[],
  send: (snapshots: TaskAttachment[]) => Promise<T>,
) {
  const snapshots = await attachments.prepare(t.id, t.repository, inputs, m.id);

  try {
    return await send(snapshots);
  } catch (error) {
    await attachments.discardUnsaved(t.id, snapshots);
    throw error;
  }
}
