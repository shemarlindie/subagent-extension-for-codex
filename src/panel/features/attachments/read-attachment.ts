import type { AttachmentPage } from "../../../shared/attachments/model.js";

type ReadPage = (args: Record<string, unknown>) => Promise<AttachmentPage>;

/** Reads every page of an attachment and joins them. */
export async function readAttachment(
  taskId: string,
  position: number,
  read: ReadPage,
) {
  let page = await read({ task_id: taskId, position });
  let content = page.content ?? "";

  while (page.next_cursor) {
    page = await read({
      task_id: taskId,
      position,
      cursor: page.next_cursor,
    });

    content += page.content ?? "";
  }

  const { next_cursor: _, ...last } = page;

  return { ...last, content };
}
