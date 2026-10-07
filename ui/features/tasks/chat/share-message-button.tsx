import { useState } from "react";

import { Button } from "../../../shared/components/button";
import {
  useController,
  useSnapshot,
} from "../../../shared/state/controller-context";

type ShareMessageButtonProps = { id: string };

/**
 * Shares a reply with the host's model as the selected item, so the next
 * message can ask about it. Shown only where the host takes shared context.
 */
export function ShareMessageButton({ id }: ShareMessageButtonProps) {
  const controller = useController(),
    canShare = useSnapshot().host.canShare,
    [shared, setShared] = useState(false);

  if (!canShare) return null;

  return (
    <Button
      variant="text"
      underline
      className="chat-share"
      onClick={() =>
        controller.run(async () => {
          await controller.share({ kind: "message", id });
          setShared(true);
        })
      }
    >
      {shared ? "Shared with Codex" : "Ask Codex about this reply"}
    </Button>
  );
}
