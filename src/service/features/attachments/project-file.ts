import { constants } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { resolve } from "node:path";

import { isBinary } from "../../../shared/changes/changes.js";
import { changePath } from "../changes/paths.js";

const CHUNK_BYTES = 64 * 1024;

/**
 * Doesn't follow a link swapped in after the path was resolved, and doesn't
 * wait on a FIFO. Windows has neither flag, which `|` reads as 0.
 */
export const OPEN_FLAGS =
  constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/** An error the caller names with its attachment. */
export class AttachmentError extends Error {}

/** UTF-8 text, keeping any byte order mark, or an error for bytes that aren't text. */
export function decodeText(bytes: Uint8Array, name: string) {
  if (isBinary(bytes)) throw new AttachmentError(`${name} is a binary file.`);

  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new AttachmentError(`${name} isn't UTF-8 text.`);
  }
}

/** The number of lines in a text, counting a last line without a newline. */
export function lineCount(text: string) {
  let lines = 0;

  for (
    let at = text.indexOf("\n");
    at !== -1;
    at = text.indexOf("\n", at + 1)
  ) {
    lines++;
  }

  return text && !text.endsWith("\n") ? lines + 1 : lines;
}

/**
 * A project file's path relative to the project, after resolving symlinks.
 * Rejects paths outside the project or in Git metadata.
 */
export function projectPath(project: string, path: string) {
  const relative = changePath(project, path);

  if (relative === undefined) {
    throw new AttachmentError(
      `${path} is outside the project folder or in Git metadata.`,
    );
  }

  return relative;
}

/**
 * Lines `start` to `end` of a file, or to its end, as bytes. Reads in chunks
 * and keeps one slice of each, so lines before the range cost no memory.
 * Fails once the selection passes `limit` bytes, or when the file starts
 * with binary data, even outside the range.
 */
async function readLines(
  file: FileHandle,
  name: string,
  start: number,
  end: number | undefined,
  limit: number,
  tooLarge: () => Error,
) {
  const parts: Buffer[] = [];
  const buffer = Buffer.alloc(CHUNK_BYTES);
  let size = 0;
  let line = 1;
  let first = true;

  for (;;) {
    const { bytesRead } = await file.read(buffer, 0, CHUNK_BYTES, null);
    if (!bytesRead) break;
    const chunk = buffer.subarray(0, bytesRead);

    if (first && isBinary(chunk)) {
      throw new AttachmentError(`${name} is a binary file.`);
    }

    first = false;
    let from = line >= start ? 0 : -1;
    let to = chunk.length;
    let done = false;
    let offset = 0;

    while (line < start || end !== undefined) {
      const newline = chunk.indexOf(10, offset);
      if (newline === -1) break;
      offset = newline + 1;
      line++;
      if (line === start) from = offset;

      if (end !== undefined && line > end) {
        to = offset;
        done = true;
        break;
      }
    }

    if (from !== -1 && to > from) {
      size += to - from;
      if (size > limit) throw tooLarge();
      parts.push(Buffer.from(chunk.subarray(from, to)));
    }

    if (done) break;
  }

  return Buffer.concat(parts);
}

/**
 * A regular project file's text, or the selected lines. `limit` bounds the
 * bytes read into memory.
 */
export async function readProjectFile(
  project: string,
  path: string,
  limit: number,
  range: { start_line?: number; end_line?: number } = {},
) {
  const relative = projectPath(project, path);
  let file: FileHandle;

  try {
    file = await open(resolve(project, relative), OPEN_FLAGS);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new AttachmentError(`${relative} doesn't exist.`);
    }

    if (code === "ELOOP") {
      throw new AttachmentError(`${relative} changed while it was read.`);
    }

    throw error;
  }

  try {
    const info = await file.stat();

    if (!info.isFile()) {
      throw new AttachmentError(`${relative} isn't a regular file.`);
    }

    const ranged =
      range.start_line !== undefined || range.end_line !== undefined;

    const tooLarge = () =>
      new AttachmentError(
        `${relative} is over the ${limit / 1024 / 1024} MB attachment limit${ranged ? " for the selected lines" : ""}. Attach a line range with start_line and end_line.`,
      );

    if (!ranged && info.size > limit) throw tooLarge();

    const bytes = await readLines(
      file,
      relative,
      range.start_line ?? 1,
      range.end_line,
      limit,
      tooLarge,
    );

    if (ranged && !bytes.length) {
      throw new AttachmentError(
        `${relative} has fewer than ${range.start_line ?? 1} lines.`,
      );
    }

    return {
      path: relative,
      mode: info.mode,
      text: decodeText(bytes, relative),
    };
  } finally {
    await file.close();
  }
}
