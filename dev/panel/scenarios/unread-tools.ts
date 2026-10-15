import {
  isUnread,
  READ_EVENTS,
  type ReadMark,
} from "../../../src/shared/tasks/conversation/unread";
import { previewEvents, previewTasks } from "./fixtures";

/** Read tools the browser fixtures answer by changing what the user has read in memory. */
export const PREVIEW_UNREAD_TOOLS = [
  "mark_user_agent_task_read",
  "mark_user_agent_task_unread_from",
  "mark_user_agent_tasks_read",
];

// These start unread, so the list shows the dot and the Unread filter; the
// long conversation starts read through its middle, so Chat opens at a "New"
// divider partway down. The rest start read through their newest event.
const INITIALLY_UNREAD = new Set([
  "preview-audit",
  "preview-failed",
  "preview-question",
  "preview-input",
]);

const PARTLY_READ = "preview-long-chat";

const marks = new Map<string, ReadMark>();

const taskEvents = (taskId: string) =>
  previewEvents.filter((event) => event.task_id === taskId);

const newest = (taskId: string) => taskEvents(taskId).at(-1)?.id ?? 0;

function initiallyRead(taskId: string) {
  if (INITIALLY_UNREAD.has(taskId)) return 0;
  const events = taskEvents(taskId);

  return taskId === PARTLY_READ
    ? (events[Math.floor(events.length / 2)]?.id ?? 0)
    : newest(taskId);
}

function markFor(taskId: string) {
  const mark = marks.get(taskId) ?? {
    through: initiallyRead(taskId),
    unread: false,
  };

  marks.set(taskId, mark);

  return mark;
}

/** What the user has read of a fixture task, with the service's rules. */
export function previewReadState(taskId: string) {
  const mark = markFor(taskId);

  return { unread: previewUnread(taskId), through: mark.through };
}

function previewUnread(taskId: string) {
  const latest =
    taskEvents(taskId).findLast((event) => READ_EVENTS.includes(event.type))
      ?.id ?? 0;

  return isUnread(latest, markFor(taskId));
}

function markRead(taskId: string, through = newest(taskId)) {
  const mark = markFor(taskId);
  mark.through = Math.max(mark.through, Math.min(through, newest(taskId)));
  mark.unread = false;
}

function known(taskId: unknown) {
  const task = previewTasks.find((task) => task.id === taskId);
  if (!task) throw new Error("Task not found");

  return task.id;
}

export function previewUnreadTool(name: string, args: Record<string, unknown>) {
  if (name === "mark_user_agent_tasks_read") {
    const ids = (args.task_ids as unknown[]).map(known);
    for (const id of ids) markRead(id);

    return { task_ids: ids };
  }

  const id = known(args.task_id);

  if (name === "mark_user_agent_task_unread_from") {
    const mark = markFor(id);
    mark.through = Math.min(Number(args.event_id) - 1, newest(id));
    mark.unread = false;

    return previewReadState(id);
  }

  const through = typeof args.through === "number" ? args.through : undefined;

  if (args.read) markRead(id, through);
  else markFor(id).unread = true;

  return previewReadState(id);
}
