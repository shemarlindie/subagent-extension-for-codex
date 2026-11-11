import { useState } from "react";

export interface ListPresenceEntry<T> {
  item: T;
  key: string;
  /** False while a removed item plays its exit. */
  present: boolean;
  /** Arrived after the list first rendered, so it animates in. */
  added: boolean;
}

/**
 * Pairs a list with `Presence`. A removed item stays at its last position,
 * marked absent, until the list changes again, and items that arrive after the
 * first render are marked added. Items arriving in an empty list are not: the
 * container showing the list animates them in, and a second fold inside it
 * would clip.
 */
export function useListPresence<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): ListPresenceEntry<T>[] {
  const [state, setState] = useState(() => ({
    items,
    entries: items.map((item) => ({
      item,
      key: keyOf(item),
      present: true,
      added: false,
    })),
  }));

  if (state.items === items) return state.entries;

  // Exits from the last change have finished or are cut short by this one.
  const previous = state.entries.filter((entry) => entry.present);
  const known = new Set(previous.map((entry) => entry.key));
  const current = new Set(items.map(keyOf));
  const entries: ListPresenceEntry<T>[] = [];

  const pending = items.values();

  const take = (item: T) => {
    const key = keyOf(item);

    entries.push({
      item,
      key,
      present: true,
      added: known.size > 0 && !known.has(key),
    });

    return key;
  };

  // Walk the old order so each removed item keeps its place among the new ones.
  for (const entry of previous) {
    if (!current.has(entry.key)) {
      entries.push({ ...entry, present: false });
    } else {
      for (let step = pending.next(); !step.done; step = pending.next()) {
        if (take(step.value) === entry.key) break;
      }
    }
  }

  for (const item of pending) take(item);
  setState({ items, entries });

  return entries;
}
