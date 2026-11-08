import { setTimeout as sleep } from "node:timers/promises";

import type { Store } from "../storage/store.js";
import type { Drafts } from "./drafts.js";

/** The draft a panel shows, and how much of it the panel already has. */
type DraftTarget = {
  task_id: string;
  message_id?: string;
  after_length: number;
};

export type UpdateRequest = {
  /** The revision the panel last saw; without one, the wait returns at once. */
  after?: string;
  draft?: DraftTarget;
  wait_ms: number;
};

/**
 * Reads the panel's view. It may wait for reads that can't run in one
 * synchronous section, then returns a function that reads the rest
 * synchronously.
 */
type ViewReader<V> = () => Promise<() => V>;

const RUNNING = ["queued", "starting", "running", "waiting"];

/**
 * Waits for something the panel should show: the owner's revision differs
 * from `after`, or the draft target's draft grew, became another message or
 * cleared, or its turn ended. Returns the current revision, and the draft
 * when a target was given, as soon as either happens or the wait runs out.
 * With `view`, it also returns the view, unless only the draft changed.
 */
export async function waitForUpdates<V>(
  store: Store,
  drafts: Drafts,
  owner: string,
  { after, draft: target, wait_ms }: UpdateRequest,
  view?: ViewReader<V>,
) {
  const changed = new AbortController();

  const known = target && {
    task_id: target.task_id,
    message_id: target.message_id,
    length: target.after_length,
  };

  const onChange = (changedOwner?: string) => {
    if (changedOwner === undefined || changedOwner === owner) changed.abort();
  };

  // Listen before reading, so a change between the two can't be missed.
  store.bus.on("change", onChange);

  try {
    const waitMs = after === store.revision(owner) ? wait_ms : 0;

    if (!known) {
      await sleep(waitMs, undefined, { signal: changed.signal }).catch(
        () => {}, // A change ended the wait.
      );
    } else if (store.find(known.task_id, owner)) {
      // A turn's end commits events, which change the revision and end this.
      await drafts.wait(known.task_id, known, waitMs, changed.signal);
    }
  } finally {
    store.bus.off("change", onChange);
  }

  const readView = await view?.();
  // The rest reads in one synchronous section, so it all matches the revision.
  const revision = store.revision(owner);

  if (!known) return { revision, ...(readView && { view: readView() }) };

  // A task that is gone, or not this owner's, has no draft to show.
  const task = store.find(known.task_id, owner);

  const draftOnly =
    revision === after && !!task && drafts.differs(task.id, known);

  return {
    revision,
    draft: (task && drafts.get(task.id)) ?? null,
    running: task ? RUNNING.includes(task.status) : false,
    ...(readView && !draftOnly && { view: readView() }),
  };
}
