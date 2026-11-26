import { Button } from "../../shared/components/button/button";
import { TooltipWrapper } from "../../shared/components/tooltip";
import { useSingleFlight } from "../../shared/utils/use-single-flight";
import { useTaskFileOpener } from "../tasks/shared/use-task-file-opener";

type OpenFileButtonProps = {
  taskId: string;
  path: string;
  disabled?: boolean;
};

/** Opens the shown file in the host's viewer, when the host can open files. */
export function OpenFileButton({
  taskId,
  path,
  disabled,
}: OpenFileButtonProps) {
  const openFile = useTaskFileOpener(taskId);
  const [opening, run] = useSingleFlight();
  if (!openFile) return null;

  return (
    <TooltipWrapper label="Open in Codex">
      <Button
        className="file-action"
        disabled={disabled}
        aria-busy={opening || undefined}
        onClick={() => run(() => openFile(path))}
      >
        <span className="file-action-label">Open</span>
      </Button>
    </TooltipWrapper>
  );
}
