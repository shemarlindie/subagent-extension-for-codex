import type {
  AttachmentPage,
  MessageAttachment,
} from "../../../shared/attachments/model.js";

type ReadPage = (args: Record<string, unknown>) => Promise<AttachmentPage>;

/** Reads every page of an attachment and joins them. */
export async function readAttachment(
  taskId: string,
  { message_id, position }: Pick<MessageAttachment, "message_id" | "position">,
  read: ReadPage,
) {
  const args = { task_id: taskId, message_id, position };
  let page = await read(args);
  let content = page.content ?? "";

  while (page.next_cursor) {
    page = await read({ ...args, cursor: page.next_cursor });
    content += page.content ?? "";
  }

  const { next_cursor: _, ...last } = page;

  return { ...last, content };
}
