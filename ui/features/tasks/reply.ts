import type { Event } from "../../../src/shared/contracts";

/** A task's latest reply among loaded events, or undefined before it replies. */
export function latestReply(events: Event[], taskId: string) {
  const reply = events.findLast(
    (event) => event.task_id === taskId && event.type === "agent.reply",
  );

  return typeof reply?.data.text === "string" ? reply.data.text : undefined;
}
