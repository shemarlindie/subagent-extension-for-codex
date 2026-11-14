import { and, count, eq, gte, lt } from "drizzle-orm";

import type { TaskMessage } from "../../../../shared/tasks/model.js";
import type { Database } from "../../../platform/database/database.js";
import { taskMessages } from "./schema.js";

/**
 * The messages each task's worker has received or is about to, in order.
 * Adding one belongs in the transaction that saves the task, so a rollback
 * removes it too.
 */
export class MessageStore {
  constructor(private database: Database) {}

  private get orm() {
    return this.database.orm;
  }

  /** Adds messages after a task's others. */
  add(taskId: string, ...messages: TaskMessage[]) {
    if (!messages.length) return;
    const next = this.count(taskId);

    this.orm
      .insert(taskMessages)
      .values(
        messages.map((m, index) => ({
          task_id: taskId,
          seq: next + index,
          message_id: m.id,
          message: m.message,
          sender: m.from,
        })),
      )
      .run();
  }

  /** How many messages a task has. */
  count(taskId: string): number {
    return (
      this.orm
        .select({ count: count() })
        .from(taskMessages)
        .where(eq(taskMessages.task_id, taskId))
        .get()?.count ?? 0
    );
  }

  /** A task's messages from position `from`, and before `to` when given. */
  list(taskId: string, from = 0, to?: number): TaskMessage[] {
    return this.orm
      .select({
        id: taskMessages.message_id,
        message: taskMessages.message,
        from: taskMessages.sender,
      })
      .from(taskMessages)
      .where(
        and(
          eq(taskMessages.task_id, taskId),
          gte(taskMessages.seq, from),
          to === undefined ? undefined : lt(taskMessages.seq, to),
        ),
      )
      .orderBy(taskMessages.seq)
      .all();
  }
}
