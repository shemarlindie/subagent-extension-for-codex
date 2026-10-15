import { useCallback, useState } from "react";

type DividerPlaces = { at?: string; leaving?: string };

/**
 * The row the "New" divider just left, kept until its collapse finishes, so a
 * moved divider closes its old space instead of vanishing. `at` is the row the
 * divider now sits above.
 */
export function useLeavingDivider(at: string | undefined) {
  const [places, setPlaces] = useState<DividerPlaces>({ at });

  if (places.at !== at) setPlaces({ at, leaving: places.at });

  const left = useCallback(
    () => setPlaces((places) => ({ at: places.at })),
    [],
  );

  return { leaving: places.leaving === at ? undefined : places.leaving, left };
}
