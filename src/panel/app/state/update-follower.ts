import type {
  DraftRead,
  DraftTarget,
} from "../../features/tasks/chat/drafts/draft-follower";

interface UpdateContext {
  closed(): boolean;
  tool<T>(name: string, args: Record<string, unknown>): Promise<T>;
  status(text: string): void;
  revision(value: string): void;
  draftTarget(): DraftTarget | undefined;
  /** Applies the target's draft; returns whether it changed. */
  receiveDraft(target: DraftTarget, read: DraftRead): boolean;
}

type UpdateRead = { revision: string } & Partial<DraftRead>;

/** How long one wait holds for a change; the service allows up to 25 s. */
const WAIT_MS = 20000;
/** The least time between waits, so a fast draft renders at most this often. */
const READ_GAP_MS = 100;
/** How long a wait that returned at once with nothing new pauses. */
const IDLE_PAUSE_MS = 1000;
const FIRST_RETRY_MS = 2000;
const MAX_RETRY_MS = 30000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Follows the service on transports that can't stream changes: one wait at a
 * time returns the revision when it changes, and the shown draft when that
 * changes, so the panel holds a single long poll.
 */
export class UpdateFollower {
  private following = false;
  private revision?: string;
  constructor(private context: UpdateContext) {}

  follow() {
    if (this.following) return;
    this.following = true;
    void this.loop().finally(() => (this.following = false));
  }

  private async loop() {
    let retryMs = FIRST_RETRY_MS;

    while (!this.context.closed()) {
      // A target chosen while a wait holds is picked up on its next return.
      const target = this.context.draftTarget();
      const started = Date.now();
      let read: UpdateRead;

      try {
        read = await this.context.tool<UpdateRead>("app_wait_for_updates", {
          ...(this.revision === undefined ? {} : { after: this.revision }),
          ...(target ? { draft: target } : {}),
          wait_ms: WAIT_MS,
        });
      } catch {
        if (this.context.closed()) return;
        this.context.status("Reconnecting…");
        await sleep(retryMs);
        retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
        continue;
      }

      if (this.context.closed()) return;
      retryMs = FIRST_RETRY_MS;
      this.context.status("● Live");
      let changed = read.revision !== this.revision;
      this.revision = read.revision;
      this.context.revision(read.revision);

      if (target && read.draft !== undefined) {
        const draft = { draft: read.draft, running: read.running ?? false };
        changed = this.context.receiveDraft(target, draft) || changed;
      }

      // A wait that came back at once with nothing new pauses, so a loop
      // can't spin, and waits stay READ_GAP_MS apart.
      const elapsed = Date.now() - started;

      if (!changed && elapsed < 500) await sleep(IDLE_PAUSE_MS);
      else if (elapsed < READ_GAP_MS) await sleep(READ_GAP_MS - elapsed);
    }
  }
}
