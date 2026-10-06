import type { Artifact, ArtifactSummary } from "../../shared/state/types";
import {
  type ArtifactFormat,
  artifactFormat,
  artifactLanguage,
  baseMime,
  isBase64Image,
  prettyJson,
} from "./artifact-file";

export type ArtifactView =
  "report" | "preview" | "diff" | "table" | "image" | "source";

export const MAX_PREVIEW_LINES = 5000;

const FORMAT_NAMES: Record<ArtifactFormat, string> = {
  diff: "Diff",
  json: "JSON",
  markdown: "Markdown",
  csv: "Table",
  image: "Image",
  code: "Code",
  text: "Text",
};

const VIEW_LABELS: Record<ArtifactView, string> = {
  report: "Report",
  preview: "Preview",
  diff: "Changes",
  table: "Table",
  image: "Image",
  source: "Source",
};

type ArtifactViewsByFormat = Partial<Record<ArtifactFormat, ArtifactView[]>>;

export function formatName(format: ArtifactFormat) {
  return FORMAT_NAMES[format];
}

/** A short uppercase label for a file badge, such as JSON or DIFF. */
export function fileBadge(fileName: string) {
  return (fileName.split(".").at(-1) ?? "").toUpperCase().slice(0, 4);
}

export function imageSource(artifact: Artifact) {
  const mime = baseMime(artifact);

  return isBase64Image(artifact)
    ? `data:${mime};base64,${artifact.content.trim()}`
    : `data:${mime};charset=utf-8,${encodeURIComponent(artifact.content)}`;
}

/**
 * The ways an artifact can be shown, best first, from its summary alone so the
 * switcher appears before the content loads. A single view hides the switcher.
 */
export function artifactViews(summary: ArtifactSummary): ArtifactView[] {
  const views: ArtifactViewsByFormat = {
    json: summary.report ? ["report", "source"] : ["source"],
    markdown: ["preview", "source"],
    diff: summary.snippet.kind === "diff" ? ["diff", "source"] : ["source"],
    csv: ["table", "source"],
    image:
      summary.mime_type === "image/svg+xml" ? ["image", "source"] : ["image"],
  };

  return views[summary.format] ?? ["source"];
}

export function viewLabel(view: ArtifactView) {
  return VIEW_LABELS[view];
}

/** Source text for the Source view, formatted for its type. */
export function artifactSource(artifact: Artifact) {
  const format = artifactFormat(artifact);

  return {
    // Only minified JSON is reformatted; pretty-printed JSON is shown as stored.
    code:
      format === "json" && !artifact.content.slice(0, 2000).includes("\n")
        ? prettyJson(artifact.content)
        : artifact.content,
    language:
      format === "json"
        ? "json"
        : format === "diff"
          ? "diff"
          : format === "markdown"
            ? "markdown"
            : artifactLanguage(artifact),
  };
}
