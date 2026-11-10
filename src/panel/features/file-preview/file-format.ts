/**
 * Format detection and helpers for previewing a file: its MIME type, how it is
 * rendered, the views it offers and the source text it shows.
 */
import { imageMime } from "../../../shared/changes/changes";
import { parseDiffFiles } from "./diff/diff-format";

/** A file to preview. Without a format or MIME type, it comes from the path's extension. */
export type PreviewFile = {
  path: string;
  content: string;
  mime_type?: string;
  /** The format it was sent as, which decides over its MIME type and path. */
  format?: FileFormat;
  /** The first line's number when the content is an excerpt. */
  start_line?: number;
};

/** How a file is rendered; detected from its MIME type, then its extension. */
export type FileFormat =
  "diff" | "json" | "markdown" | "csv" | "image" | "code" | "text";

/** `diff` renders a diff file's content; `changes` renders the previewed file's own diff. */
export type FileView =
  "preview" | "diff" | "table" | "image" | "source" | "changes";

/** SVGs larger than this show as source only, never rendered as an image. */
export const MAX_SVG_IMAGE_BYTES = 64 * 1024;

const MIME_FORMATS: Partial<Record<string, FileFormat>> = {
  "text/x-diff": "diff",
  "text/x-patch": "diff",
  "text/diff": "diff",
  "application/json": "json",
  "text/markdown": "markdown",
  "text/x-markdown": "markdown",
  "text/csv": "csv",
  "text/tab-separated-values": "csv",
};

/**
 * MIME types for extensions whose format the MIME type decides. Raster images
 * come from the shared `imageMime` list. SVG is here because the service sends
 * it as text.
 */
const EXTENSION_MIMES: Record<string, string> = {
  csv: "text/csv",
  diff: "text/x-diff",
  json: "application/json",
  markdown: "text/markdown",
  md: "text/markdown",
  patch: "text/x-patch",
  svg: "image/svg+xml",
  tsv: "text/tab-separated-values",
};

/** File extensions that highlight.js can color, mapped to its language names. */
const LANGUAGES: Record<string, string> = {
  bash: "bash",
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  diff: "diff",
  go: "go",
  gql: "graphql",
  graphql: "graphql",
  h: "c",
  hpp: "cpp",
  htm: "xml",
  html: "xml",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  kt: "kotlin",
  mk: "makefile",
  md: "markdown",
  mjs: "javascript",
  patch: "diff",
  php: "php",
  ps1: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  svg: "xml",
  swift: "swift",
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

const FORMAT_NAMES: Record<FileFormat, string> = {
  diff: "Diff",
  json: "JSON",
  markdown: "Markdown",
  csv: "Table",
  image: "Image",
  code: "Code",
  text: "Text",
};

/** The highlight.js language for formats that have a fixed one, rather than the path's. */
const FORMAT_LANGUAGES: Partial<Record<FileFormat, string>> = {
  json: "json",
  diff: "diff",
  markdown: "markdown",
};

const VIEW_LABELS: Record<FileView, string> = {
  preview: "Preview",
  diff: "Changes",
  table: "Table",
  image: "Image",
  source: "Source",
  changes: "Diff",
};

function extensionOf(path: string) {
  return /\.([a-z0-9]{1,8})$/i.exec(path)?.[1]?.toLowerCase();
}

/** The last segment of a path. */
export function fileName(path: string) {
  return path.split(/[\\/]/).at(-1) || path;
}

/** The MIME type of each format a file can be sent as. */
const FORMAT_MIMES: Record<FileFormat, string> = {
  diff: "text/x-diff",
  json: "application/json",
  markdown: "text/markdown",
  csv: "text/csv",
  image: "image/png",
  code: "text/plain",
  text: "text/plain",
};

export function baseMime(
  file: Pick<PreviewFile, "path" | "mime_type" | "format">,
) {
  // A sent format is text the label can't turn into an image.
  if (file.format) return FORMAT_MIMES[file.format];

  if (file.mime_type) {
    return file.mime_type.replace(/;.*$/s, "").trim().toLowerCase();
  }

  return (
    EXTENSION_MIMES[extensionOf(file.path) ?? ""] ??
    imageMime(file.path) ??
    "text/plain"
  );
}

/** Files known by name rather than extension. */
const NAMED_LANGUAGES: Record<string, string> = {
  dockerfile: "dockerfile",
  gnumakefile: "makefile",
  makefile: "makefile",
};

/** The highlight.js language for a path, if one is known. */
export function pathLanguage(path: string | undefined) {
  return (
    LANGUAGES[extensionOf(path ?? "") ?? ""] ??
    NAMED_LANGUAGES[fileName(path ?? "").toLowerCase()]
  );
}

export function fileFormat(file: PreviewFile): FileFormat {
  if (file.format) return file.format;
  const mime = baseMime(file);
  const known = MIME_FORMATS[mime];
  if (known) return known;
  if (mime.startsWith("image/")) return "image";
  const extension = extensionOf(file.path);

  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "csv" || extension === "tsv") return "csv";
  if (extension === "json") return "json";
  if (extension === "diff" || extension === "patch") return "diff";
  if (pathLanguage(file.path)) return "code";

  return "text";
}

export function formatName(format: FileFormat) {
  return FORMAT_NAMES[format];
}

export function viewLabel(view: FileView) {
  return VIEW_LABELS[view];
}

/** A short uppercase label for a file badge, such as JSON or DIFF. */
export function fileBadge(path: string) {
  return (fileName(path).split(".").at(-1) ?? "").toUpperCase().slice(0, 4);
}

/** Raster images are base64; SVG is markup. */
function isBase64Image(file: PreviewFile) {
  const mime = baseMime(file);

  return mime.startsWith("image/") && mime !== "image/svg+xml";
}

export function imageSource(file: PreviewFile) {
  const mime = baseMime(file);

  return isBase64Image(file)
    ? `data:${mime};base64,${file.content.trim()}`
    : `data:${mime};charset=utf-8,${encodeURIComponent(file.content)}`;
}

/** The number of `=` characters that pad base64 text. */
function base64Padding(text: string) {
  if (text.endsWith("==")) return 2;
  if (text.endsWith("=")) return 1;

  return 0;
}

/** The file's size in bytes: decoded for base64 images, UTF-8 otherwise. */
export function fileBytes(file: PreviewFile) {
  const content = file.content;

  if (isBase64Image(file)) {
    const trimmed = content.trim();
    const padding = base64Padding(trimmed);

    return Math.floor((trimmed.length * 3) / 4) - padding;
  }

  let bytes = 0;

  for (let index = 0; index < content.length; index++) {
    const code = content.charCodeAt(index);

    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    }
    // A surrogate pair is one 4-byte code point.
    else if (code >= 0xd800 && code < 0xdc00) {
      bytes += 4;
      index++;
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

/** Pretty-printed JSON, or the content unchanged when it does not parse. */
function prettyJson(content: string) {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

export function delimiterOf(file: PreviewFile) {
  return baseMime(file) === "text/tab-separated-values" ||
    extensionOf(file.path) === "tsv"
    ? "\t"
    : ",";
}

/** An SVG too large to render as an image; it shows as source only. */
export function isLargeSvg(file: PreviewFile) {
  return (
    baseMime(file) === "image/svg+xml" && fileBytes(file) > MAX_SVG_IMAGE_BYTES
  );
}

/** A file's views, best first; every file has at least one. */
export type FileViews = [FileView, ...FileView[]];

export function fileViews(file: PreviewFile): FileViews {
  switch (fileFormat(file)) {
    case "markdown":
      return ["preview", "source"];
    case "diff":
      return parseDiffFiles(file.content).length
        ? ["diff", "source"]
        : ["source"];
    case "csv":
      return ["table", "source"];
    case "image":
      if (baseMime(file) !== "image/svg+xml") return ["image"];

      return isLargeSvg(file) ? ["source"] : ["image", "source"];
    case "code":
    case "json":
    case "text":
      return ["source"];
  }
}

/** Source text for the Source view, formatted for its type. */
export function fileSource(file: PreviewFile) {
  const format = fileFormat(file),
    // Only minified JSON is reformatted. Pretty-printed JSON is shown as stored.
    reformat = format === "json" && !file.content.slice(0, 2000).includes("\n");

  return {
    code: reformat ? prettyJson(file.content) : file.content,
    // Text stays plain, even when its label names a language.
    language:
      FORMAT_LANGUAGES[format] ??
      (format === "text" ? undefined : pathLanguage(file.path)),
    // Reformatted lines no longer match the file's.
    ...(file.start_line && !reformat ? { startLine: file.start_line } : {}),
  };
}
