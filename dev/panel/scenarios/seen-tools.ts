import {
  isUnseen,
  SEEN_EVENTS,
  type SeenMark,
} from "../../../src/shared/tasks/conversation/seen";
import { previewEvents, previewTasks } from "./fixtures";

/** Seen tools the browser fixtures answer by changing what the user has seen in memory. */
export const PREVIEW_SEEN_TOOLS = [
  "mark_user_agent_task_seen",
  "mark_user_agent_tasks_seen",
];

// These start unseen, so the list shows the dot and the Unseen filter; the
// long conversation starts seen through its middle, so Chat opens at a "New"
// divider partway down. The rest start seen through their newest event.
const INITIALLY_UNSEEN = new Set([
  "preview-audit",
  "preview-failed",
  "preview-question",
  "preview-input",
]);

const PARTLY_SEEN = "preview-long-chat";

const marks = new Map<string, SeenMark>();

const taskEvents = (taskId: string) =>
  previewEvents.filter((event) => event.task_id === taskId);

const newest = (taskId: string) => taskEvents(taskId).at(-1)?.id ?? 0;

function initiallySeen(taskId: string) {
  if (INITIALLY_UNSEEN.has(taskId)) return 0;
  const events = taskEvents(taskId);

  return taskId === PARTLY_SEEN
    ? (events[Math.floor(events.length / 2)]?.id ?? 0)
    : newest(taskId);
}

function markFor(taskId: string) {
  const mark = marks.get(taskId) ?? {
    through: initiallySeen(taskId),
    unseen: false,
  };

  marks.set(taskId, mark);

  return mark;
}

/** What the user has seen of a fixture task, with the service's rules. */
export function previewSeen(taskId: string) {
  const mark = markFor(taskId);

  return { unseen: previewUnseen(taskId), through: mark.through };
}

function previewUnseen(taskId: string) {
  const latest =
    taskEvents(taskId).findLast((event) => SEEN_EVENTS.includes(event.type))
      ?.id ?? 0;

  return isUnseen(latest, markFor(taskId));
}

function see(taskId: string, through = newest(taskId)) {
  const mark = markFor(taskId);
  mark.through = Math.max(mark.through, Math.min(through, newest(taskId)));
  mark.unseen = false;
}

function known(taskId: unknown) {
  const task = previewTasks.find((task) => task.id === taskId);
  if (!task) throw new Error("Task not found");

  return task.id;
}

export function previewSeenTool(name: string, args: Record<string, unknown>) {
  if (name === "mark_user_agent_tasks_seen") {
    const ids = (args.task_ids as unknown[]).map(known);
    for (const id of ids) see(id);

    return { task_ids: ids };
  }

  const id = known(args.task_id);
  const through = typeof args.through === "number" ? args.through : undefined;

  if (args.seen) see(id, through);
  else markFor(id).unseen = true;

  return previewSeen(id);
}
