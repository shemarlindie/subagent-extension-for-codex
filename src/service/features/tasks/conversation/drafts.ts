import type { EventEmitter } from "node:events";

import type {
  Draft,
  DraftUpdate,
} from "../../../../shared/tasks/conversation/drafts.js";

/** The draft a reader has: its message, and how much of its text. */
type KnownDraft = { message_id?: string; length: number };

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
   * Whether a task's draft differs from what the reader has: it grew past
   * `length`, became another message, or was cleared.
   */
  differs(taskId: string, known: KnownDraft) {
    const draft = this.drafts.get(taskId);

    return draft
      ? draft.message_id !== known.message_id ||
          draft.text.length > known.length
      : known.message_id !== undefined;
  }

  /**
   * Waits until a task's draft `differs` from what the reader has, `wake`
   * aborts, or `waitMs` passes.
   */
  async wait(
    taskId: string,
    known: KnownDraft,
    waitMs: number,
    wake?: AbortSignal,
  ) {
    const changed = () => this.differs(taskId, known);
    if (changed() || wake?.aborted || waitMs <= 0) return;

    let resolve!: () => void;
    const woken = new Promise<void>((done) => (resolve = done));

    const onDraft = (update: DraftUpdate) => {
      if (update.task_id === taskId && changed()) resolve();
    };

    this.bus.on("draft", onDraft);
    wake?.addEventListener("abort", resolve);
    const timer = setTimeout(resolve, waitMs);

    try {
      await woken;
    } finally {
      clearTimeout(timer);
      this.bus.off("draft", onDraft);
      wake?.removeEventListener("abort", resolve);
    }
  }
}
