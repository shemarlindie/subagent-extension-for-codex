import type { ReactNode } from "react";

import { useSingleFlight } from "../../../shared/utils/use-single-flight";
import type { OpenFileLink } from "./file-link-context";

type FileLinkProps = {
  path: string;
  openFile: OpenFileLink;
  children?: ReactNode;
};

/**
 * A link to a file, which opens it one click at a time and shows it's busy
 * meanwhile. It's a button, so no browser action, such as opening a new tab,
 * skips the opener's checks.
 */
export function FileLink({ path, openFile, children }: FileLinkProps) {
  const [opening, run] = useSingleFlight();

  return (
    <button
      type="button"
      className="markdown-file-link"
      title={path}
      aria-busy={opening || undefined}
      onClick={() => run(() => openFile(path))}
    >
      {children}
    </button>
  );
}
