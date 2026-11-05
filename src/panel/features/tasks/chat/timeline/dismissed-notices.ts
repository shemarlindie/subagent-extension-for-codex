import { useState } from "react";

import {
  saveStrings,
  storedStrings,
} from "../../../../shared/utils/stored-strings";

const STORAGE_KEY = "dw_dismissed_workspace_notices";

/**
 * The tasks whose workspace notice the viewer dismissed. Browser storage keeps
 * them across reloads, since this is only a viewing preference.
 */
export function useDismissedNotices() {
  const [dismissed, setDismissed] = useState(() => storedStrings(STORAGE_KEY));

  const dismiss = (taskId: string) => {
    const next = new Set(dismissed).add(taskId);
    setDismissed(next);
    saveStrings(STORAGE_KEY, next);
  };

  return [dismissed, dismiss] as const;
}
