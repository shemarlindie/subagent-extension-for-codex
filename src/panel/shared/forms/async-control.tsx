import type { ReactNode } from "react";

import { LoadingSpinner } from "../components/loading-spinner/loading-spinner";
import { Presence } from "../components/motion/motion";

interface AsyncControlProps {
  loading: boolean;
  label: string;
  children: ReactNode;
}

/** Overlays a compact, accessible loading indicator without changing control layout. */
export function AsyncControl({ loading, label, children }: AsyncControlProps) {
  return (
    <div
      className="async-control"
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
    >
      {children}
      <Presence show={loading}>
        <span
          className="async-control-spinner"
          role="status"
          aria-label={label}
        >
          <LoadingSpinner />
        </span>
      </Presence>
    </div>
  );
}
