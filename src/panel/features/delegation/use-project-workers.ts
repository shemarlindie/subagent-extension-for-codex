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

  // A cleared record, such as after Claude becomes ready, asks again.
  const all = useSnapshot((state) => state.projectWorkers);
  const loaded = repository ? all[repository] : undefined;

  // Opening a form or choosing a folder reads its latest workers.
  useEffect(() => {
    if (repository) controller.projectWorkerReads.load(repository);
  }, [controller, repository]);

  useEffect(() => {
    if (repository && !loaded) controller.projectWorkerReads.load(repository);
  }, [controller, repository, loaded, all]);

  return {
    workers: loaded ?? (repository ? NO_WORKERS : fallback),
    pending: !!repository && !loaded,
  };
}
