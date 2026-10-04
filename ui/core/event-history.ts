import type { Event } from "./types";
export const EVENT_TAIL_SIZE = 200;
/** Drain service pages without retaining unbounded history or advancing a stale view. */
export async function readEventTail(
  taskId: string,
  previous: Event[],
  read: (after: number) => Promise<Event[]>,
  isCurrent: () => boolean,
) {
  let recent = previous.filter((event) => event.task_id === taskId),
    after = recent.at(-1)?.id ?? 0;
  for (;;) {
    const page = await read(after);
    if (!isCurrent()) return [];
    // Keep the same array when nothing arrived so unchanged views skip rendering.
    if (!page.length)
      return recent.length === previous.length ? previous : recent;
    recent = [...recent, ...page].slice(-EVENT_TAIL_SIZE);
    const cursor = page.at(-1)!.id;
    if (page.length < 1000 || cursor <= after) return recent;
    after = cursor;
  }
}
