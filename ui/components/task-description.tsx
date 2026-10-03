import { Collapsible } from "@base-ui/react/collapsible";
import type { Task } from "../core/types";
import { Chevron } from "./chevron";

export function TaskDescription({ task }: { task: Task }) {
  return (
    <Collapsible.Root className="task-description" defaultOpen={false}>
      <Collapsible.Trigger className="task-description-trigger">
        <Chevron />
        Description
      </Collapsible.Trigger>
      <Collapsible.Panel className="task-description-content">
        {task.description}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
