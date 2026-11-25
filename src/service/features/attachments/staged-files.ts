import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { AttachmentError } from "../../../shared/attachments/attachment-error.js";
import {
  ATTACHMENT_LIMITS,
  type StagedFile,
  type StagedUploadInput,
} from "../../../shared/attachments/model.js";
import { logError, logEvent } from "../../platform/logging/logger.js";

/** Content hashes, the only folder names the sweep removes. */
const STAGED_FOLDER = /^[0-9a-f]{64}$/;

/** How long a staged copy stays after it was last staged. */
const STAGED_TTL_MS = 24 * 60 * 60 * 1000;

const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

/** A file's bytes from its base64 content. */
export function decodeUpload(data: string) {
  const bytes = Buffer.from(data, "base64");

  if (
    !bytes.length ||
    bytes.length > ATTACHMENT_LIMITS.messageBytes ||
    bytes.toString("base64") !== data
  ) {
    throw new AttachmentError(
      `Invalid base64 or file exceeds ${ATTACHMENT_LIMITS.messageBytes / 1024 / 1024} MB.`,
    );
  }

  return bytes;
}

/**
 * Draft files the user opens before sending, staged under
 * `<root>/<content hash>/<name>` so the host can open them. A send can then
 * pass the hash in place of the content.
 */
export class StagedFiles {
  constructor(private root: () => string) {}

  /**
   * Writes a draft file where the host can open it and returns the copy.
   * Staging it again keeps it another day.
   */
  async stage(name: string, data: string): Promise<StagedFile> {
    const bytes = decodeUpload(data);
    const id = sha256(bytes);
    const folder = join(this.root(), id);
    const path = join(folder, name);

    await mkdir(folder, { recursive: true, mode: 0o700 });
    await writeFile(path, bytes, { mode: 0o600 });
    const now = new Date();
    await utimes(folder, now, now);

    this.sweep().catch((error) =>
      logError("attachments.staged_sweep_failed", error),
    );

    return { id, path };
  }

  /** A staged copy's bytes, which must still match its hash. */
  async read({ staged, name }: StagedUploadInput) {
    const bytes = await readFile(join(this.root(), staged, name)).catch(
      () => undefined,
    );

    if (!bytes || sha256(bytes) !== staged) {
      throw new AttachmentError(
        "Its opened copy expired or changed. Remove the file and attach it again.",
      );
    }

    return bytes;
  }

  /** Removes copies that weren't staged again within a day. */
  async sweep(now = Date.now()) {
    const root = this.root();
    if (!existsSync(root)) return;
    let removed = 0;

    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !STAGED_FOLDER.test(entry.name)) continue;
      const folder = join(root, entry.name);

      if (now - (await stat(folder)).mtimeMs > STAGED_TTL_MS) {
        await rm(folder, { recursive: true, force: true });
        removed++;
      }
    }

    if (removed) logEvent("info", "attachments.staged_removed", { removed });
  }
}
