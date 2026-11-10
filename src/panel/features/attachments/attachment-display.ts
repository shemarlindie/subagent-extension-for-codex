import type { RequestAttachment } from "../../../shared/attachments/model.js";
import type { IconName } from "../../shared/components/icons/icons";
import type { PreviewFile } from "../file-preview/file-format";

/** The chip and dialog icon for an attachment's kind. */
export function attachmentIcon(attachment: RequestAttachment): IconName {
  if (attachment.source === "diff") return "file-diff";
  if (attachment.source === "inline" && !attachment.path) return "note";

  return attachment.format === "markdown" ? "file-text" : "file-code";
}

/** "+12 −3" for a diff, "lines 44–55" for a line range, otherwise its line count. */
export function attachmentSize(attachment: RequestAttachment) {
  const { start_line: start, end_line: end } = attachment;

  if (attachment.source === "diff") {
    return `+${attachment.additions ?? 0} −${attachment.deletions ?? 0}`;
  }

  if (start !== undefined && end !== undefined) {
    return start === end ? `line ${start}` : `lines ${start}–${end}`;
  }

  return `${attachment.lines} ${attachment.lines === 1 ? "line" : "lines"}`;
}

/** A chip's short line range, such as "L44–55". Absent for a whole file. */
export function attachmentRange({
  start_line: start,
  end_line: end,
}: RequestAttachment) {
  if (start === undefined || end === undefined) return undefined;

  return start === end ? `L${start}` : `L${start}–${end}`;
}

/**
 * The title chips and the dialog show. A generated title's `:44-55` suffix is
 * left off, since both show the range beside it.
 */
export function displayTitle({
  title,
  start_line,
  end_line,
}: RequestAttachment) {
  const suffix = `:${start_line}-${end_line}`;

  return start_line !== undefined &&
    title.length > suffix.length &&
    title.endsWith(suffix)
    ? title.slice(0, -suffix.length)
    : title;
}

/** Where an attachment came from, with its size, for the dialog's header. */
export function attachmentOrigin(attachment: RequestAttachment) {
  const files = attachment.files ?? 0;

  const size =
    attachment.source === "diff"
      ? `${files} ${files === 1 ? "file" : "files"}, ${attachmentSize(attachment)}`
      : attachmentSize(attachment);

  if (attachment.source === "inline") {
    return `Inline from the parent agent · ${size}`;
  }

  return attachment.path ? `${attachment.path} · ${size}` : size;
}

const extensions = {
  diff: ".diff",
  code: ".txt",
  markdown: ".md",
  text: ".txt",
} as const;

/**
 * The attachment as a file to preview. Its format picks the viewer, so a
 * label or file name such as notes.md or image.png can't turn text into
 * Markdown or an image. The path still picks source highlighting, and an
 * attachment without one is named for its title and format.
 */
export function attachmentFile(
  attachment: RequestAttachment,
  content: string,
): PreviewFile {
  return {
    path:
      attachment.path ?? `${attachment.title}${extensions[attachment.format]}`,
    content,
    format: attachment.format,
    ...(attachment.start_line ? { start_line: attachment.start_line } : {}),
  };
}
