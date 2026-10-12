import { createPortal } from "react-dom";

import {
  LoadingSkeleton,
  SkeletonShape,
} from "../../shared/components/loading-skeleton/loading-skeleton";
import { DiffSkeletonRows } from "./diff/diff-skeleton-rows";
import type { FileFormat } from "./file-format";

export type FilePreviewSkeletonKind = "file" | "deleted" | "binary";

type FilePreviewSkeletonActions = {
  ask: boolean;
  copy: boolean;
  viewed: boolean;
};

type FilePreviewSkeletonProps = {
  format: FileFormat;
  kind: FilePreviewSkeletonKind;
  hasDiff: boolean;
  /** Number of view tabs the loaded preview will offer. */
  viewCount: number;
  /** The dialog heading slot used by the loaded preview's tabs. */
  viewSwitcherTarget: HTMLElement | null;
  /** Whether this loading layer is still visible. */
  loading: boolean;
  actions: FilePreviewSkeletonActions;
};

const VIEW_WIDTHS = ["wide", "medium", "short"] as const;

const CODE_LINES = [
  "wide",
  "medium",
  "short",
  "wide",
  "medium",
  "short",
] as const;

/** Resembles the file toolbar and the kind of content the selected format shows. */
export function FilePreviewSkeleton({
  format,
  kind,
  hasDiff,
  viewCount,
  viewSwitcherTarget,
  loading,
  actions,
}: FilePreviewSkeletonProps) {
  // These tabs are portaled outside LoadingSwap, so unmount them when loaded.
  const viewSwitcher =
    loading && viewCount > 0 ? (
      <span
        className="view-switch file-preview-skeleton-views"
        aria-hidden="true"
        inert
      >
        {Array.from({ length: viewCount }, (_, index) => (
          <SkeletonShape
            className={`file-preview-skeleton-view-${VIEW_WIDTHS[index] ?? "short"}`}
            key={index}
          />
        ))}
      </span>
    ) : null;

  const renderedViewSwitcher = viewSwitcher
    ? viewSwitcherTarget
      ? createPortal(viewSwitcher, viewSwitcherTarget)
      : viewSwitcher
    : null;

  return (
    <LoadingSkeleton
      label="Loading file preview"
      blockScroll
      className="file-preview-skeleton"
    >
      <div className="file-preview">
        <div className="file-preview-toolbar">
          <SkeletonShape className="file-preview-skeleton-badge" />
          <span className="file-meta">
            <SkeletonShape className="file-preview-skeleton-name" />
            {kind === "file" && (
              <>
                <SkeletonShape className="file-preview-skeleton-format" />
                <SkeletonShape className="file-preview-skeleton-size" />
              </>
            )}
          </span>
          {renderedViewSwitcher}
          <span className="toolbar-actions file-preview-skeleton-actions">
            {actions.ask && (
              <SkeletonShape className="file-preview-skeleton-action-primary" />
            )}
            {actions.copy && (
              <SkeletonShape className="file-preview-skeleton-action-copy" />
            )}
            {actions.viewed && (
              <span className="file-preview-skeleton-viewed">
                <SkeletonShape className="file-preview-skeleton-action-viewed" />
              </span>
            )}
          </span>
        </div>
        <div className="file-preview-body">
          {kind === "deleted" ? (
            <>
              <p className="help file-preview-note">Deleted</p>
              {hasDiff && (
                <div className="diff-view">
                  <div className="diff-file file-preview-skeleton-deleted-diff">
                    <div className="file-preview-skeleton-diff-heading">
                      <SkeletonShape className="file-preview-skeleton-diff-path file-preview-skeleton-diff-path-wide" />
                      <SkeletonShape className="file-preview-skeleton-diff-tag" />
                      <span className="diff-stat file-preview-skeleton-diff-stat">
                        <SkeletonShape className="file-preview-skeleton-stat-add" />
                        <SkeletonShape className="file-preview-skeleton-stat-remove" />
                      </span>
                    </div>
                    <DiffSkeletonRows />
                  </div>
                </div>
              )}
            </>
          ) : kind === "binary" ? (
            <SkeletonShape className="file-preview-skeleton-state-line" />
          ) : format === "image" ? (
            <div className="image-view">
              <SkeletonShape className="file-preview-skeleton-image" />
            </div>
          ) : format === "csv" ? (
            <div className="file-preview-skeleton-table">
              <div className="file-preview-skeleton-table-row file-preview-skeleton-table-head">
                {Array.from({ length: 4 }, (_, index) => (
                  <SkeletonShape key={index} />
                ))}
              </div>
              {Array.from({ length: 5 }, (_, row) => (
                <div className="file-preview-skeleton-table-row" key={row}>
                  {Array.from({ length: 4 }, (_, column) => (
                    <SkeletonShape key={column} />
                  ))}
                </div>
              ))}
            </div>
          ) : format === "diff" ? (
            <div className="file-preview-skeleton-diff-list">
              {["wide", "medium"].map((width, index) => (
                <div className="diff-file" key={index}>
                  <div className="file-preview-skeleton-diff-heading">
                    <SkeletonShape className="file-preview-skeleton-diff-chevron" />
                    <SkeletonShape
                      className={`file-preview-skeleton-diff-path file-preview-skeleton-diff-path-${width}`}
                    />
                    <span className="diff-stat file-preview-skeleton-diff-stat">
                      <SkeletonShape className="file-preview-skeleton-stat-add" />
                      <SkeletonShape className="file-preview-skeleton-stat-remove" />
                    </span>
                  </div>
                  <DiffSkeletonRows />
                </div>
              ))}
            </div>
          ) : format === "markdown" ? (
            <div className="file-preview-skeleton-markdown">
              <SkeletonShape className="file-preview-skeleton-markdown-heading" />
              <SkeletonShape className="file-preview-skeleton-markdown-line file-preview-skeleton-markdown-line-wide" />
              <SkeletonShape className="file-preview-skeleton-markdown-line file-preview-skeleton-markdown-line-medium" />
              <div className="file-preview-skeleton-markdown-list">
                <SkeletonShape className="file-preview-skeleton-markdown-line file-preview-skeleton-markdown-line-wide" />
                <SkeletonShape className="file-preview-skeleton-markdown-line file-preview-skeleton-markdown-line-short" />
              </div>
              <SkeletonShape className="file-preview-skeleton-markdown-heading file-preview-skeleton-markdown-subheading" />
              <SkeletonShape className="file-preview-skeleton-markdown-line file-preview-skeleton-markdown-line-medium" />
            </div>
          ) : (
            <div className="code-view file-preview-skeleton-code">
              {CODE_LINES.map((width, index) => (
                <div className="code-line" key={index}>
                  <SkeletonShape className="line-number file-preview-skeleton-number" />
                  <SkeletonShape
                    className={`file-preview-skeleton-line file-preview-skeleton-line-${width}`}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </LoadingSkeleton>
  );
}
