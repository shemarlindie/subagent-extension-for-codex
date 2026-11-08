import { eq } from "drizzle-orm";

import {
  archivable,
  type ArchiveResult,
} from "../../../../shared/tasks/archive.js";
import type { Task } from "../../../../shared/tasks/model.js";
import { now } from "../../../../shared/time.js";
import { taskArchive, tasks } from "./schema.js";
import type { Store } from "./store.js";
import { type TaskFilters, taskFilters } from "./task-rows.js";

/**
 * Which tasks the user archived, and when. Archiving changes only what the
 * panel lists, so it never touches the task's own state.
 */
export class ArchiveStore {
  constructor(private store: Store) {}

  private get orm() {
    return this.store.database.orm;
  }

  /** When each of an owner's archived tasks matching `filters` was archived, by task id. */
  times(owner: string, filters: TaskFilters): Map<string, string> {
    const rows = this.orm
      .select({ id: taskArchive.task_id, at: taskArchive.archived_at })
      .from(taskArchive)
      .innerJoin(tasks, eq(tasks.id, taskArchive.task_id))
      .where(taskFilters(owner, filters))
      .all();

    return new Map(rows.map((row) => [row.id, row.at]));
  }

  /** Archives a task, keeping the time of an earlier archive. */
  private archive(t: Task) {
    this.orm
      .insert(taskArchive)
      .values({ task_id: t.id, archived_at: now() })
      .onConflictDoNothing()
      .run();

    this.store.markChanged(t.owner);
  }

  /** Unarchives a task; one that isn't archived stays unchanged. */
  unarchive(t: Task) {
    const removed = this.orm
      .delete(taskArchive)
      .where(eq(taskArchive.task_id, t.id))
      .run();

    if (removed.changes) this.store.markChanged(t.owner);
  }

  /**
   * Archives or unarchives an owner's tasks in one transaction. Archiving
   * skips tasks that could still need the user (see `archivable`).
   */
  setArchived(owner: string, ids: string[], archived: boolean): ArchiveResult {
    const listed = ids.map((id) => this.store.get(id, owner));
    const skipped = archived ? listed.filter((t) => !archivable(t)) : [];
    const changed = listed.filter((t) => !skipped.includes(t));

    this.store.transaction(() => {
      for (const t of changed) {
        if (archived) this.archive(t);
        else this.unarchive(t);
      }
    });

    return {
      task_ids: changed.map((t) => t.id),
      skipped: skipped.map((t) => t.id),
    };
  }
}
