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
 * Reads workers as tasks in a project folder would find them, for the new-task
 * forms, once per folder until the project list or global workers change.
 */
export class ProjectWorkerReads {
  private pending = new Map<string, ReadBasis>();

  constructor(private context: ProjectWorkerReadsContext) {}

  /** A failed read keeps the global workers, whose own read reports failures. */
  load(repository: string) {
    const { pending, context } = this;
    const state = context.snapshot();
    const reading = pending.get(repository);

    if (state.projectWorkers[repository]) return;
    if (reading && current(reading, state)) return;

    const basis = { projects: state.projects, workers: state.workers };
    pending.set(repository, basis);

    void context
      .tool<Worker[]>("list_workers", { repository })
      .catch(() => context.snapshot().workers)
      .then((workers) => {
        if (pending.get(repository) !== basis) return;
        pending.delete(repository);

        const now = context.snapshot();
        if (!current(basis, now)) return;

        // Workers matching the global ones keep their reference, so fields
        // switching to them don't render again.
        context.patch({
          projectWorkers: {
            ...now.projectWorkers,
            [repository]: reuseUnchanged(now.workers, workers),
          },
        });
      });
  }
}
