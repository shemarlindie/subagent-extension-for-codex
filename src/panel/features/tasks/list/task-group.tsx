import { type ReactNode, useId } from "react";

type TaskGroupProps = {
  repository: string;
  name: string;
  /** Controls at the end of the header, such as the project's menu. */
  actions?: ReactNode;
  children: ReactNode;
};

/** A project's tasks under a header that sticks while its rows scroll past. */
export function TaskGroup({
  repository,
  name,
  actions,
  children,
}: TaskGroupProps) {
  const id = useId();

  return (
    <div className="task-group" role="group" aria-labelledby={id}>
      <div className="task-group-header" data-task-group={repository}>
        <span className="task-group-name" id={id} title={name}>
          {name}
        </span>
        {actions}
      </div>
      {children}
    </div>
  );
}
