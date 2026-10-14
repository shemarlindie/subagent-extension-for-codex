/** The text a worker has written so far of a message it hasn't finished. */
export type Draft = { message_id: string; text: string };

/**
 * A change to a task's draft, published on the store's bus as `draft`:
 * `text` was appended at `offset`, or the draft was cleared because the
 * whole message, the reply or the end of the run was stored.
 */
export type DraftUpdate =
  | { task_id: string; message_id: string; offset: number; text: string }
  | { task_id: string; message_id: string; cleared: true };

/** The longest the panel's update wait may hold. */
export const MAX_UPDATE_WAIT_MS = 25_000;
