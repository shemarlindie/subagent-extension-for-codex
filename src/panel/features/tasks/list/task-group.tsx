import { Accordion } from "@base-ui/react/accordion";
import { type ReactNode, useId } from "react";

import type { Task } from "../../../app/state/types";
import { Button, buttonClass } from "../../../shared/components/button/button";
import { Icon } from "../../../shared/components/icons/icons";
import { GroupSignals } from "./group-signals";
import { groupRows } from "./selectors";

type TaskGroupProps = {
  repository: string;
  name: string;
  /** Every task the group lists, including rows "Show more" hides. */
  tasks: Task[];
  /** Whether a long group stops at a few rows until "Show more". */
  capped: boolean;
  /** Stays shown when the group stops at a few rows. */
  selected?: string;
  /** Whether "Show more" revealed every row. */
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  open: boolean;
  /** Controls at the end of the header, such as the project's menu. */
  actions?: ReactNode;
  renderRow: (task: Task) => ReactNode;
};

/**
 * A project's tasks in the task list accordion, under a header that sticks
 * while its rows scroll past. Long groups stop at a few rows until "Show
 * more". Collapsed headers and "Show more" flag hidden unread tasks and tasks
 * waiting on input.
 */
export function TaskGroup({
  repository,
  name,
  tasks,
  capped,
  selected,
  expanded,
  onExpandedChange,
  open,
  actions,
  renderRow,
}: TaskGroupProps) {
  const id = useId();

  const rows = capped
    ? groupRows(tasks, selected)
    : { shown: tasks, hidden: [] };

  const limited = rows.hidden.length > 0;
  const { shown, hidden } = expanded ? { shown: tasks, hidden: [] } : rows;

  return (
    <Accordion.Item
      value={repository}
      className="task-group"
      role="group"
      aria-labelledby={id}
    >
      <div className="task-group-header" data-task-group={repository}>
        <Accordion.Header className="task-group-heading">
          <Accordion.Trigger
            className={buttonClass("ghost", { className: "task-group-toggle" })}
          >
            <Icon name="chevron-down" size={8} className="task-group-chevron" />
            <span className="task-group-name" id={id} title={name}>
              {name}
            </span>
            <span className="task-group-count">
              {tasks.length}
              <span className="visually-hidden">
                {tasks.length === 1 ? " task" : " tasks"}
              </span>
            </span>
            {!open && <GroupSignals tasks={tasks} />}
          </Accordion.Trigger>
        </Accordion.Header>
        {actions}
      </div>
      <Accordion.Panel className="task-group-panel collapse-panel">
        {shown.map(renderRow)}
        {hidden.length > 0 && (
          <Button
            variant="ghost"
            className="task-group-more"
            onClick={() => onExpandedChange(true)}
          >
            Show {hidden.length} more
            <GroupSignals tasks={hidden} />
          </Button>
        )}
        {expanded && limited && (
          <Button
            variant="ghost"
            className="task-group-more"
            onClick={() => onExpandedChange(false)}
          >
            Show less
          </Button>
        )}
      </Accordion.Panel>
    </Accordion.Item>
  );
}
