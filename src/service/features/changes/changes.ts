import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  type ChangedFileContent,
  type Changes as ChangesResult,
  CHANGES_PAGE_CHARS,
  type ChangeScope,
  decodeCursor,
  decodeFileCursor,
  diffPage,
  encodeCursor,
  encodeFileCursor,
  imageMime,
  isBinary,
} from "../../../shared/changes/changes.js";
import type { Task } from "../../../shared/tasks/model.js";
import { formatFileDiff } from "./compose.js";
import { changePath } from "./paths.js";
import { ChangeStore, type RecordedChange } from "./store.js";

const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

/** List metadata does not depend on the current workspace. */
function listedFile(row: RecordedChange) {
  let status: "added" | "deleted" | "modified" = "modified";
  if (row.created) status = "added";
  else if (row.deleted) status = "deleted";

  const count = (prefix: string) =>
    row.incomplete
      ? 0
      : row.hunks.reduce(
          (sum, h) =>
            sum + h.lines.filter((line) => line.startsWith(prefix)).length,
          0,
        );

  return {
    path: row.path,
    status,
    additions: count("+"),
    deletions: count("-"),
    source: row.source,
    incomplete: row.incomplete,
  };
}

/** The file list and totals shared by full reads and counts. */
function listing(task: Task, rows: RecordedChange[]) {
  const files = rows.filter((row) => row.path).map(listedFile);

  return {
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    ...(rows.some((row) => !row.path) ? { unrecorded_commands: true } : {}),
    ...(task.branch ? { branch: task.branch } : {}),
  };
}

function filePage(
  path: string,
  bytes: Buffer,
  cursor: string | undefined,
  pageChars: number,
): ChangedFileContent {
  const image = imageMime(path);

  if (!image && isBinary(bytes)) {
    return { path, state: "binary", size: bytes.length };
  }

  const revision = hash(bytes);
  const page = cursor ? decodeFileCursor(cursor) : undefined;
  if (page && page.tree !== revision) throw new Error("Stale file cursor");
  const offset = page?.offset ?? 0;
  const content = bytes.toString(image ? "base64" : "utf8");
  if (offset > content.length) throw new Error("Invalid file cursor");
  const end = offset + pageChars;

  return {
    path,
    state: "present",
    size: bytes.length,
    encoding: image ? "base64" : "utf8",
    ...(image ? { mime_type: image } : {}),
    content: content.slice(offset, end),
    ...(end < content.length
      ? { next_cursor: encodeFileCursor(revision, end) }
      : {}),
  };
}

/** Both tool audiences read the same durable task edits. */
export class Changes extends ChangeStore {
  changes(
    task: Task,
    scope: ChangeScope = "task",
    cursor?: string,
    pageChars = CHANGES_PAGE_CHARS,
  ): ChangesResult {
    const rows = this.rows(task, scope);

    const parts = rows
      .filter((row) => row.path && !row.incomplete)
      .map((row) =>
        formatFileDiff(row.path, row.hunks, row.created, row.deleted),
      );

    const revision = hash(JSON.stringify(rows));
    const page = cursor ? decodeCursor(cursor) : undefined;

    if (
      page &&
      (page.base !== revision ||
        page.current !== hash(`${task.id}/${scope}`) ||
        page.index > parts.length)
    ) {
      throw new Error("Stale changes cursor");
    }

    const { diff, end } = diffPage(parts, page?.index ?? 0, pageChars);

    return {
      scope,
      ...listing(task, rows),
      diff,
      ...(end < parts.length
        ? {
            next_cursor: encodeCursor(
              revision,
              hash(`${task.id}/${scope}`),
              end,
            ),
          }
        : {}),
    };
  }

  counts(task: Task) {
    const { files, ...totals } = listing(task, this.rows(task, "task"));

    return { scope: "task" as const, ...totals, files: files.length };
  }

  async changedFile(
    task: Task,
    path: string,
    cursor?: string,
    pageChars = CHANGES_PAGE_CHARS,
  ): Promise<ChangedFileContent> {
    if (
      !path ||
      ![...this.rows(task, "task"), ...this.rows(task, "turn")].some(
        (row) => row.path === path,
      )
    ) {
      throw new Error(`${path} is not among this task's changes.`);
    }

    if (
      !task.workspace ||
      !(await access(task.workspace).then(
        () => true,
        () => false,
      ))
    ) {
      return { path, state: "unavailable", size: 0 };
    }

    if (changePath(task.workspace, path) !== path) {
      throw new Error("Path outside task workspace or Git metadata");
    }

    let bytes: Buffer;

    try {
      bytes = await readFile(resolve(task.workspace, path));
    } catch (error) {
      if (
        ["ENOENT", "ENOTDIR"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      ) {
        return { path, state: "deleted", size: 0 };
      }

      throw error;
    }

    return filePage(path, bytes, cursor, pageChars);
  }
}
