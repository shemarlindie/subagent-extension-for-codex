import type { ActivityPage } from "../../../shared/tasks/activity/activity-tail";
import type { PendingTaskUpdates } from "../../../shared/tasks/conversation/parent-updates";
import type { ChatRead } from "../../features/tasks/chat/chat-state";
import type { DraftRead } from "../../features/tasks/chat/drafts/draft-follower";
import { detailReads } from "../../features/tasks/task-detail-loader";
import { taskListArgs } from "./task-list-read";
import type { Project, Snapshot, TaskList } from "./types";

/** The `view` an update wait reads: each part's own tool arguments. */
type ViewArgs = {
  list: ReturnType<typeof taskListArgs>;
  chat?: { task_id: string; after: number };
  activity?: { task_id: string; after: number };
  pending?: { conversation_id: string };
};

/** The panel's data as of one revision, each part in its own tool's shape. */
export type PanelView = {
  /** When the service built it, in epoch milliseconds. */
  built_at: number;
  projects: Project[];
  list: TaskList;
  chat?: ChatRead;
  activity?: ActivityPage;
  pending?: { tasks: PendingTaskUpdates[] };
};

/** An `app_wait_for_updates` result. */
export type UpdateRead = {
  revision: string;
  view?: PanelView;
} & Partial<DraftRead>;

/**
 * A view's arguments and the controller's counters when it asked, which
 * tell whether each returned part still fits the panel.
 */
export type ViewRequest = {
  args: ViewArgs;
  /** The draft follower's number for this view's Chat read. */
  draftRead: number;
  scope: number;
  projects: number;
  selection: number;
  tab: number;
};

/** A view and the revision and request it answers. */
export type ViewRead = {
  revision: string;
  view: PanelView;
  request: ViewRequest;
};

/** The view arguments for the panel's list, selected task and chat. */
export function viewArgs(state: Snapshot, restored?: string): ViewArgs {
  return {
    list: taskListArgs(state, restored),
    ...detailReads(state),
    ...(state.conversation
      ? { pending: { conversation_id: state.conversation } }
      : {}),
  };
}

/**
 * Whether `revision` is older than `than`: a revision is `bootId:count`, and
 * the count only grows within a boot, so only one boot's revisions compare.
 */
export function olderRevision(revision: string, than?: string) {
  if (than === undefined) return false;
  const [boot, count] = parts(revision);
  const [thanBoot, thanCount] = parts(than);

  return boot === thanBoot && count < thanCount;
}

function parts(revision: string) {
  const at = revision.lastIndexOf(":");

  return [revision.slice(0, at), Number(revision.slice(at + 1))] as const;
}
