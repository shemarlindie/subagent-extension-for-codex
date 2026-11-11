import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { MOTION, reducedMotion } from "../motion/motion-utils";
import {
  SkeletonVisibilityContext,
  useLoadingSkeletonDelay,
} from "./loading-skeleton";
import { LOADING_SKELETON_CONFIG } from "./loading-skeleton-config";

type LoadingSwapProps = {
  loading: boolean;
  /** False when a containing region already declares this busy state. */
  busy?: boolean;
  /** The feature-shaped placeholder that stays mounted during its fade-out. */
  skeleton: ReactElement;
  children: ReactNode;
  /** Runs after the outgoing skeleton is removed and content has settled. */
  onSettled?: () => void;
  className?: string;
  as?: "div" | "span";
};

/** Cross-fades a feature-shaped placeholder with the content that replaces it. */
export function LoadingSwap({
  loading,
  busy,
  skeleton,
  children,
  onSettled,
  className,
  as: Tag = "div",
}: LoadingSwapProps) {
  const classes = ["loading-swap", className].filter(Boolean).join(" ");

  const delayedLoading = useLoadingSkeletonDelay(loading);
  const activeSkeleton = loading && delayedLoading;
  const [retainedSkeleton, setRetainedSkeleton] = useState(false);
  const [minimumVisibleElapsed, setMinimumVisibleElapsed] = useState(false);
  const showSkeleton = loading || retainedSkeleton;
  const visibleSkeleton = activeSkeleton || retainedSkeleton;

  const skeletonShownAt = useRef<number | null>(null);
  const wasLoading = useRef(loading);
  const previousLoading = useRef(loading);

  const remainingMinimumVisible =
    skeletonShownAt.current === null
      ? 0
      : Math.max(
          0,
          LOADING_SKELETON_CONFIG.minimumVisible -
            (Date.now() - skeletonShownAt.current),
        );

  const minimumVisibleHold =
    !loading &&
    retainedSkeleton &&
    !minimumVisibleElapsed &&
    remainingMinimumVisible > 0;

  const effectiveLoading = loading || minimumVisibleHold;

  const activeSkeletonLayer =
    activeSkeleton || (loading && retainedSkeleton) || minimumVisibleHold;

  useEffect(() => {
    if (loading || !retainedSkeleton || minimumVisibleHold) return;

    // Keep the outgoing layer through the shared skeleton cross-fade.
    const timeout = window.setTimeout(
      () => setRetainedSkeleton(false),
      reducedMotion() ? 0 : MOTION.loadingCrossfade,
    );

    return () => window.clearTimeout(timeout);
  }, [loading, minimumVisibleHold, retainedSkeleton]);

  useEffect(() => {
    if (loading || !retainedSkeleton || minimumVisibleElapsed) return;

    if (!remainingMinimumVisible) {
      setMinimumVisibleElapsed(true);

      return;
    }

    const timeout = window.setTimeout(
      () => setMinimumVisibleElapsed(true),
      remainingMinimumVisible,
    );

    return () => window.clearTimeout(timeout);
  }, [
    loading,
    minimumVisibleElapsed,
    remainingMinimumVisible,
    retainedSkeleton,
  ]);

  useLayoutEffect(() => {
    if (loading) {
      if (!previousLoading.current) {
        skeletonShownAt.current = null;
        setMinimumVisibleElapsed(false);
      }

      previousLoading.current = true;
      wasLoading.current = true;

      if (
        (activeSkeleton || retainedSkeleton) &&
        skeletonShownAt.current === null
      ) {
        skeletonShownAt.current = Date.now();
      }

      if (activeSkeleton && !retainedSkeleton) setRetainedSkeleton(true);

      return;
    }

    previousLoading.current = false;

    if (!retainedSkeleton && wasLoading.current) {
      wasLoading.current = false;
      skeletonShownAt.current = null;
      onSettled?.();
    }
  }, [activeSkeleton, loading, retainedSkeleton, onSettled]);

  return (
    <Tag
      className={classes}
      data-loading={effectiveLoading}
      data-skeleton-visible={visibleSkeleton || undefined}
      aria-busy={(busy ?? effectiveLoading) || undefined}
    >
      {showSkeleton && (
        <Tag
          className="loading-swap-skeleton"
          aria-hidden={!activeSkeletonLayer || undefined}
          inert={!activeSkeletonLayer || undefined}
        >
          <SkeletonVisibilityContext.Provider
            value={{ visible: visibleSkeleton, loading: activeSkeletonLayer }}
          >
            {skeleton}
          </SkeletonVisibilityContext.Provider>
        </Tag>
      )}
      <Tag
        className="loading-swap-content"
        aria-hidden={effectiveLoading || undefined}
        inert={effectiveLoading || undefined}
      >
        {children}
      </Tag>
    </Tag>
  );
}
