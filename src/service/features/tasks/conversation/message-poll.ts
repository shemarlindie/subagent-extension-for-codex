import type { Event } from "../../../../shared/events/types.js";
import {
  conversation,
  MESSAGE_EVENTS,
} from "../../../../shared/tasks/conversation/messages.js";
import type { Store } from "../storage/store.js";
import type { Drafts } from "./drafts.js";

/** The longest a parent's message read may wait. */
export const MAX_MESSAGE_WAIT_SECONDS = 50;

/** Events that end a wait: a new message, a turn's end, or a request for input. */
const WAKE = new Set([
  "task.instruction",
  "agent.message",
  "agent.reply",
  "task.turn_ended",
  "agent.input_required",
]);

/**
 * A task's complete messages after a cursor, for the parent agent. With a
 * wait, it returns as soon as a message follows the cursor, the turn ends
 * or input is needed, or when the wait runs out.
 */
export async function pollMessages(
  store: Store,
  drafts: Drafts,
  owner: string,
  id: string,
  after: number,
  waitSeconds: number,
) {
  store.get(id, owner);
  let wake!: () => void;
  const woken = new Promise<void>((resolve) => (wake = resolve));

  const onEvent = (e: Event, eventOwner: string) => {
    if (eventOwner === owner && e.task_id === id && WAKE.has(e.type)) wake();
  };

  // Listen before reading, so an event between the two can't be missed.
  store.bus.on("event", onEvent);
  const timer = setTimeout(wake, waitSeconds * 1000);

  try {
    let result = read(store, owner, id, after);

    if (!result.settled && waitSeconds > 0) {
      await woken;
      result = read(store, owner, id, after);
    }

    const { task, messages } = result;
    // A read that waited out its time shows the text written so far.
    const draft = !result.settled ? drafts.get(id) : undefined;

    return {
      messages,
      next_cursor: Math.max(after, store.lastEventId(id)),
      status: task.status,
      turn: task.turn,
      running: ["queued", "starting", "running", "waiting"].includes(
        task.status,
      ),
      pending_input: task.pending_input ?? null,
      queued_messages: task.queue.length,
      ...(draft ? { draft } : {}),
    };
  } finally {
    clearTimeout(timer);
    store.bus.off("event", onEvent);
  }
}

function read(store: Store, owner: string, id: string, after: number) {
  const task = store.get(id, owner);

  const events = store.eventsOfTypes(id, [
    ...MESSAGE_EVENTS,
    "task.turn_ended",
    "agent.input_required",
  ]);

  // A read from the start includes the request, which has no event.
  const messages = conversation(task, events).filter(
    (m) => m.event_id > after || (after === 0 && m.kind === "request"),
  );

  return {
    task,
    messages,
    settled:
      messages.length > 0 ||
      events.some(
        (e) =>
          e.id > after &&
          (e.type === "task.turn_ended" || e.type === "agent.input_required"),
      ),
  };
}
