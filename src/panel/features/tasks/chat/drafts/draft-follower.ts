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
  closed(): boolean;
  hidden(): boolean;
  streamsDrafts(): boolean | undefined;
  patch(patch: Partial<Snapshot>): void;
  tool<T>(name: string, args: Record<string, unknown>): Promise<T>;
  run(action: () => Promise<unknown>): void;
  refresh(): Promise<void>;
}

/** How long one draft read waits for the draft to change. */
const DRAFT_WAIT_MS = 20000;
/** The least time between draft reads. */
const DRAFT_READ_GAP_MS = 100;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Reconciles streamed drafts and follows drafts on transports without streaming. */
export class DraftFollower {
  constructor(private context: DraftContext) {}

  /** Applies a streamed draft update for the selected task. */
  apply(update: DraftUpdate) {
    if (update.task_id !== this.context.snapshot().selected) return;

    const { draft, stale } = applyDraftUpdate(
      this.context.snapshot().draft,
      update,
    );

    this.context.patch({ draft });
    // The whole message is stored now; read it.
    if ("cleared" in update) this.context.run(() => this.context.refresh());
    else if (stale) this.context.run(() => this.readDraft());
  }

  /** Reads the selected task's draft in full, after a missed update. */
  private async readDraft() {
    const id = this.context.snapshot().selected;
    if (!id) return;

    const read = await this.context.tool<{ draft: Draft | null }>(
      "get_user_agent_draft",
      { task_id: id },
    );

    if (this.context.snapshot().selected === id) {
      this.context.patch({
        draft: read.draft ? { task: id, ...read.draft } : undefined,
      });
    }
  }

  private followingDraft = false;

  /**
   * Follows a running task's draft while Chat shows it, where the transport
   * can't stream it: each read waits until the draft changes, then the next
   * one starts.
   */
  follow() {
    if (this.context.streamsDrafts() || this.followingDraft) return;
    this.followingDraft = true;

    void (async () => {
      try {
        while (!this.context.closed()) {
          const task = selectedTask(this.context.snapshot());

          if (
            !task ||
            composerMode(task) === "idle" ||
            this.context.snapshot().tab !== "chat" ||
            this.context.hidden()
          ) {
            break;
          }

          const known =
            this.context.snapshot().draft?.task === task.id
              ? this.context.snapshot().draft
              : undefined;

          const started = Date.now();
          let read: { draft: Draft | null; running: boolean };

          try {
            read = await this.context.tool("get_user_agent_draft", {
              task_id: task.id,
              ...(known
                ? {
                    message_id: known.message_id,
                    after_length: known.text.length,
                  }
                : {}),
              wait_ms: DRAFT_WAIT_MS,
            });
          } catch {
            await sleep(2000);
            continue;
          }

          if (
            this.context.closed() ||
            this.context.snapshot().selected !== task.id
          ) {
            continue;
          }

          const draft = read.draft
            ? { task: task.id, ...read.draft }
            : undefined;

          const changed =
            draft?.message_id !== known?.message_id ||
            draft?.text !== known?.text;

          this.context.patch({ draft });
          // The whole message, or the turn's end, is stored now; read it.
          if (known && !draft) this.context.run(() => this.context.refresh());
          if (!read.running) break;
          // A read that came back at once with nothing new waits a little,
          // and reads stay at least DRAFT_READ_GAP_MS apart, so a fast stream
          // renders at most that often.
          const elapsed = Date.now() - started;

          if (!changed && elapsed < 500) {
            await sleep(1000);
          } else if (elapsed < DRAFT_READ_GAP_MS) {
            await sleep(DRAFT_READ_GAP_MS - elapsed);
          }
        }
      } finally {
        this.followingDraft = false;
      }
    })();
  }
}
