import { and, count, eq, gt, lte } from "drizzle-orm";

import { type Database } from "../../../platform/database/database.js";
import { formRequests } from "../storage/schema.js";

/** A stored form request: its hashed token id and JSON body. */
export type FormRequestRow = Pick<
  typeof formRequests.$inferSelect,
  "id" | "body"
>;

/** Persistence for pending form requests, keyed by their hashed token. */
export class FormRequests {
  constructor(private database: Database) {}

  private get orm() {
    return this.database.orm;
  }

  /** Every stored request, for recovery after a restart. */
  all(): FormRequestRow[] {
    return this.orm
      .select({ id: formRequests.id, body: formRequests.body })
      .from(formRequests)
      .all();
  }

  /** An owner's request body, while it hasn't expired. */
  body(id: string, owner: string, now: number): string | undefined {
    return this.orm
      .select({ body: formRequests.body })
      .from(formRequests)
      .where(
        and(
          eq(formRequests.id, id),
          eq(formRequests.owner, owner),
          gt(formRequests.expires, now),
        ),
      )
      .get()?.body;
  }

  /** Counts an owner's requests, after removing expired ones. */
  pending(owner: string, now: number): number {
    this.orm.delete(formRequests).where(lte(formRequests.expires, now)).run();

    return (
      this.orm
        .select({ n: count() })
        .from(formRequests)
        .where(eq(formRequests.owner, owner))
        .get()?.n ?? 0
    );
  }

  /** Stores a new request; one about a task is deleted with it. */
  add(
    id: string,
    owner: string,
    expires: number,
    taskId: string | undefined,
    body: string,
  ) {
    this.orm
      .insert(formRequests)
      .values({ id, owner, expires, task_id: taskId ?? null, body })
      .run();
  }

  update(id: string, body: string) {
    this.orm
      .update(formRequests)
      .set({ body })
      .where(eq(formRequests.id, id))
      .run();
  }
}
