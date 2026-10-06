import { useEffect } from "react";

import { useController, useSnapshot } from "../components/controller-context";
import { DialogHost } from "../components/dialog-host";
import { Header } from "../components/header";
import { InlinePreview } from "../components/inline-preview";
import { ProjectScope } from "../components/project-scope";
import { TaskFilters } from "../components/task-filters";
import { TaskInspector } from "../components/task-inspector";
import { TaskList } from "../components/task-list";
import { LoginForm } from "../forms/login-form";

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
