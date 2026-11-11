import { Accordion } from "@base-ui/react/accordion";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useSnapshot } from "../../../app/state/controller-context";
import type { Task } from "../../../app/state/types";
import { useCollapsedProjects } from "./collapsed-projects";
import { ProjectGroupMenu } from "./project-group-menu";
import { tasksByProject } from "./selectors";
import { TaskGroup } from "./task-group";

type ProjectGroupsProps = {
  /** The listed tasks across projects, in display order. */
  tasks: Task[];
  projectName: (repository: string) => string;
  renderRow: (task: Task) => ReactNode;
};

/**
 * The all-projects task list: an accordion with a group for each project.
 * Long groups stop at a few rows so one project can't bury the rest, except
 * while searching or when only one project is listed.
 */
export function ProjectGroups({
  tasks,
  projectName,
  renderRow,
}: ProjectGroupsProps) {
  const { search, selected } = useSnapshot(["search", "selected"]);
  const groups = tasksByProject(tasks);
  const capped = !search && groups.length > 1;
  const [collapsed, setGroupOpen] = useCollapsedProjects();
  // Groups whose "Show more" was chosen, while the groups stay shown.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const revealed = useRef(selected);

  // Choosing a task from outside the list, such as a toast, opens its group.
  useEffect(() => {
    if (revealed.current === selected) return;

    revealed.current = selected;

    const repository = tasks.find((task) => task.id === selected)?.repository;

    if (repository) setGroupOpen(repository, true);
  });

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

  return (
    <Accordion.Root
      multiple
      value={groups
        .map((group) => group.repository)
        .filter((repository) => !collapsed.has(repository))}
      onValueChange={setOpenGroups}
    >
      {groups.map(({ repository, tasks }) => (
        <TaskGroup
          key={repository}
          repository={repository}
          name={projectName(repository)}
          tasks={tasks}
          capped={capped}
          selected={selected}
          expanded={expanded.has(repository)}
          onExpandedChange={(expand) => setGroupExpanded(repository, expand)}
          open={!collapsed.has(repository)}
          actions={
            <ProjectGroupMenu
              repository={repository}
              name={projectName(repository)}
            />
          }
          renderRow={renderRow}
        />
      ))}
    </Accordion.Root>
  );
}
