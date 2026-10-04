import { Collapsible } from "@base-ui/react/collapsible";
import type { Task } from "../core/types";
import { Chevron } from "./chevron";

interface TaskDescriptionProps {
  task: Task;
  defaultOpen?: boolean;
}

export function TaskDescription({
  task,
  defaultOpen = false,
}: TaskDescriptionProps) {
  return (
    <Collapsible.Root className="task-description" defaultOpen={defaultOpen}>
      <Collapsible.Trigger className="task-description-trigger">
        <Chevron square />
        Description
      </Collapsible.Trigger>
      {/* The panel animates its height; the inner box keeps its own scroll and padding. */}
      <Collapsible.Panel className="collapse-panel">
        <div className="task-description-content">{task.description}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
