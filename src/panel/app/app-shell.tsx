import { useEffect } from "react";

import { LoginForm } from "../features/auth/login-form";
import { InlinePreview } from "../features/tasks/list/inline-preview";
import { Presence } from "../shared/components/motion/presence";
import { DialogHost } from "../shared/dialogs/dialog-host";
import { trackIdleScrollbars } from "../shared/utils/idle-scrollbars";
import { PageOutlet } from "./navigation/page-outlet";
import { useController, useSnapshot } from "./state/controller-context";

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
          <Presence show={Boolean(state.error)}>
            {state.error && (
              <div id="error" className="context-error" role="alert">
                {state.error}
              </div>
            )}
          </Presence>
          <PageOutlet />
          <LoginForm />
        </>
      )}
      <DialogHost suspended={compact} />
    </>
  );
}
