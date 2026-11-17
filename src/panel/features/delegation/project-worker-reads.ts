import type { Snapshot, Worker } from "../../app/state/types";
import { reuseUnchanged } from "../../shared/utils/reuse-unchanged";

interface ProjectWorkerReadsContext {
  snapshot(): Snapshot;
  patch(patch: Partial<Snapshot>): void;
  tool<T>(name: string, args?: Record<string, unknown>): Promise<T>;
}

/** The state a folder's read follows, as `patchState` clears reads on change. */
type ReadBasis = Pick<Snapshot, "projects" | "workers">;

const current = (basis: ReadBasis, state: Snapshot) =>
  basis.projects === state.projects && basis.workers === state.workers;

/**
 * Reads workers as tasks in a project folder would find them, when a new-task
 * form opens on the folder, and again when the project list or global workers
 * change.
 */
export class ProjectWorkerReads {
  private pending = new Map<string, ReadBasis>();

  constructor(private context: ProjectWorkerReadsContext) {}

  /**
   * Reads a folder's workers, unless a current read is pending. A failed read
   * keeps what the folder showed, or the global workers, whose own read
   * reports failures, until a form asks again.
   */
  load(repository: string) {
    const { pending, context } = this;
    const state = context.snapshot();
    const reading = pending.get(repository);

    if (reading && current(reading, state)) return;

    const basis = { projects: state.projects, workers: state.workers };
    pending.set(repository, basis);

    void context
      .tool<Worker[]>("list_workers", { repository })
      .catch(() => undefined)
      .then((workers) => {
        if (pending.get(repository) !== basis) return;
        pending.delete(repository);

        const now = context.snapshot();
        if (!current(basis, now)) return;

        const read = workers ?? now.projectWorkers[repository] ?? now.workers;

        // Workers matching the global ones keep their reference, so fields
        // switching to them don't render again.
        context.patch({
          projectWorkers: {
            ...now.projectWorkers,
            [repository]: reuseUnchanged(now.workers, read),
          },
        });
      });
  }
}
