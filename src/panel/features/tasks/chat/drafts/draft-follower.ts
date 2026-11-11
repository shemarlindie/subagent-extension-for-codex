import type {
  Draft,
  DraftUpdate,
} from "../../../../../shared/tasks/conversation/drafts";
import { selectedTask } from "../../../../app/state/selectors";
import type { Snapshot, Task } from "../../../../app/state/types";
import { composerMode } from "../chat-model";
import { completeParagraphs } from "./complete-paragraphs";
import { applyDraftUpdate, type DraftState } from "./draft-state";

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
 * Reconciles streamed and task-list drafts through their stored handoff. On
 * transports without streaming, names the draft to wait for and applies it.
 */
export class DraftFollower {
  constructor(private context: DraftContext) {}

  /**
   * The shown draft in full. The snapshot holds only its complete paragraphs,
   * so a delta inside a paragraph patches nothing.
   */
  private full?: DraftState;

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

    const { draft, stale } = applyDraftUpdate(this.current(), update);
    this.set(draft);
    if (stale) this.context.run(() => this.readDraft());
  }

  /** Notes that a Chat read starts, returning its number for `show`. */
  reading() {
    return ++this.reads;
  }

  /**
   * Holds a disappearing listed-task draft until the Chat read numbered
   * `read`, from the same view as the list, settles it.
   */
  retainListed(task: Task | undefined, read: number): Snapshot["draft"] {
    const snapshot = this.context.snapshot();
    if (task && snapshot.draft?.task === task.id) return snapshot.draft;
    const previous = selectedTask(snapshot);

    if (
      !task ||
      previous?.id !== task.id ||
      !previous.draft ||
      previous.draft.message_id === task.draft?.message_id
    ) {
      return undefined;
    }

    // The service reads a view's list and Chat in one snapshot, so the
    // view's own Chat read already follows this completion.
    this.completed = {
      message_id: previous.draft.message_id,
      reads: read - 1,
    };

    this.full = { task: task.id, ...previous.draft };

    return visible(this.full);
  }

  /** The full draft, while the snapshot still shows it. */
  private current() {
    return this.context.snapshot().draft && this.full;
  }

  /** Keeps `draft` in full, and patches it when its shown part changes. */
  private set(draft: DraftState | undefined) {
    this.full = draft;
    const shown = this.context.snapshot().draft;
    const next = draft && visible(draft);

    if (
      next?.task !== shown?.task ||
      next?.message_id !== shown?.message_id ||
      next?.text !== shown?.text
    ) {
      this.context.patch({ draft: next });
    }
  }

  /**
   * The whole message is stored now, or the turn ended without it, so read
   * Chat unless it already holds the message. The draft stays shown until
   * Chat holds its stored message, so the reply never disappears in between.
   */
  private complete(messageId: string) {
    const draft = this.context.snapshot().draft;
    if (draft?.message_id !== messageId) return;
    this.completed = { message_id: messageId, reads: this.reads };
    if (!this.release()) this.context.run(() => this.context.refresh());
  }

  /**
   * Removes a completed draft once Chat holds its stored message, or once a
   * Chat `read` that started after the draft completed finds none. Returns
   * whether it did.
   */
  private release(read?: number) {
    const snapshot = this.context.snapshot();
    const draft = snapshot.draft;
    const completed = this.completed;
    if (!draft || completed?.message_id !== draft.message_id) return false;

    const stored =
      snapshot.chat?.task === draft.task &&
      snapshot.chat.items.some((item) => item.id === draft.message_id);

    if (!stored && (read === undefined || read <= completed.reads)) {
      return false;
    }

    this.completed = undefined;
    this.set(undefined);

    return true;
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
      this.set(read.draft ? { task: id, ...read.draft } : undefined);
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

    const current = this.current();
    const known = current?.task === task.id ? current : undefined;

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
      this.set(draft);
    }

    return changed;
  }
}

/** The part of a draft Chat shows: its complete paragraphs. */
function visible(draft: DraftState): DraftState {
  return { ...draft, text: completeParagraphs(draft.text) };
}
