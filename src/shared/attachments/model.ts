import { z } from "zod";

/** Bounds on one message's attachments. Reference sizes count UTF-8 bytes. */
export const ATTACHMENT_LIMITS = {
  count: 20,
  summaryChars: 200,
  titleChars: 60,
  inlineChars: 8_000,
  referenceBytes: 2 * 1024 * 1024,
  messageBytes: 10 * 1024 * 1024,
  paths: 50,
  pathChars: 1024,
} as const;

const textFormats = ["diff", "code", "markdown", "text"] as const;
export const attachmentFormats = [...textFormats, "image"] as const;
export type AttachmentFormat = (typeof attachmentFormats)[number];

export const attachmentSources = ["inline", "diff", "file", "upload"] as const;

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
  format: z.enum(textFormats),
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

const uploadSchema = z.strictObject({
  source: z.literal("upload"),
  name: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[^/\\\p{Cc}]+$/u),
  summary,
  data: z
    .string()
    .min(4)
    .max(4 * Math.ceil(ATTACHMENT_LIMITS.referenceBytes / 3)),
});

export type UploadInput = z.infer<typeof uploadSchema>;

export type AttachmentInput =
  z.infer<typeof attachmentInputSchema> | UploadInput;

export const panelAttachmentsSchema = z
  .array(z.union([attachmentInputSchema, uploadSchema]))
  .max(ATTACHMENT_LIMITS.count)
  .optional();

export const attachmentsSchema = z
  .array(attachmentInputSchema)
  .max(ATTACHMENT_LIMITS.count)
  .optional()
  .describe(
    'Material the worker needs, which it reads from files. Prefer references for anything in the project, regardless of size: { source: "file", path, start_line?, end_line? }, or { source: "diff", paths? } for the uncommitted changes against HEAD including untracked files. Inline { source: "inline", format, text } is only for short content that exists only in this chat, such as decisions or notes. Every item needs a one-sentence summary.',
  );

/** A stored attachment's metadata. The content is a file in the task's attachment folder. */
export interface TaskAttachment {
  /** The message it came with: a follow-up's id, or `request`. */
  message_id: string;
  /** Its place in that message, from 1. */
  position: number;
  title: string;
  summary: string;
  format: AttachmentFormat;
  source: AttachmentSource;
  /** A reference's project-relative path or the display filename of supplied content. */
  path?: string;
  /** The content's file name in the task's attachment folder. */
  file: string;
  bytes?: number;
  mime_type?: string;
  chars: number;
  lines: number;
  /** Diff stats. */
  files?: number;
  additions?: number;
  deletions?: number;
  /** The project paths a diff was limited to. Absent for the whole project. */
  paths?: string[];
  /** The lines a ranged file reference copied, from 1. Absent for a whole file. */
  start_line?: number;
  end_line?: number;
}

/** An attachment as Chat lists it under its message, without where it's stored. */
export type MessageAttachment = Omit<TaskAttachment, "file">;

/** The most bytes of content one `app_get_attachment` page holds. */
export const ATTACHMENT_PAGE_BYTES = 512 * 1024;

/** A page of an attachment's content, as `app_get_attachment` returns it. */
export interface AttachmentPage {
  attachment: MessageAttachment;
  /** "unavailable": the stored file is missing, too large or invalid for its stored format. */
  state: "present" | "unavailable";
  /** This page of UTF-8 text or base64 image data. */
  content?: string;
  encoding?: "base64";
  mime_type?: string;
  /** Pass back to read the next part; absent on the last one. */
  next_cursor?: string;
}
