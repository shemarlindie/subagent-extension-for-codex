import { type ReactNode, useId } from "react";

type TaskGroupProps = {
  repository: string;
  name: string;
  children: ReactNode;
};

/** A project's tasks under a header that sticks while its rows scroll past. */
export function TaskGroup({ repository, name, children }: TaskGroupProps) {
  const id = useId();

  return (
    <div className="task-group" role="group" aria-labelledby={id}>
      <div
        className="task-group-header"
        id={id}
        data-task-group={repository}
        title={name}
      >
        {name}
      </div>
      {children}
    </div>
  );
}
