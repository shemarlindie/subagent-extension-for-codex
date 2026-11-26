import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  CHANGES_PAGE_CHARS,
  decodeCursor,
  decodeFileCursor,
  diffPage,
  encodeCursor,
  encodeFileCursor,
  imageMime,
  isBinary,
  type ChangeCounts,
  type ChangedFileContent,
  type ChangeList,
  type ChangeScope,
  type Changes as ChangesResult,
  type FileChange,
} from "../../../shared/changes/changes.js";
import type { Task } from "../../../shared/tasks/model.js";
import { formatFileDiff } from "./compose.js";
import { changePath } from "./paths.js";
import { ChangeStore, hash, type RecordedChange } from "./store.js";

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

/** The panel's file entry: its signature comes from the recorded row, so it needs no diff. */
function signedFile(row: RecordedChange) {
  const file = listedFile(row);
  const { incomplete, source, hunks } = row;

  return {
    ...file,
    signature: hash(JSON.stringify([file.status, incomplete, source, hunks])),
  };
}

/** The file list and totals shared by full reads, the panel's list and counts. */
function listing<F extends ReturnType<typeof listedFile>>(
  task: Task,
  rows: RecordedChange[],
  toFile: (row: RecordedChange) => F,
) {
  const files = rows.filter((row) => row.path).map(toFile);

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
    const { rows, revision } = this.revisedRows(task, scope);

    const parts = rows
      .filter((row) => row.path && !row.incomplete)
      .map((row) =>
        formatFileDiff(row.path, row.hunks, row.created, row.deleted),
      );

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
      ...listing(task, rows, listedFile),
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

  changeList(task: Task, scope: ChangeScope): ChangeList {
    const { rows, revision } = this.revisedRows(task, scope);

    return { scope, ...listing(task, rows, signedFile), revision };
  }

  /** One listed file's diff, as long as the recorded changes match the list's revision. */
  fileChange(
    task: Task,
    scope: ChangeScope,
    path: string,
    revision: string,
  ): FileChange {
    if (this.revision(task, scope) !== revision) return { stale: true };
    const row = path ? this.row(task, scope, path) : undefined;
    if (!row) throw new Error(`${path} is not among this task's changes.`);
    if (row.incomplete) return { stale: false };

    return {
      stale: false,
      diff: formatFileDiff(row.path, row.hunks, row.created, row.deleted),
    };
  }

  counts(task: Task): ChangeCounts {
    const { files, ...totals } = listing(
      task,
      this.rows(task, "task"),
      listedFile,
    );

    return { scope: "task", ...totals, files: files.length };
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
