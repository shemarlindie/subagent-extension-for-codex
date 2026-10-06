import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { useDeferredValue, useMemo, useState } from "react";

import { useController } from "../../../shared/state/controller-context";
import { formatBytes } from "../../../shared/utils/format";
import {
  fileBytes,
  fileFormat,
  fileName,
  type FileView,
  fileViews,
  formatName,
  isLargeSvg,
  type PreviewFile,
  viewLabel,
} from "../file-format";
import { CopyButton } from "./copy-button";
import { FileBadge } from "./file-badge";
import { FileViewer } from "./file-viewer";
import { Progress } from "./progress";

type FilePreviewProps = {
  file: PreviewFile;
};

/** A file with a switcher between the views its format offers. */
export function FilePreview({ file }: FilePreviewProps) {
  const controller = useController(),
    canCopy =
      !controller.transport.embedded &&
      typeof navigator.clipboard?.writeText === "function",
    format = fileFormat(file),
    views = useMemo(() => fileViews(file), [file]),
    [view, setView] = useState<FileView>(views[0]),
    // The switcher follows `view` at once; the body renders `shown` in the
    // background, keeping the previous view until the new one is ready.
    shown = useDeferredValue(view),
    rendering = shown !== view;

  return (
    // Read-only, so there is no footer: the close button and Escape dismiss it.
    <div className="file-preview">
      <div className="file-preview-toolbar">
        <FileBadge path={file.path} format={format} />
        <span className="file-meta">
          <span className="file-name">{fileName(file.path)}</span>
          <span>{formatName(format)}</span>
          <span>{formatBytes(fileBytes(file))}</span>
        </span>
        {views.length > 1 && (
          <ToggleGroup
            className="view-switch"
            aria-label="View"
            value={[view]}
            onValueChange={(value) => value[0] && setView(value[0])}
          >
            {views.map((option) => (
              <Toggle key={option} value={option} className="view-option">
                {viewLabel(option)}
              </Toggle>
            ))}
          </ToggleGroup>
        )}
        <span className="toolbar-actions">
          {/* Only show Copy where the browser exposes clipboard access. */}
          {canCopy && format !== "image" && <CopyButton text={file.content} />}
        </span>
        {rendering && <Progress label={`Showing ${viewLabel(view)}`} />}
      </div>
      <div
        className="file-preview-body"
        data-view={shown}
        aria-busy={rendering}
      >
        {isLargeSvg(file) && (
          <p className="help file-preview-note">
            This SVG is over 64 KB, so it is shown as source only.
          </p>
        )}
        <FileViewer file={file} view={shown} />
      </div>
    </div>
  );
}
