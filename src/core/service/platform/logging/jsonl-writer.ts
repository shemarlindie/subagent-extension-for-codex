import { appendFile, chmod, rename, stat } from "node:fs/promises";

export interface JsonlOptions {
  maxBytes?: number;
  backups?: number;
  maxPendingBytes?: number;
}

/** A single-process, serialized writer. Overflow drops records instead of blocking work. */
export class JsonlWriter {
  private writes = Promise.resolve();
  private size?: number;
  private pendingBytes = 0;
  private dropped = 0;
  private failureReported = false;
  private readonly maxBytes: number;
  private readonly backups: number;
  private readonly maxPendingBytes: number;

  constructor(
    private readonly path: string,
    options: JsonlOptions = {},
  ) {
    for (const value of [
      options.maxBytes,
      options.backups,
      options.maxPendingBytes,
    ]) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
        throw new Error("Log writer limits must be positive integers");
      }
    }

    this.maxBytes = options.maxBytes ?? 5_000_000;
    this.backups = options.backups ?? 3;
    this.maxPendingBytes = options.maxPendingBytes ?? 1_000_000;
  }

  write(record: Record<string, unknown>) {
    let line: string;

    try {
      line = `${JSON.stringify(record)}\n`;
    } catch {
      this.dropped++;

      return;
    }

    const bytes = Buffer.byteLength(line);

    if (
      bytes > this.maxBytes ||
      this.pendingBytes + bytes > this.maxPendingBytes
    ) {
      this.dropped++;

      return;
    }

    this.pendingBytes += bytes;

    this.writes = this.writes.then(async () => {
      try {
        if (this.dropped) {
          const dropped = this.dropped;
          this.dropped = 0;

          await this.append(
            `${JSON.stringify({ timestamp: new Date().toISOString(), event: "logging.dropped", count: dropped })}\n`,
          );
        }

        await this.append(line);
        this.failureReported = false;
      } catch {
        this.size = undefined;

        if (!this.failureReported) {
          this.failureReported = true;

          // Do not recurse into logging or print paths and filesystem error messages.
          process.stderr.write(
            "Structured log write failed; records may be lost.\n",
          );
        }
      } finally {
        this.pendingBytes -= bytes;
      }
    });
  }

  flush() {
    return this.writes;
  }

  private async append(line: string) {
    const bytes = Buffer.byteLength(line);

    if (this.size === undefined) {
      try {
        this.size = (await stat(this.path)).size;
        await chmod(this.path, 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        this.size = 0;
      }
    }

    if (this.size > 0 && this.size + bytes > this.maxBytes) {
      await chmod(this.path, 0o600);

      for (let index = this.backups - 1; index >= 1; index--) {
        await chmod(`${this.path}.${index}`, 0o600)
          .then(() =>
            rename(`${this.path}.${index}`, `${this.path}.${index + 1}`),
          )
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          });
      }

      await rename(this.path, `${this.path}.1`);
      this.size = 0;
    }

    await appendFile(this.path, line, { mode: 0o600 });
    this.size += bytes;
  }
}
