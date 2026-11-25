import { useEffect } from "react";

import { useController, useSnapshot } from "../../app/state/controller-context";
import type { Worker } from "../../app/state/types";

/** Stable, so a pending read doesn't render memoized fields again. */
const NO_WORKERS: Worker[] = [];

/**
 * The workers tasks in `repository` would find, read again as the form opens.
 * Without a folder there is nothing to read, and `fallback` applies. Until the
 * first read arrives, `pending` is true and no worker is known, so nothing
 * limits choices yet. A later read keeps showing the last result.
 */
export function useProjectWorkers(
  repository: string | undefined,
  fallback: Worker[],
) {
  const controller = useController();

  const loaded = useSnapshot((state) =>
    repository ? state.projectWorkers[repository] : undefined,
  );

  // A project or global worker change, such as Claude becoming ready, clears
  // the folder's record and drops a pending read. A record that was still
  // empty looks the same, so the change itself asks again.
  const { projects, workers } = useSnapshot(["projects", "workers"]);

  // Opening a form or choosing a folder reads its latest workers.
  useEffect(() => {
    if (repository) controller.projectWorkerReads.load(repository);
  }, [controller, repository]);

  useEffect(() => {
    if (repository && !loaded) controller.projectWorkerReads.load(repository);
  }, [controller, repository, loaded, projects, workers]);

  return {
    workers: loaded ?? (repository ? NO_WORKERS : fallback),
    pending: !!repository && !loaded,
  };
}
