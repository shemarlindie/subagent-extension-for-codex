import { useSnapshot } from "../../../app/state/controller-context";
import type { Task } from "../../../app/state/types";
import { Checkbox } from "../../../shared/components/checkbox/checkbox";
import { formatUserDateTime } from "../../../shared/utils/user-date-time";

type ArchivedTaskRowProps = {
  task: Task;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
};

/** An archived task in a project's archive, with a box to select it. */
export function ArchivedTaskRow({
  task,
  checked,
  disabled,
  onCheckedChange,
}: ArchivedTaskRowProps) {
  const host = useSnapshot((state) => state.host);

  const archived = task.archived_at
    ? formatUserDateTime(task.archived_at, host, {
        second: undefined,
        timeZoneName: undefined,
      })
    : undefined;

  return (
    <li className="archived-task" data-task={task.id}>
      <label className="archived-task-label">
        <Checkbox
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
        />
        <span className="archived-task-text">
          <span className="archived-task-title">{task.title}</span>
          {archived && (
            <span className="archived-task-meta">
              Archived <time dateTime={task.archived_at}>{archived}</time>
            </span>
          )}
        </span>
      </label>
    </li>
  );
}
