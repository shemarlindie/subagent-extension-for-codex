import { useEffect, useLayoutEffect } from "react";

import { LoginForm } from "../features/auth/login-form";
import { InlinePreview } from "../features/tasks/list/inline-preview";
import { useUnreadTitle } from "../features/tasks/unread/use-unread-title";
import { Presence } from "../shared/components/motion/presence";
import { DialogHost } from "../shared/dialogs/dialog-host";
import { trackIdleScrollbars } from "../shared/utils/idle-scrollbars";
import { PageOutlet } from "./navigation/page-outlet";
import { useController, useSnapshot } from "./state/controller-context";
import type { Snapshot } from "./state/types";
import { TaskArrivalToast } from "./task-arrival-toast";

/** Whether the panel shows only the inline preview of an embedded host. */
function isCompact(state: Snapshot, embedded: boolean) {
  return embedded && state.host.displayMode === "inline";
}

/**
 * Sets the body attributes the layout styles key off. Bootstrap applies them
 * before the first render, so no layout is measured or painted without them.
 */
export function applyBodyLayout(state: Snapshot, embedded: boolean) {
  const { dataset } = document.body;
  // Composing a task shows the inspector in place of the list, like a selection.
  dataset.selected = String(Boolean(state.selected || state.newTask));
  dataset.displayMode = state.host.displayMode;
  dataset.expandedPanel = String(!isCompact(state, embedded));
}

export function AppShell() {
  const controller = useController(),
    state = useSnapshot(),
    { embedded } = controller.transport;

  const compact = isCompact(state, embedded);
  useEffect(() => trackIdleScrollbars(document), []);
  useUnreadTitle();

  // Before paint, so a change never shows the previous layout.
  useLayoutEffect(() => applyBodyLayout(state, embedded), [state, embedded]);

  return (
    <>
      {compact ? (
        <InlinePreview />
      ) : (
        <>
          <Presence show={Boolean(state.error)}>
            {state.error && (
              <div id="error" className="context-error" role="alert">
                {state.error}
              </div>
            )}
          </Presence>
          <TaskArrivalToast />
          <PageOutlet />
          <LoginForm />
        </>
      )}
      <DialogHost suspended={compact} />
    </>
  );
}
