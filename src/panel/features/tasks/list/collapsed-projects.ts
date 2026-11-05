import { useCallback, useEffect, useState } from "react";

import {
  saveStrings,
  storedStrings,
} from "../../../shared/utils/stored-strings";

const STORAGE_KEY = "dw_collapsed_projects";

/**
 * The projects whose task list groups the viewer collapsed. Browser storage
 * keeps them across reloads wherever it is available.
 */
export function useCollapsedProjects() {
  const [collapsed, setCollapsed] = useState(() => storedStrings(STORAGE_KEY));

  useEffect(() => saveStrings(STORAGE_KEY, collapsed), [collapsed]);

  const setGroupOpen = useCallback(
    (repository: string, open: boolean) =>
      setCollapsed((current) => {
        if (current.has(repository) !== open) return current;

        const next = new Set(current);

        if (open) next.delete(repository);
        else next.add(repository);

        return next;
      }),
    [],
  );

  return [collapsed, setGroupOpen] as const;
}
