import type {
  Draft,
  DraftUpdate,
} from "../../../../../shared/tasks/conversation/drafts";
import { selectedTask } from "../../../../app/state/selectors";
import type { Snapshot } from "../../../../app/state/types";
import { composerMode } from "../chat-model";
import { applyDraftUpdate } from "./draft-state";

interface DraftContext {
  snapshot(): Snapshot;
  hidden(): boolean;
  streamsDrafts(): boolean | undefined;
  patch(patch: Partial<Snapshot>): void;
  tool<T>(name: string, args: Record<string, unknown>): Promise<T>;
  run(action: () => Promise<unknown>): void;
  refresh(): Promise<void>;
}

/** The draft the panel shows, and how much of it the panel already has. */
export type DraftTarget = {
  task_id: string;
  message_id?: string;
  after_length?: number;
};

/** A draft read: the draft now, or null, and whether its task still runs. */
export type DraftRead = { draft: Draft | null; running: boolean };

/**
 * Reconciles streamed drafts, and on transports without streaming, names the
 * draft to wait for and applies what the wait returns.
 */
export class DraftFollower {
  constructor(private context: DraftContext) {}

  /** Chat reads started, numbered so `show` knows which began after a clear. */
  private reads = 0;

  /** The shown draft the service cleared, and the reads started by then. */
  private completed?: { message_id: string; reads: number };

  /** Applies a streamed draft update for the selected task. */
  apply(update: DraftUpdate) {
    if (update.task_id !== this.context.snapshot().selected) return;

    if ("cleared" in update) {
      this.complete(update.message_id);

      return;
    }

    const { draft, stale } = applyDraftUpdate(
      this.context.snapshot().draft,
      update,
    );

    this.context.patch({ draft });
    if (stale) this.context.run(() => this.readDraft());
  }

  /** Notes that a Chat read starts, returning its number for `show`. */
  reading() {
    return ++this.reads;
  }

  /**
   * The whole message is stored now, or the turn ended without it, so read
   * Chat. The draft stays shown until Chat holds its stored message, so the
   * reply never disappears in between.
   */
  private complete(messageId: string) {
    const draft = this.context.snapshot().draft;
    if (draft?.message_id !== messageId) return;
    this.completed = { message_id: messageId, reads: this.reads };
    this.context.run(() => this.context.refresh());
  }

  /**
   * Removes a completed draft once Chat holds its stored message, or once a
   * Chat `read` that started after the draft completed finds none.
   */
  private release(read?: number) {
    const snapshot = this.context.snapshot();
    const draft = snapshot.draft;
    const completed = this.completed;
    if (!draft || completed?.message_id !== draft.message_id) return;

    const stored =
      snapshot.chat?.task === draft.task &&
      snapshot.chat.items.some((item) => item.id === draft.message_id);

    if (stored || (read !== undefined && read > completed.reads)) {
      this.completed = undefined;
      this.context.patch({ draft: undefined });
    }
  }

  /** Reads the selected task's draft in full, after a missed update. */
  private async readDraft() {
    const id = this.context.snapshot().selected;
    if (!id) return;

    const read = await this.context.tool<{ draft: Draft | null }>(
      "app_wait_for_updates",
      { draft: { task_id: id }, wait_ms: 0 },
    );

    if (this.context.snapshot().selected === id) {
      this.context.patch({
        draft: read.draft ? { task: id, ...read.draft } : undefined,
      });
    }
  }

  /**
   * The draft to wait for, where the transport can't stream it: a running
   * selected task's while Chat shows it.
   */
  target(): DraftTarget | undefined {
    const snapshot = this.context.snapshot();
    const task = selectedTask(snapshot);

    if (
      this.context.streamsDrafts() ||
      !task ||
      composerMode(task) === "idle" ||
      snapshot.tab !== "chat" ||
      this.context.hidden()
    ) {
      return undefined;
    }

    const known = snapshot.draft?.task === task.id ? snapshot.draft : undefined;

    return known
      ? {
          task_id: task.id,
          message_id: known.message_id,
          after_length: known.text.length,
        }
      : { task_id: task.id };
  }

  /** The task whose draft `show` last read. */
  private shown?: string;

  /**
   * Shows a newly shown target's draft at once, before a wait picks it up.
   * Chat calls this after each `read`, so it reads only for a new target.
   */
  show(read?: number) {
    this.release(read);
    const target = this.target();

    if (target?.task_id !== this.shown) {
      this.shown = target?.task_id;

      if (target && target.message_id === undefined) {
        this.context.run(() => this.readDraft());
      }
    }
  }

  /** Applies a wait's draft for `target`; returns whether it changed. */
  receive(target: DraftTarget, read: DraftRead) {
    if (this.context.snapshot().selected !== target.task_id) return false;

    const draft = read.draft
      ? { task: target.task_id, ...read.draft }
      : undefined;

    const changed =
      draft?.message_id !== target.message_id ||
      draft?.text.length !== target.after_length;

    if (target.message_id !== undefined && !draft) {
      this.complete(target.message_id);
    } else {
      this.context.patch({ draft });
    }

    return changed;
  }
}
