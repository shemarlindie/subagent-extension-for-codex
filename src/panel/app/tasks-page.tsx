import { WorkerReadinessNotice } from "../features/providers/worker-readiness-notice";
import { TaskInspector } from "../features/tasks/inspector/task-inspector";
import { TaskFilters } from "../features/tasks/list/task-filters";
import { TaskList } from "../features/tasks/list/task-list";
import { Header } from "./header";
import { TaskLayout, useTaskRail } from "./task-layout";

export function TasksPage() {
  const rail = useTaskRail();

  return (
    <>
      <Header taskRail={rail} />
      <WorkerReadinessNotice />
      <TaskLayout
        rail={rail}
        list={
          <>
            <TaskFilters />
            <TaskList />
          </>
        }
        inspector={<TaskInspector />}
      />
    </>
  );
}
