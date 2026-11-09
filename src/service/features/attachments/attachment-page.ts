import { createHash } from "node:crypto";
import { type FileHandle, open } from "node:fs/promises";

import {
  ATTACHMENT_LIMITS,
  ATTACHMENT_PAGE_BYTES,
  type AttachmentPage,
  type RequestAttachment,
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
  while (start > 0 && end - start < 3 && (bytes[start - 1]! & 0xc0) === 0x80) {
    start--;
  }

  const lead = bytes[start - 1];
  if (lead === undefined || lead < 0xc0) return end;
  // A lead byte's leading 1 bits give its character's length.
  const length = 2 + Number(lead >= 0xe0) + Number(lead >= 0xf0);

  return start - 1 + length <= end ? end : start - 1;
}

/** The whole stored file, or undefined when it is gone or not one a task wrote. */
async function storedBytes(path: string) {
  let file: FileHandle;

  try {
    file = await open(path, OPEN_FLAGS);
  } catch {
    return undefined;
  }

  try {
    const info = await file.stat();

    if (!info.isFile() || info.size > ATTACHMENT_LIMITS.referenceBytes) {
      return undefined;
    }

    // One byte more shows a file that grew after the size was read.
    const bytes = Buffer.alloc(info.size + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);

    return bytesRead === info.size ? bytes.subarray(0, bytesRead) : undefined;
  } finally {
    await file.close();
  }
}

/**
 * One page of an attachment's stored file, ending on a whole character. Each
 * page reads the whole file, at most 2 MiB, and its cursor carries the
 * content's hash, so pages never mix two versions of a file. A file that is
 * gone, isn't a regular file, is larger than any attachment or isn't UTF-8
 * text is unavailable.
 */
export async function attachmentPage(
  path: string,
  attachment: RequestAttachment,
  cursor?: string,
): Promise<AttachmentPage> {
  const unavailable = { attachment, state: "unavailable" } as const;
  const bytes = await storedBytes(path);
  if (!bytes) return unavailable;
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

  try {
    decoder.decode(bytes);
  } catch {
    return unavailable;
  }

  const revision = createHash("sha256").update(bytes).digest("hex");
  const page = cursor ? decodeFileCursor(cursor) : undefined;

  if (page && page.tree !== revision) {
    throw new Error("The attachment changed while it was read");
  }

  const offset = page?.offset ?? 0;
  if (offset > bytes.length) throw new Error("Invalid file cursor");
  const end = Math.min(offset + ATTACHMENT_PAGE_BYTES, bytes.length);
  const stop = end === bytes.length ? end : characterBoundary(bytes, end);

  return {
    attachment,
    state: "present",
    content: decoder.decode(bytes.subarray(offset, stop)),
    ...(stop < bytes.length
      ? { next_cursor: encodeFileCursor(revision, stop) }
      : {}),
  };
}
