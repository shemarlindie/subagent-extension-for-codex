import type { StructuredPatchHunk as Hunk } from "diff";
import { and, asc, eq } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/zod";
import { z } from "zod";

import type { ChangeScope } from "../../../shared/changes/changes.js";
import type { Task } from "../../../shared/tasks/model.js";
import { checkStored, decodeStored } from "../../platform/database/decode.js";
import type { FileEdit } from "../providers/types.js";
import type { Store } from "../tasks/storage/store.js";
import { composeHunks } from "./compose.js";
import { changePath } from "./paths.js";
import { fileChanges } from "./schema.js";

const hunkSchema = z.object({
  oldStart: z.number().int().nonnegative(),
  oldLines: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(),
  newLines: z.number().int().nonnegative(),
  lines: z.array(z.string()),
});

const rowSchema = createSelectSchema(fileChanges);

type StoredChange = typeof fileChanges.$inferSelect;

export type RecordedChange = Omit<StoredChange, "hunks"> & { hunks: Hunk[] };

function decodeRow(row: StoredChange): RecordedChange {
  checkStored(
    rowSchema,
    row,
    `file change ${row.task_id}/${row.scope}/${row.path}`,
  );

  return {
    ...row,
    hunks: decodeStored(
      z.array(hunkSchema),
      row.hunks,
      `file change ${row.task_id}/${row.scope}/${row.path}`,
    ),
  };
}

/** Merge one edit into a scope. Incomplete rows never resume composition. */
function mergeRow(
  old: RecordedChange | undefined,
  edit?: FileEdit,
  unrecordedSource: FileEdit["source"] = "command",
) {
  const created = old?.created ?? !!edit?.created;
  const deleted = edit ? !!edit.deleted : (old?.deleted ?? false);

  const editSource = edit ? edit.source : unrecordedSource;

  const source =
    old?.source === "command" || editSource === "command" ? "command" : "tool";

  let incomplete = !edit || !!old?.incomplete;
  let hunks: Hunk[] = [];

  if (!incomplete && edit) {
    try {
      hunks = composeHunks(old?.hunks ?? [], edit.hunks, created);
    } catch {
      incomplete = true;
    }
  }

  return { created, deleted, source, incomplete, hunks } as const;
}

/** Each write commits both scopes and notifies readers together. */
export class ChangeStore {
  constructor(private store: Store) {}

  rows(task: Task, scope: ChangeScope) {
    return this.store.database.orm
      .select()
      .from(fileChanges)
      .where(
        and(eq(fileChanges.task_id, task.id), eq(fileChanges.scope, scope)),
      )
      .orderBy(asc(fileChanges.path))
      .all()
      .map(decodeRow);
  }

  clearTurn(task: Task) {
    this.store.database.orm
      .delete(fileChanges)
      .where(
        and(eq(fileChanges.task_id, task.id), eq(fileChanges.scope, "turn")),
      )
      .run();
  }

  record(task: Task, edit: FileEdit) {
    if (!edit.hunks.length || !task.workspace) return;
    const path = changePath(task.workspace, edit.path);
    if (path !== undefined) this.write(task, path, edit);
  }

  unrecorded(
    task: Task,
    path?: string,
    source: FileEdit["source"] = "command",
  ) {
    if (!task.workspace) return;

    const normalized =
      path === undefined ? "" : changePath(task.workspace, path);

    if (normalized !== undefined) {
      this.write(task, normalized, undefined, source);
    }
  }

  private write(
    task: Task,
    path: string,
    edit?: FileEdit,
    source?: FileEdit["source"],
  ) {
    this.store.transaction(() => {
      for (const scope of ["task", "turn"] as const) {
        const where = and(
          eq(fileChanges.task_id, task.id),
          eq(fileChanges.scope, scope),
          eq(fileChanges.path, path),
        );

        const stored = this.store.database.orm
          .select()
          .from(fileChanges)
          .where(where)
          .get();

        const merged = mergeRow(stored && decodeRow(stored), edit, source);

        if (
          !merged.incomplete &&
          (!merged.hunks.length || (merged.created && merged.deleted))
        ) {
          this.store.database.orm.delete(fileChanges).where(where).run();
          continue;
        }

        const row = {
          task_id: task.id,
          scope,
          path,
          ...merged,
          hunks: JSON.stringify(merged.hunks),
        };

        this.store.database.orm
          .insert(fileChanges)
          .values(row)
          .onConflictDoUpdate({
            target: [fileChanges.task_id, fileChanges.scope, fileChanges.path],
            set: row,
          })
          .run();
      }

      this.store.save(task);
    });
  }
}
