import type {
  DraftRead,
  DraftTarget,
} from "../../features/tasks/chat/drafts/draft-follower";
import { randomId } from "../../shared/utils/random-id";
import { CONNECTION, type ConnectionLabel } from "./connection";
import type { UpdateRead, ViewRequest } from "./panel-view";

interface UpdateContext {
  closed(): boolean;
  tool<T>(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<T>;
  status(text: ConnectionLabel): void;
  /** The view to ask each wait for, or none while the panel can't use one. */
  viewRequest(): ViewRequest | undefined;
  /**
   * Takes a wait that returned a view or a new revision. `request` is the
   * view it asked for, if any.
   */
  receive(read: UpdateRead, request?: ViewRequest): Promise<void>;
  draftTarget(): DraftTarget | undefined;
  /** Applies the target's draft; returns whether it changed. */
  receiveDraft(target: DraftTarget, read: DraftRead): boolean;
}

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
 * time returns the panel's view when the revision changes or the wait runs
 * out, and the shown draft when that changes, so the panel holds a single
 * long poll and needs no read after it returns.
 */
export class UpdateFollower {
  private following = false;
  private revision?: string;
  /** The wait in flight, and the draft task it follows. */
  private held?: { task?: string; abort: AbortController };
  constructor(private context: UpdateContext) {}

  /**
   * Ends the held wait when the draft target names another task, so the next
   * wait follows it at once. A target that becomes none keeps the wait.
   */
  retarget() {
    const task = this.context.draftTarget()?.task_id;

    if (this.held && task !== undefined && task !== this.held.task) {
      this.held.abort.abort();
    }
  }

  /** Starts following from `revision`, the one the panel last read, if any. */
  follow(revision?: string) {
    if (this.following) return;
    this.following = true;
    this.revision = revision;
    void this.loop().finally(() => (this.following = false));
  }

  private async loop() {
    let retryMs = FIRST_RETRY_MS;
    /** The wait the panel ended, which the service may still hold. */
    let replaces: string | undefined;

    while (!this.context.closed()) {
      // A view chosen while a wait holds is picked up on its next return.
      const target = this.context.draftTarget();
      const request = this.context.viewRequest();
      const started = Date.now();
      const id = randomId();
      const abort = new AbortController();
      this.held = { task: target?.task_id, abort };
      let read: UpdateRead;

      try {
        read = await this.context.tool<UpdateRead>(
          "app_wait_for_updates",
          {
            ...(this.revision === undefined ? {} : { after: this.revision }),
            ...(target ? { draft: target } : {}),
            ...(request ? { view: request.args } : {}),
            wait_ms: WAIT_MS,
            wait_id: id,
            ...(replaces === undefined ? {} : { replaces }),
          },
          abort.signal,
        );
      } catch {
        if (this.context.closed()) return;

        // A retarget ended the wait, so the next one follows the new target.
        if (abort.signal.aborted) {
          replaces = id;
          continue;
        }

        replaces = undefined;
        this.context.status(CONNECTION.reconnecting);
        await sleep(retryMs);
        retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
        continue;
      } finally {
        this.held = undefined;
      }

      if (this.context.closed()) return;
      replaces = undefined;
      retryMs = FIRST_RETRY_MS;
      this.context.status(CONNECTION.connected);
      let changed = read.revision !== this.revision;
      this.revision = read.revision;

      // The view goes first, so a draft that cleared finds its stored message.
      if (changed || read.view) await this.context.receive(read, request);

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
