import { useController, useSnapshot } from "../../app/state/controller-context";
import { StepNav } from "../../shared/components/step-nav/step-nav";
import type { Task } from "../tasks/types";
import { changedFileEntries } from "./changed-files";

type ChangedFileNavProps = {
  task: Task;
  path: string;
};

/**
 * Steps through the task's changed files from the preview's title row, in the
 * Changes list's order.
 */
export function ChangedFileNav({ task, path }: ChangedFileNavProps) {
  const controller = useController();
  const changes = useSnapshot((state) => state.changes);
  const data = changes?.task === task.id ? changes.data : undefined;
  const entries = data ? changedFileEntries(data) : [];
  const index = entries.findIndex((entry) => entry.file.path === path);

  // Opened from a reload before the changes were read, or the file is gone.
  if (index < 0) return null;

  return (
    <StepNav
      label="Changed files"
      noun="file"
      index={index}
      count={entries.length}
      onStep={(step) => controller.showChangedFile(entries[step]!.file.path)}
    />
  );
}
