import { useEffect } from "react";

import { useController, useSnapshot } from "../components/controller-context";
import { DialogHost } from "../components/dialog-host";
import { Header } from "../components/header";
import { InlinePreview } from "../components/inline-preview";
import { Presence } from "../components/motion";
import { ProjectScope } from "../components/project-scope";
import { TaskFilters } from "../components/task-filters";
import { TaskInspector } from "../components/task-inspector";
import { TaskList } from "../components/task-list";
import { LoginForm } from "../forms/login-form";
import { WorkerPicker } from "./worker-picker";

export function AppShell() {
  const controller = useController(),
    state = useSnapshot();

  const compact =
    state.mode === "panel" &&
    controller.transport.embedded &&
    state.host.displayMode === "inline";

  const expandedPanel = state.mode === "panel" && !compact;

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
          {state.mode === "panel" && <ProjectScope />}
          {controller.transport.preview && (
            <div id="preview" className="banner">
              Design preview · fixture data · actions never execute workers
            </div>
          )}
          <Presence show={Boolean(state.error)}>
            {state.error && (
              <div id="error" className="banner error" role="alert">
                {state.error}
              </div>
            )}
          </Presence>
          <div className="shell">
            <aside aria-label="Delegated tasks">
              {state.mode === "console" && <WorkerPicker />}
              <TaskFilters />
              <TaskList />
            </aside>
            <TaskInspector />
          </div>
          {state.mode === "console" && <LoginForm />}
        </>
      )}
      <DialogHost suspended={compact} />
    </>
  );
}
