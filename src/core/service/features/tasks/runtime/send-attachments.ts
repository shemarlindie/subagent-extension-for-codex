import type { AttachmentInput } from "../../../../shared/attachments/model.js";
import { slashCommand } from "../../../../shared/tasks/conversation/commands.js";
import type { Task, TaskMessage } from "../../../../shared/tasks/model.js";
import type { Attachments } from "../../attachments/attachments.js";
import type { Projects } from "../../projects/projects.js";

type AttachmentServices = { attachments: Attachments; projects?: Projects };

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
 * for worktree tasks, then sends it. The send calls `save` in the transaction
 * that records the message, which fails if the project lost its approval
 * meanwhile. A failed send keeps none of the snapshots.
 */
export async function sendAttached<T>(
  { attachments, projects }: AttachmentServices,
  t: Task,
  m: TaskMessage,
  inputs: AttachmentInput[],
  send: (save: () => void) => Promise<T>,
) {
  if (inputs.length) await projects?.resolve(t.repository);
  const snapshots = await attachments.prepare(t.id, t.repository, inputs, m.id);

  if (snapshots.length) {
    m.attachment_titles = snapshots.map((item) => item.title);
  }

  const save = () => {
    if (!snapshots.length) return;
    projects?.assertApproved(t.repository);
    attachments.save(t.id, snapshots);
  };

  try {
    return await send(save);
  } catch (error) {
    await attachments.discardUnsaved(t.id, snapshots);
    throw error;
  }
}
