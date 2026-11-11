import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { blockUserScroll } from "../../utils/block-user-scroll";
import { LOADING_SKELETON_CONFIG } from "./loading-skeleton-config";

type LoadingSkeletonProps = {
  label: string;
  /** False when another live region already announces the same loading state. */
  announce?: boolean;
  className?: string;
  as?: "div" | "span";
  /** Prevent scrolling while a tall placeholder occupies a scroll viewport. */
  blockScroll?: boolean;
  children: ReactNode;
};

type SkeletonShapeProps = {
  className?: string;
  /** Prefer for text-shaped blocks whose line height or wrapping affects layout. */
  measureText?: string;
};

type SkeletonTextFrameProps = {
  className?: string;
  /** Text whose inherited typography and wrapping determine the frame height. */
  text: string;
  children: ReactNode;
};

interface SkeletonVisibility {
  visible: boolean;
  loading: boolean;
}

export const SkeletonVisibilityContext =
  createContext<SkeletonVisibility | null>(null);

/** Waits for the shared loading threshold; fast reads never show a skeleton. */
export function useLoadingSkeletonDelay(loading: boolean) {
  const [visible, setVisible] = useState<boolean>(
    () => loading && !LOADING_SKELETON_CONFIG.delay,
  );

  useEffect(() => {
    if (!loading) {
      setVisible(false);

      return;
    }

    if (!LOADING_SKELETON_CONFIG.delay) {
      setVisible(true);

      return;
    }

    setVisible(false);

    const timeout = window.setTimeout(
      () => setVisible(true),
      LOADING_SKELETON_CONFIG.delay,
    );

    return () => window.clearTimeout(timeout);
  }, [loading]);

  return loading && (!LOADING_SKELETON_CONFIG.delay || visible);
}

/** An accessible, feature-shaped placeholder while async panel content loads. */
export function LoadingSkeleton({
  label,
  announce = true,
  className,
  as: Tag = "div",
  blockScroll = false,
  children,
}: LoadingSkeletonProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const parent = useContext(SkeletonVisibilityContext);
  const ownVisible = useLoadingSkeletonDelay(parent === null);
  const visible = parent?.visible ?? ownVisible;
  const loading = parent?.loading ?? true;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !blockScroll || !visible || !loading) return;

    return blockUserScroll(root);
  }, [blockScroll, visible, loading]);

  return (
    <Tag
      ref={(element) => {
        rootRef.current = element;
      }}
      className={["loading-skeleton", className].filter(Boolean).join(" ")}
      data-skeleton-visible={visible || undefined}
      style={visible ? undefined : { visibility: "hidden" }}
      role={announce && visible && loading ? "status" : undefined}
      aria-label={announce && visible && loading ? label : undefined}
      aria-hidden={!announce || !visible || !loading || undefined}
    >
      <SkeletonVisibilityContext.Provider value={{ visible, loading }}>
        {children}
      </SkeletonVisibilityContext.Provider>
    </Tag>
  );
}

/** A decorative shimmer block; its parent provides the accessible label. */
export function SkeletonShape({ className, measureText }: SkeletonShapeProps) {
  const parent = useContext(SkeletonVisibilityContext);
  const ownVisible = useLoadingSkeletonDelay(parent === null);
  const visible = parent?.visible ?? ownVisible;

  const shape = (
    <span
      className={["skeleton-shape", className].filter(Boolean).join(" ")}
      aria-hidden="true"
      data-skeleton-visible={visible || undefined}
      style={visible ? undefined : { visibility: "hidden" }}
    />
  );

  if (measureText === undefined) return shape;

  return <SkeletonTextFrame text={measureText}>{shape}</SkeletonTextFrame>;
}

/** Measures a text block while its child placeholder shapes stay compact. */
export function SkeletonTextFrame({
  className,
  text,
  children,
}: SkeletonTextFrameProps) {
  return (
    <span
      className={["skeleton-text-frame", className].filter(Boolean).join(" ")}
      aria-hidden="true"
      inert
    >
      <span className="skeleton-text-frame-measure">{text}</span>
      <span className="skeleton-text-frame-content">{children}</span>
    </span>
  );
}
