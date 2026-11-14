import { useEffect, useRef, useState } from "react";

import type { ProviderCommand } from "../../../../../shared/providers/types";
import { useController } from "../../../../app/state/controller-context";

/**
 * The task's slash commands, read when the draft first starts a command and
 * kept for the task while the composer stays mounted. Until they arrive, or
 * if the read fails, there are none and the composer works as usual.
 */
export function useTaskCommands(taskId: string | undefined, typing: boolean) {
  const controller = useController();

  const [read, setRead] = useState<{
    taskId: string;
    commands: ProviderCommand[];
  }>();

  const requested = useRef<string>(undefined);

  useEffect(() => {
    if (!taskId || !typing || requested.current === taskId) return;
    requested.current = taskId;

    controller
      .tool<{ commands: ProviderCommand[] }>("app_list_commands", {
        task_id: taskId,
      })
      .then(
        ({ commands }) => setRead({ taskId, commands }),
        () => {
          // A later command tries again.
          if (requested.current === taskId) requested.current = undefined;
        },
      );
  }, [controller, taskId, typing]);

  return read && read.taskId === taskId ? read.commands : [];
}
