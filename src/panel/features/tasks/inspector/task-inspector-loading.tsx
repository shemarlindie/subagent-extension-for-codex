import { useEffect, useState } from "react";

import { LoadingSpinner } from "../../../shared/components/loading-spinner/loading-spinner";
import {
  MOTION,
  reducedMotion,
} from "../../../shared/components/motion/motion-utils";

type TaskInspectorLoadingProps = {
  loading: boolean;
};

/** Overlays a spinner that stays mounted while it fades out over the arriving content. */
export function TaskInspectorLoading({ loading }: TaskInspectorLoadingProps) {
  const [shown, setShown] = useState(loading);

  if (loading && !shown) setShown(true);

  useEffect(() => {
    if (loading || !shown) return;

    const timeout = window.setTimeout(
      () => setShown(false),
      reducedMotion() ? 0 : MOTION.loadingCrossfade,
    );

    return () => window.clearTimeout(timeout);
  }, [loading, shown]);

  if (!shown) return null;

  return (
    <div
      className="task-inspector-loading"
      data-leaving={!loading || undefined}
      role={loading ? "status" : undefined}
      aria-label={loading ? "Loading tasks" : undefined}
      aria-hidden={!loading || undefined}
    >
      <LoadingSpinner />
    </div>
  );
}
