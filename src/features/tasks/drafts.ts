import type { EventEmitter } from "node:events";

/** The text a worker has written so far of a message it hasn't finished. */
export type Draft = { message_id: string; text: string };

/**
 * A change to a task's draft, published on the store's bus as `draft`:
 * `text` was appended at `offset`, or the draft was cleared because the
 * whole message, the reply or the end of the run was stored.
 */
export type DraftUpdate =
  | { task_id: string; message_id: string; offset: number; text: string }
  | { task_id: string; message_id: string; cleared: true };

/** The longest a draft read may wait for the draft to change. */
export const MAX_DRAFT_WAIT_MS = 25_000;

/**
 * Running tasks' drafts, kept in memory only: deltas never reach the event
 * log, and a restart loses only the draft.
 */
export class Drafts {
  private drafts = new Map<string, Draft & { owner: string }>();
  constructor(private bus: EventEmitter) {}

  get(taskId: string): Draft | undefined {
    const draft = this.drafts.get(taskId);

    return draft
      ? { message_id: draft.message_id, text: draft.text }
      : undefined;
  }

  /** The owner's drafts, for a client that connects mid-message. */
  forOwner(owner: string) {
    return [...this.drafts]
      .filter(([, draft]) => draft.owner === owner)
      .map(([task_id, draft]) => ({
        task_id,
        message_id: draft.message_id,
        text: draft.text,
      }));
  }

  /** Adds text to a task's draft; another message starts a new one. */
  append(owner: string, taskId: string, messageId: string, text: string) {
    let draft = this.drafts.get(taskId);

    if (!draft || draft.message_id !== messageId) {
      draft = { owner, message_id: messageId, text: "" };
      this.drafts.set(taskId, draft);
    }

    const offset = draft.text.length;
    draft.text += text;

    this.bus.emit(
      "draft",
      { task_id: taskId, message_id: messageId, offset, text },
      owner,
    );
  }

  /** Clears a task's draft, or only the given message's. */
  clear(taskId: string, messageId?: string) {
    const draft = this.drafts.get(taskId);
    if (!draft || (messageId && draft.message_id !== messageId)) return;
    this.drafts.delete(taskId);

    this.bus.emit(
      "draft",
      { task_id: taskId, message_id: draft.message_id, cleared: true },
      draft.owner,
    );
  }

  /**
   * Waits until a task's draft differs from what the reader has: it grew
   * past `length`, became another message, or was cleared. Also returns
   * when `ended` says the turn is over, or after `waitMs`.
   */
  async wait(
    taskId: string,
    known: { message_id?: string; length: number },
    waitMs: number,
    ended: () => boolean,
  ) {
    const changed = () => {
      const draft = this.drafts.get(taskId);

      return draft
        ? draft.message_id !== known.message_id ||
            draft.text.length > known.length
        : known.message_id !== undefined;
    };

    if (changed() || ended() || waitMs <= 0) return this.get(taskId);
    let wake!: () => void;
    const woken = new Promise<void>((resolve) => (wake = resolve));

    const onDraft = (update: DraftUpdate) => {
      if (update.task_id === taskId && changed()) wake();
    };

    const onEvent = (e: { task_id: string; type: string }) => {
      if (e.task_id === taskId && e.type === "task.turn_ended") wake();
    };

    this.bus.on("draft", onDraft);
    this.bus.on("event", onEvent);
    const timer = setTimeout(wake, waitMs);

    try {
      await woken;

      return this.get(taskId);
    } finally {
      clearTimeout(timer);
      this.bus.off("draft", onDraft);
      this.bus.off("event", onEvent);
    }
  }
}
