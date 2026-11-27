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
  /** Names this wait, so a later wait can replace it. */
  wait_id?: string;
  /** The panel's previous wait, which this one ends. */
  replaces?: string;
};

/** How long a replacement that arrived first waits for the wait it replaces. */
const EARLY_REPLACEMENT_MS = 30000;

/**
 * The update waits in flight, so a wait can end the one it replaces. Ids are
 * kept per owner, so a wait never ends another owner's.
 */
export class UpdateWaits {
  private held = new Map<string, AbortController>();
  /** Replaced waits that hadn't arrived yet. */
  private early = new Set<string>();

  /**
   * Holds the request's wait until the returned function releases it, and
   * ends the wait it replaces. Aborts `ended` when a later wait replaces it.
   */
  hold(
    owner: string,
    { wait_id, replaces }: UpdateRequest,
    ended: AbortController,
  ) {
    if (replaces !== undefined) this.replace(`${owner}\n${replaces}`);
    if (wait_id === undefined) return () => {};
    const key = `${owner}\n${wait_id}`;
    if (this.early.delete(key)) ended.abort();
    this.held.set(key, ended);

    return () => {
      if (this.held.get(key) === ended) this.held.delete(key);
    };
  }

  private replace(key: string) {
    const held = this.held.get(key);

    if (held) {
      held.abort();

      return;
    }

    this.early.add(key);
    setTimeout(() => this.early.delete(key), EARLY_REPLACEMENT_MS).unref();
  }
}

/**
 * Reads the panel's view. It may wait for reads that can't run in one
 * synchronous section, then returns a function that reads the rest
 * synchronously.
 */
type ViewReader<V> = () => Promise<() => V>;

const RUNNING = ["queued", "starting", "running", "waiting"];

/**
 * Waits for something the panel should show: the owner's revision differs
 * from `after`, the draft target's draft grew, became another message or
 * cleared, its turn ended, or a later wait replaced this one. Returns the
 * current revision, and the draft when a target was given, as soon as any of
 * these happens or the wait runs out.
 * With `view`, it also returns the view, unless only the draft changed.
 */
export async function waitForUpdates<V>(
  store: Store,
  drafts: Drafts,
  waits: UpdateWaits,
  owner: string,
  request: UpdateRequest,
  view?: ViewReader<V>,
) {
  const { after, draft: target, wait_ms } = request;
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
  const release = waits.hold(owner, request, changed);

  try {
    const waitMs = after === store.revision(owner) ? wait_ms : 0;

    if (!known) {
      await sleep(waitMs, undefined, { signal: changed.signal }).catch(
        () => {}, // A change or a replacement ended the wait.
      );
    } else if (store.find(known.task_id, owner)) {
      // A turn's end commits events, which change the revision and end this.
      await drafts.wait(known.task_id, known, waitMs, changed.signal);
    }
  } finally {
    release();
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
