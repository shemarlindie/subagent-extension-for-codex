import { useEffect } from "react";
import { Header } from "../components/header";
import { ProjectScope } from "../components/project-scope";
import { TaskFilters } from "../components/task-filters";
import { TaskList } from "../components/task-list";
import { TaskInspector } from "../components/task-inspector";
import { DialogHost } from "../components/dialog-host";
import { LoginForm } from "../forms/login-form";
import { useController, useSnapshot } from "../components/controller-context";
import { WorkerPicker } from "./worker-picker";
import { InlinePreview } from "../components/inline-preview";
export function AppShell() {
  const controller = useController(),
    state = useSnapshot();
  useEffect(() => {
    document.body.dataset.selected = String(Boolean(state.selected));
    document.body.dataset.displayMode = state.host.displayMode;
  }, [state.selected, state.host.displayMode]);
  const compact =
    state.mode === "panel" &&
    controller.transport.embedded &&
    state.host.displayMode === "inline";
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
          {state.error && (
            <div id="error" className="banner error" role="alert">
              {state.error}
            </div>
          )}
          <div className="shell">
            <aside aria-label="Delegated tasks">
              {state.mode === "console" && <WorkerPicker />}
              <TaskFilters />
              <TaskList />
            </aside>
            <TaskInspector />
          </div>
          {state.mode === "panel" && (
            <div id="notice" role="status">
              Choose an isolated worktree or the current repository when
              starting a task. Current repository edits apply directly.
            </div>
          )}
          {state.mode === "console" && <LoginForm />}
        </>
      )}
      <DialogHost suspended={compact} />
    </>
  );
}
