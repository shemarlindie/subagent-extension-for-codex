import { useState } from "react";

import { useController, useSnapshot } from "../../app/state/controller-context";
import { Button } from "../../shared/components/button/button";
import { TooltipWrapper } from "../../shared/components/tooltip";

/**
 * Shares the file with the host's model as the selected item, so the next
 * message can ask about it. Shown only where the host takes shared context.
 */
export function ShareFileButton({ path }: { path: string }) {
  const controller = useController(),
    canShare = useSnapshot().host.canShare,
    [shared, setShared] = useState(false);

  if (!canShare) return null;

  const label = shared ? "Shared with Codex" : "Ask Codex about this file";

  return (
    <TooltipWrapper label={label}>
      <Button
        className="file-action"
        onClick={() =>
          controller.run(async () => {
            await controller.share({ kind: "file", path });
            setShared(true);
          })
        }
      >
        <span className="file-action-label">{label}</span>
      </Button>
    </TooltipWrapper>
  );
}
