import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import { Button } from "../../../shared/components/button/button";
import { Icon } from "../../../shared/components/icons/icons";
import { TooltipWrapper } from "../../../shared/components/tooltip";
import { formatCount } from "../../../shared/utils/format";
import {
  PENDING_UPDATE_FIELDS,
  pendingUpdates,
} from "./pending-update-tracker";

/** The count of worker updates Codex hasn't seen. It opens the dialog to send them. */
export function PendingUpdatesIndicator() {
  const controller = useController();
  const pendingState = useSnapshot(PENDING_UPDATE_FIELDS);
  const { connected, busy } = useSnapshot(["connected", "busy"]);
  const tasks = pendingUpdates(pendingState);
  const updates = tasks.flatMap((task) => task.updates);
  const count = updates.length;

  if (!count) return null;

  const label = `${count} pending worker update${count === 1 ? "" : "s"}`,
    waiting = updates.some((update) => update.kind === "request");

  return (
    <TooltipWrapper label={label}>
      <Button
        id="pending-updates"
        className="pending-updates-button"
        aria-label={label}
        data-waiting={waiting || undefined}
        disabled={!connected || busy}
        onClick={() => controller.open({ kind: "pending-updates" })}
      >
        <Icon name="paper-plane" size={10} />
        <span aria-hidden="true">{formatCount(count)}</span>
      </Button>
    </TooltipWrapper>
  );
}
