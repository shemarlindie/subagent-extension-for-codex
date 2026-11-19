import { Accordion } from "@base-ui/react/accordion";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { Task } from "../../../app/state/types";
import { useCollapsedProjects } from "./collapsed-projects";
import { ProjectGroupMenu } from "./project-group-menu";
import { groupRows, tasksByProject } from "./selectors";
import { TaskGroup } from "./task-group";

/** Determines which rows the accordion shows and which "Select all" can reach. */
export function useProjectGroups(
  tasks: Task[],
  search: string,
  current?: string,
) {
  const groups = tasksByProject(tasks);
  const capped = !search && groups.length > 1;
  const [collapsed, setGroupOpen] = useCollapsedProjects();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const revealed = useRef(current);

  // An empty or single-project list unmounts the accordion.
  if (!groups.length && expanded.size) setExpanded(new Set());

  // Choosing a task from outside the list, such as a toast, opens its group.
  useEffect(() => {
    if (revealed.current === current) return;

    revealed.current = current;

    const repository = tasks.find((task) => task.id === current)?.repository;
    if (repository) setGroupOpen(repository, true);
  }, [current, tasks, setGroupOpen]);

  const setOpenGroups = (open: string[]) => {
    for (const { repository } of groups) {
      setGroupOpen(repository, open.includes(repository));
    }
  };

  const setGroupExpanded = (repository: string, expand: boolean) =>
    setExpanded((current) => {
      const next = new Set(current);

      if (expand) next.add(repository);
      else next.delete(repository);

      return next;
    });

  return {
    groups: groups.map(({ repository, tasks }) => {
      const rows = capped
        ? groupRows(tasks, current)
        : { shown: tasks, hidden: [] };

      const isExpanded = expanded.has(repository);

      return {
        repository,
        tasks,
        shown: isExpanded ? tasks : rows.shown,
        hidden: isExpanded ? [] : rows.hidden,
        canShowLess: isExpanded && rows.hidden.length > 0,
        open: !collapsed.has(repository),
      };
    }),
    setOpenGroups,
    setGroupExpanded,
  };
}

type ProjectGroupsProps = {
  model: ReturnType<typeof useProjectGroups>;
  projectName: (repository: string) => string;
  renderRow: (task: Task) => ReactNode;
};

/** The all-projects task list accordion. */
export function ProjectGroups({
  model,
  projectName,
  renderRow,
}: ProjectGroupsProps) {
  return (
    <Accordion.Root
      multiple
      value={model.groups.flatMap(({ repository, open }) =>
        open ? [repository] : [],
      )}
      onValueChange={model.setOpenGroups}
    >
      {model.groups.map((group) => (
        <TaskGroup
          key={group.repository}
          {...group}
          name={projectName(group.repository)}
          onExpandedChange={(expand) =>
            model.setGroupExpanded(group.repository, expand)
          }
          actions={
            <ProjectGroupMenu
              repository={group.repository}
              name={projectName(group.repository)}
            />
          }
          renderRow={renderRow}
        />
      ))}
    </Accordion.Root>
  );
}
