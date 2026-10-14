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

const RUNNING = ["queued", "starting", "running", "waiting"];

/**
 * Waits for something the panel should show: the owner's revision differs
 * from `after`, or the draft target's draft grew, became another message or
 * cleared, or its turn ended. Returns the current revision, and the draft
 * when a target was given, as soon as either happens or the wait runs out.
 */
export async function waitForUpdates(
  store: Store,
  drafts: Drafts,
  owner: string,
  { after, draft: target, wait_ms }: UpdateRequest,
) {
  const changed = new AbortController();

  const onChange = (changedOwner?: string) => {
    if (changedOwner === undefined || changedOwner === owner) changed.abort();
  };

  // Listen before reading, so a change between the two can't be missed.
  store.bus.on("change", onChange);

  try {
    const waitMs = after === store.revision(owner) ? wait_ms : 0;

    if (!target) {
      await sleep(waitMs, undefined, { signal: changed.signal }).catch(
        () => {}, // A change ended the wait.
      );

      return { revision: store.revision(owner) };
    }

    // A task that is gone, or not this owner's, has no draft to show.
    const draft =
      store.find(target.task_id, owner) &&
      (await drafts.wait(
        target.task_id,
        { message_id: target.message_id, length: target.after_length },
        waitMs,
        // A turn's end commits events, which change the revision.
        () => false,
        changed.signal,
      ));

    const task = store.find(target.task_id, owner);

    return {
      revision: store.revision(owner),
      draft: (task && draft) || null,
      running: task ? RUNNING.includes(task.status) : false,
    };
  } finally {
    store.bus.off("change", onChange);
  }
}
