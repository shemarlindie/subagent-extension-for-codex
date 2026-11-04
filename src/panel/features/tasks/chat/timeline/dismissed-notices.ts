import { useState } from "react";

const STORAGE_KEY = "dw_dismissed_workspace_notices";

function storedDismissed(): ReadonlySet<string> {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "[]",
    );

    return new Set(
      Array.isArray(saved)
        ? saved.filter((item): item is string => typeof item === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

/**
 * The tasks whose workspace notice the viewer dismissed. Browser storage keeps
 * them across reloads wherever it is available, since this is only a viewing
 * preference.
 */
export function useDismissedNotices() {
  const [dismissed, setDismissed] = useState(storedDismissed);

  const dismiss = (taskId: string) => {
    const next = new Set(dismissed).add(taskId);
    setDismissed(next);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      // The notice stays dismissed for this session without browser storage.
    }
  };

  return [dismissed, dismiss] as const;
}
