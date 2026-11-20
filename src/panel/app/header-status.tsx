import { Icon } from "../shared/components/icons/icons";
import { Infotip } from "../shared/components/infotip";
import { MotionContent } from "../shared/components/motion/motion-content";
import { connectionTrouble } from "./state/connection";
import { useSnapshot } from "./state/controller-context";

const UPDATING = "Updating…";

const UPDATING_NOTE =
  "A new version of the extension is installed. It takes over once working tasks finish their turns, and starts new turns after that.";

/**
 * The header's service status: connection problems, or an update waiting for
 * running turns. A working connection shows nothing. The task list explains a
 * missing one.
 */
export function HeaderStatus() {
  const { connection, updating } = useSnapshot(["connection", "updating"]);
  const trouble = connectionTrouble(connection);
  // A connection problem matters more than an update.
  const showUpdating = updating && !trouble;
  const label = showUpdating ? UPDATING : connection;

  return (
    <>
      <span
        id="connection"
        className={trouble ? "connection" : "visually-hidden"}
        role="status"
      >
        <MotionContent changeKey={label}>{label}</MotionContent>
      </span>
      {/* Narrow panels show this icon in place of the text, which stays announced. */}
      {trouble && (
        <Infotip label={connection}>
          <button type="button" className="text-button connection-icon">
            <Icon name="alert-triangle" size={14} />
          </button>
        </Infotip>
      )}
      {showUpdating && (
        <Infotip label={UPDATING_NOTE} triggerLabel={UPDATING}>
          <button
            type="button"
            id="service-updating"
            className="text-button service-updating"
          >
            <Icon name="refresh" size={14} />
            {/* The trigger's accessible name already says this. */}
            <span aria-hidden="true">{UPDATING}</span>
          </button>
        </Infotip>
      )}
    </>
  );
}
