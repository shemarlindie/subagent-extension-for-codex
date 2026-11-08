import { useEffect, useState } from "react";

import { taskDeletionPreviewSchema } from "../../../../shared/tasks/deletion-contract.generated.js";
import type { TaskDeletionPreview } from "../../../../shared/tasks/deletion-contract.js";
import { useController } from "../../../app/state/controller-context";

type DeletionRead = {
  selection: string;
  includeSession: boolean;
  revision: number;
  preview?: TaskDeletionPreview;
  error?: string;
};

type DeletionSelection = string[] | { repository: string };

/** Keeps the confirmation tied to the currently displayed removal list. */
export function useTaskDeletionPreview(
  tasks: DeletionSelection,
  includeSession: boolean,
  enabled = true,
) {
  const controller = useController();
  const selection = JSON.stringify(tasks);
  const [revision, setRevision] = useState(0);
  const [read, setRead] = useState<DeletionRead>();

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const selected = JSON.parse(selection) as DeletionSelection;

    void controller
      .tool<unknown>("app_preview_task_deletion", {
        ...(Array.isArray(selected) ? { task_ids: selected } : selected),
        delete_agent_task: includeSession,
      })
      .then((result) => {
        const parsed = taskDeletionPreviewSchema.safeParse(result);

        if (!parsed.success) {
          throw new Error(
            "The removal list could not be verified. Refresh it before deleting.",
          );
        }

        return parsed.data;
      })
      .then(
        (preview) => {
          if (!cancelled) {
            setRead({ selection, includeSession, revision, preview });
          }
        },
        (error: unknown) => {
          if (!cancelled) {
            setRead({
              selection,
              includeSession,
              revision,
              error:
                error instanceof Error
                  ? error.message
                  : "The removal list could not be verified.",
            });
          }
        },
      );

    return () => {
      cancelled = true;
    };
  }, [controller, selection, includeSession, revision, enabled]);

  const sameSelection = read?.selection === selection;

  const current =
    sameSelection &&
    read.includeSession === includeSession &&
    read.revision === revision;

  return {
    preview: sameSelection ? read.preview : undefined,
    checking: enabled && !current,
    error: current ? read.error : undefined,
    confirmation: current ? read.preview?.confirmation : undefined,
    reload: () => setRevision((value) => value + 1),
  };
}
