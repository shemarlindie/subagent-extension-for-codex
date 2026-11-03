import type { PendingTaskUpdates } from "../../../../shared/tasks/conversation/parent-updates";
import type { Snapshot } from "../../../app/state/types";

interface PendingUpdateContext {
  snapshot(): Snapshot;
  closed(): boolean;
  patch(patch: Partial<Snapshot>): void;
  tool<T>(name: string, args: Record<string, unknown>): Promise<T>;
}

/** The worker updates Codex hasn't seen in the panel's conversation. */
export function pendingUpdates(state: Snapshot) {
  const read = state.pendingUpdates;

  return read && read.conversation === state.conversation ? read.tasks : [];
}

/** Reads and marks the worker updates Codex hasn't seen in the panel's chat. */
export class PendingUpdateLoader {
  /** Counts reads, so an older one finishing late never replaces a newer one. */
  private request = 0;
  constructor(private context: PendingUpdateContext) {}

  async load() {
    const conversation = this.context.snapshot().conversation;
    if (!conversation) return;
    const request = ++this.request;

    const { tasks } = await this.context.tool<{ tasks: PendingTaskUpdates[] }>(
      "app_list_pending_updates",
      { conversation_id: conversation },
    );

    if (
      request === this.request &&
      !this.context.closed() &&
      this.context.snapshot().conversation === conversation
    ) {
      this.context.patch({ pendingUpdates: { conversation, tasks } });
    }
  }

  async markSeen(eventIds: number[]) {
    await this.context.tool("app_mark_updates_seen", { event_ids: eventIds });
    await this.load();
  }
}
