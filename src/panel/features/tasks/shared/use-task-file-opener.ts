import { useMemo } from "react";

import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import { errorMessage } from "../../../shared/utils/error-message";
import type { OpenFileLink } from "../../file-preview/markdown/file-link-context";

/**
 * Opens a file in the task's workspace in the host's viewer, by a
 * workspace-relative or absolute path. Undefined when the host can't open
 * files. The service checks the path, and the panel keeps its reason in view
 * until dismissed, since the next refresh clears a plain error.
 */
export function useTaskFileOpener(taskId: string): OpenFileLink | undefined {
  const controller = useController();
  const canOpenFiles = useSnapshot((state) => state.host.canOpenFiles);
  const { transport } = controller;

  return useMemo(() => {
    if (!canOpenFiles || !transport.openFile || !taskId) return undefined;
    const openFile = transport.openFile.bind(transport);

    const open = async (path: string) => {
      const opened = await controller.tool<{ path: string }>(
        "app_get_task_file_path",
        { task_id: taskId, path },
      );

      await openFile(opened.path);
    };

    // The service's reasons name the path.
    return (path: string) =>
      open(path).catch((error: unknown) =>
        controller.reportActionFailure(errorMessage(error)),
      );
  }, [controller, transport, canOpenFiles, taskId]);
}
