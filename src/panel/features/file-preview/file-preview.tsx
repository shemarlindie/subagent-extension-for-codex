import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import {
  type ReactNode,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useController } from "../../app/state/controller-context";
import { CopyButton } from "../../shared/components/copy-button/copy-button";
import { formatBytes } from "../../shared/utils/format";
import { scrollChildIntoView } from "../../shared/utils/scroll-into-view";
import { hasClipboardApi } from "../../shared/utils/write-clipboard";
import { type ParsedDiffFile } from "./diff/diff-format";
import { FileBadge } from "./file-badge";
import {
  fileBytes,
  fileFormat,
  fileName,
  type FileView,
  type FileViews,
  fileViews,
  formatName,
  isLargeSvg,
  MAX_SVG_IMAGE_BYTES,
  type PreviewFile,
  viewLabel,
} from "./file-format";
import { FileViewer } from "./file-viewer";
import { Progress } from "./progress";

type FilePreviewProps = {
  file: PreviewFile;
  /** Where to render the view tabs instead of keeping them in the toolbar. */
  viewSwitcherTarget?: HTMLElement | null;
  /** Extra toolbar buttons, before Copy. */
  beforeActions?: ReactNode;
  /** Extra toolbar buttons, after Copy. */
  actions?: ReactNode;
  /** The file's own diff; adds a Diff view after the format's views. */
  diff?: ParsedDiffFile;
  /** The chosen view, when the owner keeps it across files. */
  view?: FileView;
  onViewChange?: (view: FileView) => void;
  /** The owner's progress, such as reading the next file; replaces the view's. */
  progress?: ReactNode;
  /** Shows the switcher with a single view too, so files share one layout. */
  alwaysShowViews?: boolean;
  /** Wrap source and diff lines; otherwise their viewers scroll horizontally. */
  wrapLines?: boolean;
};

/** A file with a switcher between the views its format offers. */
export function FilePreview({
  file,
  viewSwitcherTarget,
  beforeActions,
  actions,
  diff,
  view: chosenView,
  onViewChange,
  progress,
  alwaysShowViews = false,
  wrapLines = false,
}: FilePreviewProps) {
  const controller = useController();
  const canCopy = !controller.transport.embedded && hasClipboardApi();
  const format = fileFormat(file);

  const views = useMemo(
    (): FileViews => (diff ? [...fileViews(file), "changes"] : fileViews(file)),
    [file, diff],
  );

  // Sizing reads the whole content, so it runs once per file, not per render.
  const size = useMemo(() => fileBytes(file), [file]);
  const largeSvg = useMemo(() => isLargeSvg(file), [file]);
  const [ownView, setOwnView] = useState<FileView>(views[0]);
  const chosen = chosenView ?? ownView;
  const setView = onViewChange ?? setOwnView;
  // A new file may not offer the chosen view; it then opens in its best one.
  const view = views.includes(chosen) ? chosen : views[0];
  // The switcher follows `view` at once; the body renders `shown` in the
  // background, keeping the previous view until the new one is ready.
  const shown = useDeferredValue(view);
  const rendering = shown !== view;
  const switcherRef = useRef<HTMLDivElement>(null);

  const switcher =
    views.length > 1 || alwaysShowViews ? (
      <ToggleGroup
        ref={switcherRef}
        className="view-switch"
        aria-label="View"
        value={[view]}
        onValueChange={([next]) => next && setView(next)}
      >
        {views.map((option) => (
          <Toggle key={option} value={option} className="view-option">
            {viewLabel(option)}
          </Toggle>
        ))}
      </ToggleGroup>
    ) : null;

  const renderedSwitcher = viewSwitcherTarget
    ? switcher && createPortal(switcher, viewSwitcherTarget)
    : switcher;

  // Narrow headings scroll the view choices; file changes can move the selection.
  useEffect(() => {
    const list = switcherRef.current;
    const selected = list?.querySelector<HTMLElement>("[data-pressed]");

    if (list && selected) scrollChildIntoView(list, selected, 2);
  }, [view, views, viewSwitcherTarget]);

  return (
    // Read-only, so there is no footer: the close button and Escape dismiss it.
    <div className="file-preview" data-wrap-lines={wrapLines}>
      <div className="file-preview-toolbar">
        <FileBadge path={file.path} format={format} />
        <span className="file-meta">
          <span className="file-name">{fileName(file.path)}</span>
          <span>{formatName(format)}</span>
          <span>{formatBytes(size)}</span>
        </span>
        {renderedSwitcher}
        <span className="toolbar-actions">
          {beforeActions}
          {/* Only show Copy where the browser exposes clipboard access. */}
          {canCopy && format !== "image" && <CopyButton text={file.content} />}
          {actions}
        </span>
        {progress ||
          (rendering && <Progress label={`Showing ${viewLabel(view)}`} />)}
      </div>
      <div
        className="file-preview-body"
        data-view={shown}
        aria-busy={rendering}
      >
        {largeSvg && (
          <p className="help file-preview-note">
            This SVG is over {formatBytes(MAX_SVG_IMAGE_BYTES)}, so it is shown
            as source only.
          </p>
        )}
        <FileViewer file={file} view={shown} diff={diff} />
      </div>
    </div>
  );
}
