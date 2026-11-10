import type { Projects } from "../../projects/projects.js";

type ProjectStart = { repository: string; stopped: boolean };

/**
 * Keeps task starts and project removal apart. A removal stops the starts it
 * overlaps, and a start checks again as it saves, so a removal that began
 * while the start yielded stops it even if the removal already finished.
 */
export class ProjectGuard {
  private removing = new Set<string>();
  private starting = new Set<ProjectStart>();

  /**
   * Runs a start for `repository`. `check` throws once a removal overlapped
   * it or the project lost its approval. Run it in the saving transaction.
   */
  async start<T>(
    repository: string,
    projects: Projects | undefined,
    run: (check: () => void) => Promise<T>,
  ) {
    const start = { repository, stopped: false };
    this.starting.add(start);

    const check = () => {
      if (start.stopped || this.removing.has(repository)) {
        throw new Error("Project task data is being deleted");
      }

      projects?.assertApproved(repository);
    };

    try {
      check();

      return await run(check);
    } finally {
      this.starting.delete(start);
    }
  }

  isRemoving(repository: string) {
    return this.removing.has(repository);
  }

  /** Stops the project's starts in progress from saving their tasks. */
  stopStarts(repository: string) {
    for (const start of this.starting) {
      if (start.repository === repository) start.stopped = true;
    }
  }

  /** Holds the project against new starts until `endRemoval`. */
  beginRemoval(repository: string) {
    this.removing.add(repository);
    this.stopStarts(repository);
  }

  endRemoval(repository: string) {
    this.removing.delete(repository);
  }
}
