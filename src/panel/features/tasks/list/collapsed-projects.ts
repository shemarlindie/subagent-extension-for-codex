import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "dw_collapsed_projects";

function storedCollapsed(): ReadonlySet<string> {
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
 * The projects whose task list groups the viewer collapsed. Browser storage
 * keeps them across reloads wherever it is available.
 */
export function useCollapsedProjects() {
  const [collapsed, setCollapsed] = useState(storedCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsed]));
    } catch {
      // Groups still collapse for this session without browser storage.
    }
  }, [collapsed]);

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
