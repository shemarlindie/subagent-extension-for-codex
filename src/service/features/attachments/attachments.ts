import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import { and, asc, eq } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/zod";
import { z } from "zod";

import { AttachmentError } from "../../../shared/attachments/attachment-error.js";
import {
  ATTACHMENT_LIMITS,
  type AttachmentFormat,
  type AttachmentInput,
  type StagedUploadInput,
  type TaskAttachment,
  type UploadInput,
} from "../../../shared/attachments/model.js";
import {
  uploadExtension,
  uploadMime,
} from "../../../shared/attachments/upload.js";
import { checkStored } from "../../platform/database/decode.js";
import { logError, logEvent } from "../../platform/logging/logger.js";
import type { Store } from "../tasks/storage/store.js";
import { attachmentPage } from "./attachment-page.js";
import { uncommittedDiff } from "./diff.js";
import { decodeText, lineCount, readProjectFile } from "./project-file.js";
import { taskAttachments } from "./schema.js";
import { decodeUpload, StagedFiles } from "./staged-files.js";

const rowSchema = createSelectSchema(taskAttachments, {
  paths: z.array(z.string()).nullable(),
});

const MARKDOWN = new Set([".md", ".markdown", ".mdx"]);
const TEXT = new Set(["", ".txt", ".text", ".log"]);

/** How a file's content displays, by its extension. */
function fileFormat(path: string): AttachmentFormat {
  const extension = extname(path).toLowerCase();
  if (MARKDOWN.has(extension)) return "markdown";

  return TEXT.has(extension) ? "text" : "code";
}

const formatExtension: Record<AttachmentFormat, string> = {
  image: "",
  document: "",
  diff: ".diff",
  code: ".txt",
  markdown: ".md",
  text: ".txt",
};

/** Extensions Claude Code's Read tool opens as images, PDFs or notebooks. */
const NOT_TEXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".pdf",
  ".ipynb",
]);

/**
 * The stored file's extension, which tells the worker's tools what it holds.
 * Code keeps its path's extension while that names text. A label is never
 * read, so other formats take their own.
 */
function storedExtension({ format, path, mime_type }: Resolved) {
  if (mime_type) return uploadExtension(mime_type);

  const extension = path === undefined ? "" : extname(path).toLowerCase();

  return format === "code" &&
    /^\.[a-z0-9_+-]{1,16}$/.test(extension) &&
    !NOT_TEXT.has(extension)
    ? extension
    : formatExtension[format];
}

const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "") || "attachment";

type Resolved = Omit<
  TaskAttachment,
  "message_id" | "position" | "file" | "chars" | "lines"
> & {
  content: string | Buffer;
};

function resolveUpload(
  input: UploadInput | StagedUploadInput,
  bytes: Buffer,
): Resolved {
  const mime = uploadMime(bytes, input.name);
  let format: AttachmentFormat = fileFormat(input.name);
  if (mime) format = mime.startsWith("image/") ? "image" : "document";

  return {
    title: input.name,
    path: input.name,
    source: "upload",
    summary: input.summary,
    format,
    ...(mime ? { mime_type: mime, bytes: bytes.length } : {}),
    content: mime ? bytes : decodeText(bytes, input.name),
  };
}

/** A reference's content and metadata, read from the project, or inline text. */
async function resolveAttachment(
  project: string,
  input: Exclude<AttachmentInput, { source: "upload" }>,
): Promise<Resolved> {
  if (input.source === "inline") {
    return {
      title: input.title ?? (input.path ? basename(input.path) : "Note"),
      summary: input.summary,
      format: input.format,
      source: "inline",
      ...(input.path === undefined ? {} : { path: input.path }),
      content: input.text,
    };
  }

  if (input.source === "diff") {
    const diff = await uncommittedDiff(
      project,
      input.paths,
      ATTACHMENT_LIMITS.messageBytes,
    );

    // A diff of one file is named after it.
    const [only, ...others] = diff.files;

    return {
      title:
        input.title ?? (only && !others.length ? only : "Uncommitted changes"),
      summary: input.summary,
      format: "diff",
      source: "diff",
      ...(input.paths?.length === 1 ? { path: input.paths[0] } : {}),
      ...(input.paths ? { paths: input.paths } : {}),
      content: diff.text,
      files: diff.files.length,
      additions: diff.additions,
      deletions: diff.deletions,
    };
  }

  const file = await readProjectFile(
    project,
    input.path,
    ATTACHMENT_LIMITS.messageBytes,
    input,
  );

  const ranged = input.start_line !== undefined || input.end_line !== undefined;
  const start = input.start_line ?? 1;
  // The copied range, which ends early when the file is shorter than end_line.
  const end = start + lineCount(file.text) - 1;

  return {
    title:
      input.title ??
      (ranged ? `${basename(file.path)}:${start}-${end}` : basename(file.path)),
    summary: input.summary,
    format: fileFormat(file.path),
    source: "file",
    path: file.path,
    ...(ranged ? { start_line: start, end_line: end } : {}),
    content: file.text,
  };
}

/** Generated task IDs, the only folder names the sweep removes. */
const TASK_FOLDER =
  /^task_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Task attachments: content snapshotted into one file each under
 * `<root>/<task id>/`, with metadata in `task_attachments`. Each message's
 * attachments are snapshotted when accepted and deleted with the task. Draft
 * files the user opens before sending are staged under `<root>/staged/`.
 */
export class Attachments {
  private realRoot?: string;
  readonly staged = new StagedFiles(() => join(this.base(), "staged"));

  constructor(
    private store: Store,
    private root: string,
  ) {}

  /**
   * The root's real path, since Claude Code matches folders as given. The
   * root itself must not be a link, so the sweep can't reach elsewhere.
   */
  private base() {
    if (!this.realRoot) {
      mkdirSync(this.root, { recursive: true, mode: 0o700 });

      if (lstatSync(this.root).isSymbolicLink()) {
        throw new Error(`The attachments folder ${this.root} is a link`);
      }

      this.realRoot = join(
        realpathSync(dirname(this.root)),
        basename(this.root),
      );
    }

    return this.realRoot;
  }

  /** The task's attachment folder, by its real path. */
  folder(taskId: string) {
    return join(this.base(), taskId);
  }

  /** Creates the task's folder when missing and returns its path. */
  ensureFolder(taskId: string) {
    const folder = this.folder(taskId);
    mkdirSync(folder, { recursive: true, mode: 0o700 });

    return folder;
  }

  /**
   * Snapshots each attachment of message `messageId` into the task's folder
   * as it resolves, and returns their metadata for the caller to save. File
   * names start with the message id, so messages never share one. If any
   * attachment fails, it removes what it wrote.
   */
  async prepare(
    taskId: string,
    project: string,
    inputs: AttachmentInput[],
    messageId: string,
  ) {
    if (!inputs.length) return [];
    const folder = this.ensureFolder(taskId);
    const rows: TaskAttachment[] = [];
    let bytes = 0;

    try {
      for (const [index, input] of inputs.entries()) {
        try {
          const resolved =
            input.source === "upload"
              ? resolveUpload(input, await this.uploadBytes(input))
              : await resolveAttachment(project, input);

          const { content, ...attachment } = resolved;
          bytes += Buffer.byteLength(content);

          if (bytes > ATTACHMENT_LIMITS.messageBytes) {
            throw new AttachmentError(
              `Attachments are over the ${ATTACHMENT_LIMITS.messageBytes / 1024 / 1024} MB message limit. Pass paths or a line range to attach less.`,
            );
          }

          const row = {
            ...attachment,
            message_id: messageId,
            position: index + 1,
            file: `${messageId}-${index + 1}-${slug(attachment.title)}${storedExtension(resolved)}`,
            chars: typeof content === "string" ? content.length : 0,
            lines: typeof content === "string" ? lineCount(content) : 0,
          };

          await writeFile(join(folder, row.file), content, {
            mode: 0o600,
            flag: "wx",
          });

          rows.push(row);
        } catch (error) {
          const label =
            input.source === "upload"
              ? input.name
              : (input.title ??
                (input.source === "diff" ? "diff" : (input.path ?? "note")));

          // Keeps the class, so logs tell caller mistakes from failures.
          const Wrapper =
            error instanceof AttachmentError ? AttachmentError : Error;

          throw new Wrapper(
            `Attachment ${index + 1} (${label}): ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
      }
    } catch (error) {
      await this.removeFiles(taskId, rows);
      throw error;
    }

    return rows;
  }

  /** An upload's bytes, from its content or its staged copy. */
  private async uploadBytes(input: UploadInput | StagedUploadInput) {
    return "data" in input
      ? decodeUpload(input.data)
      : await this.staged.read(input);
  }

  /** Removes a failed send's snapshots unless the send saved them first. */
  async discardUnsaved(taskId: string, rows: TaskAttachment[]) {
    const [first] = rows;
    // A send saves all its snapshots in one transaction, or none.
    if (!first || this.list(taskId, first.message_id).length) return;
    await this.removeFiles(taskId, rows);
  }

  /** Removes snapshot files. Failures are logged, and the files go with the task. */
  private async removeFiles(taskId: string, rows: TaskAttachment[]) {
    const folder = this.folder(taskId);

    for (const row of rows) {
      try {
        await rm(join(folder, row.file), { force: true });
      } catch (error) {
        logError("attachments.remove_failed", error, { task_id: taskId });
      }
    }
  }

  /** Saves the metadata. */
  save(taskId: string, rows: TaskAttachment[]) {
    if (!rows.length) return;

    this.store.database.orm
      .insert(taskAttachments)
      .values(rows.map((a) => ({ ...a, task_id: taskId })))
      .run();
  }

  /** A task's attachments, or those of message `messageId`, each message's in order. */
  list(taskId: string, messageId?: string): TaskAttachment[] {
    return this.store.database.orm
      .select()
      .from(taskAttachments)
      .where(
        and(
          eq(taskAttachments.task_id, taskId),
          messageId === undefined
            ? undefined
            : eq(taskAttachments.message_id, messageId),
        ),
      )
      .orderBy(asc(taskAttachments.position))
      .all()
      .map((row) => {
        const { task_id: _, ...stored } = checkStored(
          rowSchema,
          row,
          `attachment ${row.task_id}/${row.message_id}/${row.position}`,
        );

        return Object.fromEntries(
          Object.entries(stored).filter(([, value]) => value !== null),
        ) as unknown as TaskAttachment;
      });
  }

  /** An attachment, by its message and its place there. */
  private find(taskId: string, messageId: string, position: number) {
    const stored = this.list(taskId, messageId).find(
      (a) => a.position === position,
    );

    if (!stored) throw new AttachmentError("Attachment not found");

    return stored;
  }

  /** An attachment's stored file, for the host to open. */
  filePath(taskId: string, messageId: string, position: number) {
    const path = join(
      this.folder(taskId),
      this.find(taskId, messageId, position).file,
    );

    if (!existsSync(path)) {
      throw new AttachmentError("The attachment's stored file is missing.");
    }

    return path;
  }

  /** A page of an attachment, by its message and its place there. */
  async page(
    taskId: string,
    messageId: string,
    position: number,
    cursor?: string,
  ) {
    const { file, ...attachment } = this.find(taskId, messageId, position);

    const page = await attachmentPage(
      join(this.folder(taskId), file),
      attachment,
      cursor,
    );

    // The service wrote the file, so something else removed or changed it.
    if (page.state === "unavailable") {
      logEvent("warn", "attachments.unavailable", {
        task_id: taskId,
        message_id: messageId,
        position,
      });
    }

    return page;
  }

  /**
   * Removes the task's folder and returns whether it succeeded. A failure is
   * logged, and the startup sweep removes the folder once its task is gone.
   */
  async discard(taskId: string) {
    try {
      await rm(this.folder(taskId), { recursive: true, force: true });

      return true;
    } catch (error) {
      logError("attachments.remove_failed", error, { task_id: taskId });

      return false;
    }
  }

  /**
   * Removes task folders whose task is gone, left by a crash or a failed
   * removal, and expired staged copies. Leaves anything else in the root
   * alone.
   */
  async sweep(taskExists: (id: string) => boolean) {
    await this.staged.sweep();
    const entries = await readdir(this.base(), { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || !TASK_FOLDER.test(entry.name)) continue;
      if (taskExists(entry.name)) continue;

      if (await this.discard(entry.name)) {
        logEvent("info", "attachments.orphan_removed", { task_id: entry.name });
      }
    }
  }
}
