import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import { Button } from "../button/button";
import { Presence } from "../motion/presence";

/**
 * A failed action's reason, kept until dismissed. The shell shows it, or the
 * open dialog does, since a modal hides and blocks the shell.
 */
export function ActionFailureBanner() {
  const controller = useController();
  const actionFailure = useSnapshot((state) => state.actionFailure);

  return (
    <Presence show={Boolean(actionFailure)}>
      {actionFailure && (
        <div className="context-error action-failure">
          <span role="alert">{actionFailure}</span>
          <Button
            variant="text"
            aria-label="Dismiss action failure"
            onClick={controller.dismissActionFailure}
          >
            Dismiss
          </Button>
        </div>
      )}
    </Presence>
  );
}
