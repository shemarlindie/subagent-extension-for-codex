import { useEffect } from "react";

import { LoginForm } from "../../features/auth/login-form";
import { ProjectScope } from "../../features/projects/project-scope";
import { WorkerReadinessNotice } from "../../features/providers/worker-readiness-notice";
import { TaskInspector } from "../../features/tasks/inspector/task-inspector";
import { InlinePreview } from "../../features/tasks/list/inline-preview";
import { TaskFilters } from "../../features/tasks/list/task-filters";
import { TaskList } from "../../features/tasks/list/task-list";
import { DialogHost } from "../../shared/dialogs/dialog-host";
import {
  useController,
  useSnapshot,
} from "../../shared/state/controller-context";
import { Header } from "../header";

export function AppShell() {
  const controller = useController(),
    state = useSnapshot();

  const compact =
    controller.transport.embedded && state.host.displayMode === "inline";

  const expandedPanel = !compact;

  useEffect(() => {
    document.body.dataset.selected = String(Boolean(state.selected));
    document.body.dataset.displayMode = state.host.displayMode;
    document.body.dataset.expandedPanel = String(expandedPanel);
  }, [state.selected, state.host.displayMode, expandedPanel]);

  return (
    <>
      {compact ? (
        <InlinePreview />
      ) : (
        <>
          <Header />
          <ProjectScope />
          <WorkerReadinessNotice />
          <div className="shell">
            <aside aria-label="Delegated tasks">
              <TaskFilters />
              <TaskList />
            </aside>
            <TaskInspector />
          </div>
          <LoginForm />
        </>
      )}
      <DialogHost suspended={compact} />
    </>
  );
}
