import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { SendRejectedError } from "../../../../shared/tasks/conversation/send-errors.js";
import type {
  BudgetRaise,
  Delivery,
  Sender,
  Task,
} from "../../../../shared/tasks/model.js";
import { sendReceipts } from "../storage/schema.js";
import type { Store } from "../storage/store.js";

export type SendOptions = {
  delivery?: Delivery;
  budget?: BudgetRaise;
  request_id?: string;
};

const sendStates = ["started", "pending_steer", "queued"] as const;

type SendState = (typeof sendStates)[number];

const isSendState = (state: string): state is SendState =>
  (sendStates as readonly string[]).includes(state);

export type SentMessage = { task: Task; message_id: string; state: SendState };
export type RecordSend = (messageId: string, state: SendState) => void;

const rejection = (error: unknown) =>
  new SendRejectedError(
    error instanceof Error ? error.message : String(error),
    { cause: error },
  );

/** Coalesces validation and stores acceptance in the message's transaction. */
export class SendRequests {
  private pending = new Map<
    string,
    { fingerprint: string; result: Promise<SentMessage> }
  >();

  constructor(private store: Store) {}

  async run(
    owner: string,
    taskId: string,
    sender: Sender,
    message: string,
    options: SendOptions,
    send: (record: RecordSend) => Promise<SentMessage>,
  ): Promise<SentMessage> {
    // Ownership remains mandatory even when replaying a receipt. A missing
    // task stays unmarked: deletion also removes the receipts of sends it
    // accepted, so their absence proves nothing.
    this.store.get(taskId, owner);
    const requestId = options.request_id;
    if (requestId === undefined) return send(() => {});

    if (!requestId.length || requestId.length > 200) {
      throw new SendRejectedError("Invalid send request ID");
    }

    const key = JSON.stringify([owner, taskId, sender, requestId]);

    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          message,
          delivery: options.delivery ?? "steer",
          budget: options.budget
            ? Object.entries(options.budget).sort(([a], [b]) =>
                a.localeCompare(b),
              )
            : null,
        }),
      )
      .digest("hex");

    const where = and(
      eq(sendReceipts.owner, owner),
      eq(sendReceipts.task_id, taskId),
      eq(sendReceipts.sender, sender),
      eq(sendReceipts.request_id, requestId),
    );

    const receipt = this.store.database.orm
      .select()
      .from(sendReceipts)
      .where(where)
      .get();

    const pending = this.pending.get(key);
    const previous = receipt?.fingerprint ?? pending?.fingerprint;

    // The ID belongs to another payload, so this one was never accepted.
    if (previous !== undefined && previous !== fingerprint) {
      throw new SendRejectedError(
        "Send request ID was already used with a different payload",
      );
    }

    if (receipt) {
      const { state, message_id } = receipt;

      if (!isSendState(state) || !message_id) {
        throw new Error(`Invalid stored send receipt for task ${taskId}`);
      }

      return { task: this.store.get(taskId, owner), message_id, state };
    }

    if (pending) return pending.result;

    // The reservation is set before control returns to the event loop, so a
    // concurrent retry joins this send even while validation awaits.
    const result = send((messageId, state) => {
      this.store.database.orm
        .insert(sendReceipts)
        .values({
          owner,
          task_id: taskId,
          sender,
          request_id: requestId,
          fingerprint,
          message_id: messageId,
          state,
        })
        .onConflictDoUpdate({
          target: [
            sendReceipts.owner,
            sendReceipts.task_id,
            sendReceipts.sender,
            sendReceipts.request_id,
          ],
          set: { state },
        })
        .run();
    })
      .catch((error: unknown) => {
        // A send can fail after acceptance while waiting for shutdown. Only a
        // successful lookup with no receipt establishes that retry state can go.
        const accepted = this.store.database.orm
          .select({ request_id: sendReceipts.request_id })
          .from(sendReceipts)
          .where(where)
          .get();

        throw accepted ? error : rejection(error);
      })
      .finally(() => {
        this.pending.delete(key);
      });

    this.pending.set(key, { fingerprint, result });

    return result;
  }
}
