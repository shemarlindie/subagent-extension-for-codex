import type { TurnActivityPage } from "../../../shared/tasks/activity/activity-tail";
import type { PanelView, ViewRequest } from "../../app/state/panel-view";
import type { Snapshot } from "../../app/state/types";
import {
  activityCursor,
  mergeActivity,
  turnStart,
} from "./activity/event-history";
import { mergeChat } from "./chat/chat-state";
import type { DraftFollower } from "./chat/drafts/draft-follower";
import type { TimingReporter } from "./controls/timing-reporter";

interface TaskDetailContext {
  timing: Pick<TimingReporter, "observe" | "merge">;
  snapshot(): Snapshot;
  closed(): boolean;
  /** The controller advances this whenever selection or scope changes. */
  generation(): number;
  patch(patch: Partial<Snapshot>): void;
  tool<T>(name: string, args: Record<string, unknown>): Promise<T>;
  setTab(tab: Snapshot["tab"]): void;
  drafts: Pick<DraftFollower, "show">;
}

/** The view's Chat and Activity arguments for the selected task. */
export function detailReads(state: Snapshot) {
  const id = state.selected;
  if (!id) return {};

  return {
    chat: {
      task_id: id,
      after: state.chat?.task === id ? state.chat.cursor : 0,
    },
    activity: { task_id: id, after: activityCursor(state.events, id) },
  };
}

/**
 * Merges the selected task's Chat and Activity without replacing newer
 * views, and reads turn history.
 */
export class TaskDetailLoader {
  constructor(private context: TaskDetailContext) {}

  /**
   * Merges the Chat and Activity a view read for its request's selection.
   * Returns false when the selection has changed since, so the read is
   * stale and the selected task's details are still to read.
   */
  merge(
    { args, selection, draftRead }: ViewRequest,
    { chat, activity }: PanelView,
  ) {
    const current = this.context.snapshot(),
      id = current.selected;

    if (!id || this.context.closed()) return true;

    if (args.chat?.task_id !== id || selection !== this.context.generation()) {
      return false;
    }

    // A read that left out the details found no task to show them for.
    if (!chat || !activity) return true;

    const events = mergeActivity(
      { events: current.events, dropped: current.droppedEvents },
      id,
      activity,
    );

    this.context.patch({
      events: events.events,
      droppedEvents: events.dropped,
      activityHistoryLoading:
        current.activityHistoryLoading === id
          ? undefined
          : current.activityHistoryLoading,
      chat: mergeChat(current.chat, id, chat),
      chatHistoryLoading:
        current.chatHistoryLoading === id
          ? undefined
          : current.chatHistoryLoading,
    });

    this.context.drafts.show(draftRead);

    return true;
  }

  /** Reads a turn's own events when the latest activity no longer holds them. */
  async viewTurn(turn: number) {
    const state = this.context.snapshot(),
      task = state.selected;

    if (!task) return;

    const shown =
      turnStart(
        { events: state.events, dropped: state.droppedEvents },
        turn,
      ) !== undefined;

    const focus = {
      task,
      turn,
      request: (state.activityFocus?.request ?? 0) + 1,
      ...(shown ? {} : { range: "loading" as const }),
    };

    this.context.patch({ activityFocus: focus });
    this.context.setTab("activity");
    if (shown) return;

    // Object identity also rejects old reads after returning to latest activity
    // or reselecting the same task, when request numbers can start over.
    const current = () =>
      !this.context.closed() && this.context.snapshot().activityFocus === focus;

    try {
      const page = await this.context.tool<TurnActivityPage>(
        "app_get_turn_activity",
        { task_id: task, turn },
      );

      if (current()) {
        this.context.timing.merge("activity_turn", page.events.length, () => {
          this.context.patch({
            activityFocus: {
              ...focus,
              range: { events: page.events, dropped: page.dropped },
            },
          });
        });
      } else {
        this.context.timing.observe("activity_turn", "merge", 0, {
          stale_count: 1,
        });
      }
    } catch (error) {
      if (current()) this.context.patch({ activityFocus: undefined });
      throw error;
    }
  }

  showLatest() {
    this.context.patch({ activityFocus: undefined });
  }
}
