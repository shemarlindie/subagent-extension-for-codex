import { useState } from "react";

import { Button } from "../../shared/components/button";
import {
  useController,
  useSnapshot,
} from "../../shared/state/controller-context";

/**
 * Shares the file with the host's model as the selected item, so the next
 * message can ask about it. Shown only where the host takes shared context.
 */
export function ShareFileButton({ path }: { path: string }) {
  const controller = useController(),
    canShare = useSnapshot().host.canShare,
    [shared, setShared] = useState(false);

  if (!canShare) return null;

  return (
    <Button
      className="file-action"
      onClick={() =>
        controller.run(async () => {
          await controller.share({ kind: "file", path });
          setShared(true);
        })
      }
    >
      {shared ? "Shared with Codex" : "Ask Codex about this file"}
    </Button>
  );
}
