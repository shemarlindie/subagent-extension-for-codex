import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";

import { fileMime } from "../../../shared/attachments/file-type.js";
import {
  ATTACHMENT_LIMITS,
  ATTACHMENT_PAGE_BYTES,
  isBinaryFormat,
  type AttachmentPage,
  type MessageAttachment,
} from "../../../shared/attachments/model.js";
import {
  decodeFileCursor,
  encodeFileCursor,
} from "../../../shared/changes/changes.js";
import { OPEN_FLAGS } from "./project-file.js";

/**
 * Where a page of UTF-8 bytes can end without splitting a character: `end`,
 * or the start of a character the page would cut short.
 */
function characterBoundary(bytes: Uint8Array, end: number) {
  let start = end;

  // Continuation bytes are 10xxxxxx; a character has at most three.
  while (end - start < 3) {
    const byte = bytes[start - 1];
    if (byte === undefined || (byte & 0xc0) !== 0x80) break;
    start--;
  }

  const lead = bytes[start - 1];
  if (lead === undefined || lead < 0xc0) return end;
  // A lead byte's leading 1 bits give its character's length.
  const length = 2 + Number(lead >= 0xe0) + Number(lead >= 0xf0);

  return start - 1 + length <= end ? end : start - 1;
}

/** One version of a stored file, recognized without reading its content. */
const revisionOf = (info: BigIntStats) =>
  createHash("sha256")
    .update(`${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}`)
    .digest("hex");

/** Reads `length` bytes at `offset`, or undefined when the file is shorter. */
async function readRange(file: FileHandle, offset: number, length: number) {
  const bytes = Buffer.alloc(length);
  const { bytesRead } = await file.read(bytes, 0, length, offset);

  return bytesRead === length ? bytes : undefined;
}

/** Whether the whole file still holds what was stored: its format, or UTF-8 text. */
async function validContent(
  file: FileHandle,
  size: number,
  attachment: MessageAttachment,
) {
  // One byte more shows a file that grew after the size was read.
  const bytes = Buffer.alloc(size + 1);
  const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
  if (bytesRead !== size) return false;
  const content = bytes.subarray(0, size);

  try {
    if (isBinaryFormat(attachment.format)) {
      return (
        attachment.bytes === size &&
        fileMime(content, attachment.path ?? attachment.title) ===
          attachment.mime_type
      );
    }

    new TextDecoder("utf-8", { fatal: true }).decode(content);

    return true;
  } catch {
    return false;
  }
}

/**
 * One page of an attachment's stored file, ending on a whole character. The
 * first page checks the whole file, and later pages read only their range.
 * A cursor fails if the file changed after the page that returned it. A file
 * that is gone, isn't a regular file, is larger than any attachment or doesn't
 * match its stored format is unavailable.
 */
export async function attachmentPage(
  path: string,
  attachment: MessageAttachment,
  cursor?: string,
): Promise<AttachmentPage> {
  const unavailable = { attachment, state: "unavailable" } as const;
  const page = cursor ? decodeFileCursor(cursor) : undefined;
  let file: FileHandle;

  try {
    file = await open(path, OPEN_FLAGS);
  } catch {
    return unavailable;
  }

  try {
    const info = await file.stat({ bigint: true });

    if (!info.isFile() || info.size > ATTACHMENT_LIMITS.messageBytes) {
      return unavailable;
    }

    const size = Number(info.size);
    const revision = revisionOf(info);

    if (page && page.tree !== revision) {
      throw new Error("The attachment changed while it was read");
    }

    if (!page && !(await validContent(file, size, attachment))) {
      return unavailable;
    }

    const offset = page?.offset ?? 0;
    if (offset > size) throw new Error("Invalid file cursor");
    const binary = isBinaryFormat(attachment.format);

    // Full binary pages end on a base64 group so their strings can be joined.
    const end = Math.min(
      offset +
        (binary
          ? ATTACHMENT_PAGE_BYTES - (ATTACHMENT_PAGE_BYTES % 3)
          : ATTACHMENT_PAGE_BYTES),
      size,
    );

    const bytes = await readRange(file, offset, end - offset);
    if (!bytes) throw new Error("The attachment changed while it was read");

    const stop =
      binary || end === size
        ? end
        : offset + characterBoundary(bytes, bytes.length);

    const chunk = bytes.subarray(0, stop - offset);
    let content: string;

    if (binary) {
      content = chunk.toString("base64");
    } else {
      try {
        content = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(chunk);
      } catch {
        // A cursor from this function starts on a whole character.
        throw new Error("Invalid file cursor");
      }
    }

    return {
      attachment,
      state: "present",
      ...(binary
        ? { encoding: "base64" as const, mime_type: attachment.mime_type }
        : {}),
      content,
      ...(stop < size ? { next_cursor: encodeFileCursor(revision, stop) } : {}),
    };
  } finally {
    await file.close();
  }
}
