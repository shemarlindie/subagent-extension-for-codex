import { useController, useSnapshot } from "../../app/state/controller-context";
import { Button } from "../../shared/components/button/button";
import { Icon } from "../../shared/components/icons/icons";
import { TooltipWrapper } from "../../shared/components/tooltip";
import type { Task } from "../tasks/types";
import { changedFileEntries } from "./changed-files";

type ChangedFileNavProps = {
  task: Task;
  path: string;
};

/**
 * Steps through the task's changed files from the preview's title row, in the
 * Changes list's order. Its controls keep their places as files switch.
 */
export function ChangedFileNav({ task, path }: ChangedFileNavProps) {
  const controller = useController(),
    { changes } = useSnapshot(),
    data = changes?.task === task.id ? changes.data : undefined,
    entries = data ? changedFileEntries(data) : [],
    index = entries.findIndex((entry) => entry.file.path === path);

  // Opened from a reload before the changes were read, or the file is gone.
  if (index < 0) return null;

  const previous = entries[index - 1],
    next = entries[index + 1];

  return (
    <nav className="changed-file-nav" aria-label="Changed files">
      {/* Focus stays on the step buttons, so announce where they led. */}
      <span className="changed-file-position" aria-live="polite">
        {index + 1} / {entries.length}
      </span>
      <TooltipWrapper label="Previous file">
        <Button
          variant="ghost"
          className="toolbar-icon-button changed-file-step"
          data-direction="previous"
          // Not `disabled`, which would drop focus on reaching the first file.
          aria-disabled={!previous}
          onClick={() =>
            previous && controller.showChangedFile(previous.file.path)
          }
        >
          <Icon name="chevron-down" size={14} />
        </Button>
      </TooltipWrapper>
      <TooltipWrapper label="Next file">
        <Button
          variant="ghost"
          className="toolbar-icon-button changed-file-step"
          data-direction="next"
          aria-disabled={!next}
          onClick={() => next && controller.showChangedFile(next.file.path)}
        >
          <Icon name="chevron-down" size={14} />
        </Button>
      </TooltipWrapper>
    </nav>
  );
}
