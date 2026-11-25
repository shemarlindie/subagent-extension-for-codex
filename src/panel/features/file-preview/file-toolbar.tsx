import type { ReactNode } from "react";

import { formatBytes } from "../../shared/utils/format";
import { FileBadge } from "./file-badge";
import { fileName, formatName, type FileFormat } from "./file-format";

type FileToolbarProps = {
  path: string;
  /** The file's format, or "document" for a file the panel can't show. */
  format: FileFormat | "document";
  bytes: number;
  /** The view switcher, actions and progress after the file's name. */
  children?: ReactNode;
};

/** A file's badge, name, format and size, above its viewer. */
export function FileToolbar({
  path,
  format,
  bytes,
  children,
}: FileToolbarProps) {
  return (
    <div className="file-preview-toolbar">
      <FileBadge path={path} format={format} />
      <span className="file-meta">
        <span className="file-name">{fileName(path)}</span>
        <span>{format === "document" ? "Document" : formatName(format)}</span>
        <span>{formatBytes(bytes)}</span>
      </span>
      {children}
    </div>
  );
}
