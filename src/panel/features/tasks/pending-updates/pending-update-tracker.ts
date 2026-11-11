import type { PendingTaskUpdates } from "../../../../shared/tasks/conversation/parent-updates";
import type { Snapshot } from "../../../app/state/types";

interface PendingUpdateContext {
  snapshot(): Snapshot;
  patch(patch: Partial<Snapshot>): void;
  tool<T>(name: string, args: Record<string, unknown>): Promise<T>;
}

/** The snapshot fields `pendingUpdates` reads. */
export const PENDING_UPDATE_FIELDS = [
  "pendingUpdates",
  "conversation",
] as const;

export type PendingState = Pick<
  Snapshot,
  (typeof PENDING_UPDATE_FIELDS)[number]
>;

/** The worker updates Codex hasn't seen in the panel's conversation. */
export function pendingUpdates(state: PendingState) {
  const read = state.pendingUpdates;

  return read && read.conversation === state.conversation ? read.tasks : [];
}

/**
 * Shows and marks the worker updates Codex hasn't seen in the panel's chat.
 * They arrive only with views, so revisions keep them in order.
 */
export class PendingUpdateTracker {
  constructor(private context: PendingUpdateContext) {}

  /** Shows the pending updates a view read for `conversation`, unless the panel moved to another. */
  show(conversation: string, tasks: PendingTaskUpdates[]) {
    if (this.context.snapshot().conversation === conversation) {
      this.context.patch({ pendingUpdates: { conversation, tasks } });
    }
  }

  /** Marks updates seen. The form's submit refreshes the view afterwards. */
  async markSeen(eventIds: number[]) {
    await this.context.tool("app_mark_updates_seen", { event_ids: eventIds });
  }
}
