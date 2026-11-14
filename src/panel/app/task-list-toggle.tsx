import { useRef } from "react";

import { Button } from "../shared/components/button/button";
import { Icon } from "../shared/components/icons/icons";
import { TooltipWrapper } from "../shared/components/tooltip";
import { useController, useSnapshot } from "./state/controller-context";
import { visibleTasks } from "./state/selectors";
import type { TaskRail } from "./task-layout";

export type TaskListToggleProps = {
  rail: Pick<TaskRail, "collapsed" | "toggle" | "narrow">;
};

export function TaskListToggle({ rail }: TaskListToggleProps) {
  const controller = useController();
  const lastTask = useRef<string>(undefined);

  const { selected, newTask, hasTasks } = useSnapshot(
    ["selected", "newTask"],
    (state) => ({ hasTasks: visibleTasks(state).length > 0 }),
  );

  const listHidden = rail.narrow
    ? Boolean(selected || newTask)
    : rail.collapsed;

  const label = listHidden ? "Show task list" : "Hide task list";

  function toggle() {
    if (!rail.narrow) return rail.toggle();

    if (listHidden) {
      lastTask.current = selected;
      controller.back();
    } else {
      const tasks = visibleTasks(controller.getSnapshot());

      const task =
        tasks.find((task) => task.id === lastTask.current) ?? tasks[0];

      if (task) controller.run(() => controller.select(task.id));
    }
  }

  return (
    <TooltipWrapper label={label}>
      <Button
        variant="ghost"
        className="toolbar-icon-button task-rail-toggle"
        aria-label={label}
        aria-expanded={!listHidden}
        aria-controls="task-rail"
        disabled={rail.narrow && !listHidden && !hasTasks}
        onClick={toggle}
      >
        <Icon name={listHidden ? "sidebar" : "sidebar-filled"} size={14} />
      </Button>
    </TooltipWrapper>
  );
}
