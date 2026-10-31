import type {
  ActivityPage,
  TurnActivityPage,
} from "../../../shared/tasks/activity/activity-tail";
import type { Snapshot } from "../../app/state/types";
import {
  activityCursor,
  mergeActivity,
  turnStart,
} from "./activity/event-history";
import { type ChatRead, mergeChat } from "./chat/chat-state";
import type { DraftFollower } from "./chat/drafts/draft-follower";

interface TaskDetailContext {
  snapshot(): Snapshot;
  closed(): boolean;
  /** The controller advances this whenever selection or scope changes. */
  generation(): number;
  patch(patch: Partial<Snapshot>): void;
  tool<T>(name: string, args: Record<string, unknown>): Promise<T>;
  setTab(tab: Snapshot["tab"]): void;
  drafts: Pick<DraftFollower, "reading" | "show">;
}

/** Reads the selected task's Chat and Activity without replacing newer views. */
export class TaskDetailLoader {
  constructor(private context: TaskDetailContext) {}

  private currentSelection(task: string) {
    const generation = this.context.generation();

    return () =>
      !this.context.closed() &&
      task === this.context.snapshot().selected &&
      generation === this.context.generation();
  }

  async load() {
    const state = this.context.snapshot(),
      id = state.selected;

    if (!id || this.context.closed()) return;

    const isCurrentRead = this.currentSelection(id);

    const activityRead = this.context
      .tool<ActivityPage>("app_get_activity", {
        task_id: id,
        after: activityCursor(state.events, id),
      })
      .then((activity) => {
        if (!isCurrentRead()) return;

        const current = this.context.snapshot();

        const view = mergeActivity(
          { events: current.events, dropped: current.droppedEvents },
          id,
          activity,
        );

        this.context.patch({
          events: view.events,
          droppedEvents: view.dropped,
          activityHistoryLoading:
            current.activityHistoryLoading === id
              ? undefined
              : current.activityHistoryLoading,
        });
      });

    const read = this.context.drafts.reading();

    const chatRead = this.context
      .tool<ChatRead>("app_get_chat", {
        task_id: id,
        after: state.chat?.task === id ? state.chat.cursor : 0,
      })
      .then((chat) => {
        if (!isCurrentRead()) return;

        const current = this.context.snapshot();

        this.context.patch({
          chat: mergeChat(current.chat, id, chat),
          chatHistoryLoading:
            current.chatHistoryLoading === id
              ? undefined
              : current.chatHistoryLoading,
        });

        this.context.drafts.show(read);
      });

    await Promise.all([activityRead, chatRead]);
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
        this.context.patch({
          activityFocus: {
            ...focus,
            range: { events: page.events, dropped: page.dropped },
          },
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
