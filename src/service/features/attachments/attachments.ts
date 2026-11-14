import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import { asc, eq } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/zod";
import { z } from "zod";

import { AttachmentError } from "../../../shared/attachments/attachment-error.js";
import {
  ATTACHMENT_LIMITS,
  type AttachmentFormat,
  type AttachmentInput,
  type TaskAttachment,
} from "../../../shared/attachments/model.js";
import { checkStored } from "../../platform/database/decode.js";
import { logError, logEvent } from "../../platform/logging/logger.js";
import type { Store } from "../tasks/storage/store.js";
import { attachmentPage } from "./attachment-page.js";
import { uncommittedDiff } from "./diff.js";
import { lineCount, readProjectFile } from "./project-file.js";
import { taskAttachments } from "./schema.js";

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
function storedExtension(format: AttachmentFormat, path?: string) {
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
  "position" | "file" | "chars" | "lines"
> & {
  text: string;
};

/** An attachment's content and metadata, read from the project for references. */
async function resolveAttachment(
  project: string,
  input: AttachmentInput,
): Promise<Resolved> {
  if (input.source === "inline") {
    return {
      title: input.title ?? (input.path ? basename(input.path) : "Note"),
      summary: input.summary,
      format: input.format,
      source: "inline",
      ...(input.path === undefined ? {} : { path: input.path }),
      text: input.text,
    };
  }

  if (input.source === "diff") {
    const diff = await uncommittedDiff(
      project,
      input.paths,
      ATTACHMENT_LIMITS.referenceBytes,
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
      text: diff.text,
      files: diff.files.length,
      additions: diff.additions,
      deletions: diff.deletions,
    };
  }

  const file = await readProjectFile(
    project,
    input.path,
    ATTACHMENT_LIMITS.referenceBytes,
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
    text: file.text,
  };
}

/** Generated task IDs, the only folder names the sweep removes. */
const TASK_FOLDER =
  /^task_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Task attachments: content snapshotted into one file each under
 * `<root>/<task id>/`, with metadata in `task_attachments`. They never change
 * after the task starts and go with the task.
 */
export class Attachments {
  private realRoot?: string;

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

  /**
   * Snapshots each attachment into the task's folder as it resolves, and
   * returns their metadata for the caller to save. Removes the folder if any
   * attachment fails, and the caller removes it if the start fails later.
   */
  async prepare(taskId: string, project: string, inputs: AttachmentInput[]) {
    if (!inputs.length) return [];
    const folder = this.folder(taskId);
    const rows: TaskAttachment[] = [];
    let bytes = 0;
    await mkdir(folder, { mode: 0o700 });

    try {
      for (const [index, input] of inputs.entries()) {
        const position = index + 1;

        try {
          const { text, ...attachment } = await resolveAttachment(
            project,
            input,
          );

          bytes += Buffer.byteLength(text);

          if (bytes > ATTACHMENT_LIMITS.taskBytes) {
            throw new AttachmentError(
              `Attachments are over the ${ATTACHMENT_LIMITS.taskBytes / 1024 / 1024} MB task limit. Pass paths or a line range to attach less.`,
            );
          }

          const row = {
            ...attachment,
            position,
            file: `${position}-${slug(attachment.title)}${storedExtension(attachment.format, attachment.path)}`,
            chars: text.length,
            lines: lineCount(text),
          };

          await writeFile(join(folder, row.file), text, {
            mode: 0o600,
            flag: "wx",
          });

          rows.push(row);
        } catch (error) {
          const label =
            input.title ??
            (input.source === "diff" ? "diff" : (input.path ?? "note"));

          // Keeps the class, so logs tell caller mistakes from failures.
          const Wrapper =
            error instanceof AttachmentError ? AttachmentError : Error;

          throw new Wrapper(
            `Attachment ${position} (${label}): ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
      }
    } catch (error) {
      await this.discard(taskId);
      throw error;
    }

    return rows;
  }

  /** Saves the metadata. The start runs this in its transaction. */
  save(taskId: string, attachments: TaskAttachment[]) {
    if (!attachments.length) return;

    this.store.database.orm
      .insert(taskAttachments)
      .values(attachments.map((a) => ({ ...a, task_id: taskId })))
      .run();
  }

  /** A task's attachments, in the order sent. */
  list(taskId: string): TaskAttachment[] {
    return this.store.database.orm
      .select()
      .from(taskAttachments)
      .where(eq(taskAttachments.task_id, taskId))
      .orderBy(asc(taskAttachments.position))
      .all()
      .map((row) => {
        const { task_id: _, ...stored } = checkStored(
          rowSchema,
          row,
          `attachment ${row.task_id}/${row.position}`,
        );

        return Object.fromEntries(
          Object.entries(stored).filter(([, value]) => value !== null),
        ) as unknown as TaskAttachment;
      });
  }

  /** A page of one of the task's attachments, by its position. */
  async page(taskId: string, position: number, cursor?: string) {
    const stored = this.list(taskId).find((a) => a.position === position);
    if (!stored) throw new AttachmentError("Attachment not found");
    const { file, ...attachment } = stored;

    const page = await attachmentPage(
      join(this.folder(taskId), file),
      attachment,
      cursor,
    );

    // The service wrote the file, so something else removed or changed it.
    if (page.state === "unavailable") {
      logEvent("warn", "attachments.unavailable", {
        task_id: taskId,
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
   * removal. Leaves anything else in the root alone.
   */
  async sweep(taskExists: (id: string) => boolean) {
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
