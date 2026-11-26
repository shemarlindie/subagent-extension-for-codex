import { useController, useSnapshot } from "../../app/state/controller-context";
import { StepNav } from "../../shared/components/step-nav/step-nav";
import type { Task } from "../tasks/types";

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
  const files = (changes?.task === task.id && changes.data?.files) || [];
  const index = files.findIndex((file) => file.path === path);

  // Opened from a reload before the changes were read, or the file is gone.
  if (index < 0) return null;

  const showAt = (position: number) => {
    const next = files[position];
    if (next) controller.showChangedFile(next.path);
  };

  return (
    <StepNav
      label="Changed files"
      noun="file"
      index={index}
      count={files.length}
      onStep={showAt}
    />
  );
}
