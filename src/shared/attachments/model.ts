import { z } from "zod";

/** Bounds on `start_task` attachments. Reference sizes count UTF-8 bytes. */
export const ATTACHMENT_LIMITS = {
  count: 20,
  summaryChars: 200,
  titleChars: 60,
  inlineChars: 8_000,
  referenceBytes: 2 * 1024 * 1024,
  taskBytes: 10 * 1024 * 1024,
  paths: 50,
  pathChars: 1024,
} as const;

export const attachmentFormats = ["diff", "code", "markdown", "text"] as const;
export type AttachmentFormat = (typeof attachmentFormats)[number];

export const attachmentSources = ["inline", "diff", "file"] as const;

type AttachmentSource = (typeof attachmentSources)[number];

const summary = z
  .string()
  .trim()
  .min(1)
  .max(ATTACHMENT_LIMITS.summaryChars, "Keep the summary to one sentence.")
  .describe(
    "One sentence on what the attachment is and why the worker needs it.",
  );

const title = z
  .string()
  .trim()
  .min(1)
  .max(ATTACHMENT_LIMITS.titleChars)
  .optional()
  .describe("A short label. Set it only when the generated one isn't clear.");

const projectPath = z.string().min(1).max(ATTACHMENT_LIMITS.pathChars);

const inlineAttachment = z.strictObject({
  source: z.literal("inline"),
  summary,
  title,
  format: z.enum(attachmentFormats),
  text: z
    .string()
    .min(1)
    .max(
      ATTACHMENT_LIMITS.inlineChars,
      'Inline text is limited to 8,000 characters. Attach project content by reference with { source: "file", path } or { source: "diff" }, or save the content to a project file and attach that.',
    )
    .describe("Short content that exists only in the chat."),
  path: projectPath
    .optional()
    .describe("A label that picks highlighting. The service never reads it."),
});

const diffAttachment = z.strictObject({
  source: z.literal("diff"),
  summary,
  title,
  paths: z
    .array(projectPath)
    .min(1)
    .max(ATTACHMENT_LIMITS.paths)
    .optional()
    .describe("Limit the diff to these project paths."),
});

const fileAttachment = z
  .strictObject({
    source: z.literal("file"),
    path: projectPath.describe("A file in the project folder."),
    summary,
    title,
    start_line: z.number().int().positive().optional(),
    end_line: z.number().int().positive().optional(),
  })
  .refine(
    (a) =>
      a.start_line === undefined ||
      a.end_line === undefined ||
      a.start_line <= a.end_line,
    { message: "start_line must not be after end_line", path: ["end_line"] },
  );

const attachmentInputSchema = z.discriminatedUnion("source", [
  inlineAttachment,
  diffAttachment,
  fileAttachment,
]);

export type AttachmentInput = z.infer<typeof attachmentInputSchema>;

export const attachmentsSchema = z
  .array(attachmentInputSchema)
  .max(ATTACHMENT_LIMITS.count)
  .optional()
  .describe(
    'Material the worker needs, which it reads from files. Prefer references for anything in the project, regardless of size: { source: "file", path, start_line?, end_line? }, or { source: "diff", paths? } for the uncommitted changes against HEAD including untracked files. Inline { source: "inline", format, text } is only for short content that exists only in this chat, such as decisions or notes. Every item needs a one-sentence summary.',
  );

/** A stored attachment's metadata. The content is a file in the task's attachment folder. */
export interface TaskAttachment {
  /** Its place in the request, from 1. */
  position: number;
  title: string;
  summary: string;
  format: AttachmentFormat;
  source: AttachmentSource;
  /** The project-relative path of a reference, or an inline item's label. */
  path?: string;
  /** The content's file name in the task's attachment folder. */
  file: string;
  chars: number;
  lines: number;
  /** Diff stats. */
  files?: number;
  additions?: number;
  deletions?: number;
}

/** An attachment as Chat lists it under the request, without its private file name. */
export type RequestAttachment = Omit<TaskAttachment, "file">;

/** The most bytes of content one `app_get_attachment` page holds. */
export const ATTACHMENT_PAGE_BYTES = 512 * 1024;

/** A page of an attachment's content, as `app_get_attachment` returns it. */
export interface AttachmentPage {
  attachment: RequestAttachment;
  /** "unavailable": the stored file is missing, larger than any attachment or not UTF-8 text. */
  state: "present" | "unavailable";
  /** UTF-8 text; this page's part of it. */
  content?: string;
  /** Pass back to read the next part; absent on the last one. */
  next_cursor?: string;
}
