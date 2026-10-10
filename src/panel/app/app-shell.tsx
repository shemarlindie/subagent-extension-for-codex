import { useEffect } from "react";

import { LoginForm } from "../features/auth/login-form";
import { WorkerReadinessNotice } from "../features/providers/worker-readiness-notice";
import { TaskInspector } from "../features/tasks/inspector/task-inspector";
import { InlinePreview } from "../features/tasks/list/inline-preview";
import { TaskFilters } from "../features/tasks/list/task-filters";
import { TaskList } from "../features/tasks/list/task-list";
import { Presence } from "../shared/components/motion/motion";
import { DialogHost } from "../shared/dialogs/dialog-host";
import { trackIdleScrollbars } from "../shared/utils/idle-scrollbars";
import { Header } from "./header";
import { useController, useSnapshot } from "./state/controller-context";
import { TaskLayout } from "./task-layout";

export function AppShell() {
  const controller = useController(),
    state = useSnapshot();

  const compact =
    controller.transport.embedded && state.host.displayMode === "inline";

  const expandedPanel = !compact;

  useEffect(() => trackIdleScrollbars(document), []);

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
          <Presence show={Boolean(state.error)}>
            {state.error && (
              <div id="error" className="context-error" role="alert">
                {state.error}
              </div>
            )}
          </Presence>
          <WorkerReadinessNotice />
          <TaskLayout
            list={
              <>
                <TaskFilters />
                <TaskList />
              </>
            }
            inspector={<TaskInspector />}
          />
          <LoginForm />
        </>
      )}
      <DialogHost suspended={compact} />
    </>
  );
}
