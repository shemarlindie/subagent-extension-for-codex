/**
 * Format detection and helpers for previewing a file: its MIME type, how it is
 * rendered, the views it offers and the source text it shows.
 */
import parseDiff from "parse-diff";

/** A file to preview. Without a MIME type, it comes from the path's extension. */
export type PreviewFile = {
  path: string;
  content: string;
  mime_type?: string;
};

/** How a file is rendered; detected from its MIME type, then its extension. */
export type FileFormat =
  "diff" | "json" | "markdown" | "csv" | "image" | "code" | "text";

export type FileView = "preview" | "diff" | "table" | "image" | "source";

export type ParsedDiffFile = ReturnType<typeof parseDiff>[number];

/** SVGs larger than this show as source only, never rendered as an image. */
export const MAX_SVG_IMAGE_BYTES = 64 * 1024;

const MIME_FORMATS: Record<string, FileFormat> = {
  "text/x-diff": "diff",
  "text/x-patch": "diff",
  "text/diff": "diff",
  "application/json": "json",
  "text/markdown": "markdown",
  "text/x-markdown": "markdown",
  "text/csv": "csv",
  "text/tab-separated-values": "csv",
};

/** MIME types for extensions whose format the MIME type decides. */
const EXTENSION_MIMES: Record<string, string> = {
  bmp: "image/bmp",
  csv: "text/csv",
  diff: "text/x-diff",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  markdown: "text/markdown",
  md: "text/markdown",
  patch: "text/x-patch",
  png: "image/png",
  svg: "image/svg+xml",
  tsv: "text/tab-separated-values",
  webp: "image/webp",
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
  md: "markdown",
  mjs: "javascript",
  patch: "diff",
  php: "php",
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

const VIEW_LABELS: Record<FileView, string> = {
  preview: "Preview",
  diff: "Changes",
  table: "Table",
  image: "Image",
  source: "Source",
};

function extensionOf(path: string) {
  return /\.([a-z0-9]{1,8})$/i.exec(path)?.[1]?.toLowerCase();
}

/** The last segment of a path. */
export function fileName(path: string) {
  return path.split(/[\\/]/).at(-1) || path;
}

export function baseMime(file: Pick<PreviewFile, "path" | "mime_type">) {
  if (file.mime_type) return file.mime_type.split(";")[0].trim().toLowerCase();

  return EXTENSION_MIMES[extensionOf(file.path) ?? ""] ?? "text/plain";
}

/** The highlight.js language for a path, if one is known. */
export function pathLanguage(path: string | undefined) {
  return LANGUAGES[extensionOf(path ?? "") ?? ""];
}

export function fileFormat(file: PreviewFile): FileFormat {
  const mime = baseMime(file);
  if (MIME_FORMATS[mime]) return MIME_FORMATS[mime];
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
export function isBase64Image(file: PreviewFile) {
  const mime = baseMime(file);

  return mime.startsWith("image/") && mime !== "image/svg+xml";
}

export function imageSource(file: PreviewFile) {
  const mime = baseMime(file);

  return isBase64Image(file)
    ? `data:${mime};base64,${file.content.trim()}`
    : `data:${mime};charset=utf-8,${encodeURIComponent(file.content)}`;
}

/** The file's size in bytes: decoded for base64 images, UTF-8 otherwise. */
export function fileBytes(file: PreviewFile) {
  const content = file.content;

  if (isBase64Image(file)) {
    const trimmed = content.trim();
    const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0;

    return Math.floor((trimmed.length * 3) / 4) - padding;
  }

  let bytes = 0;

  for (let index = 0; index < content.length; index++) {
    const code = content.charCodeAt(index);

    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    // A surrogate pair is one 4-byte code point.
    else if (code >= 0xd800 && code < 0xdc00) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }

  return bytes;
}

/** Pretty-printed JSON, or the content unchanged when it does not parse. */
export function prettyJson(content: string) {
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

/** Parses CSV or TSV, honoring quoted fields with embedded separators and newlines. */
export function parseDelimited(content: string, separator = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;

  for (let index = 0; index < content.length; index++) {
    const char = content[index];

    if (quoted) {
      if (char === '"' && content[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === separator) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && content[index + 1] === "\n") index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export function parseDiffFiles(content: string): ParsedDiffFile[] {
  try {
    return parseDiff(content).filter((file) => file.chunks.length || file.from);
  } catch {
    return [];
  }
}

/** The path a diff file is shown under: its new path, or its old one when deleted. */
export function diffPath(file: ParsedDiffFile) {
  const path = file.to && file.to !== "/dev/null" ? file.to : file.from;

  return path ?? "unknown";
}

export type DiffRow =
  | { kind: "hunk"; content: string }
  | {
      kind: "line";
      type: "add" | "del" | "normal";
      oldLine?: number;
      newLine?: number;
      text: string;
    };

/** A diff file's hunk headers and lines, in order, with line numbers. */
export function diffRows(file: ParsedDiffFile): DiffRow[] {
  return file.chunks.flatMap((chunk): DiffRow[] => [
    { kind: "hunk", content: chunk.content },
    ...chunk.changes.map((change): DiffRow => ({
      kind: "line",
      type: change.type,
      oldLine:
        change.type === "normal"
          ? change.ln1
          : change.type === "del"
            ? change.ln
            : undefined,
      newLine:
        change.type === "normal"
          ? change.ln2
          : change.type === "add"
            ? change.ln
            : undefined,
      text: change.content.slice(1),
    })),
  ]);
}

/** An SVG too large to render as an image; it shows as source only. */
export function isLargeSvg(file: PreviewFile) {
  return (
    baseMime(file) === "image/svg+xml" && fileBytes(file) > MAX_SVG_IMAGE_BYTES
  );
}

/** The ways a file can be shown, best first. A single view hides the switcher. */
export function fileViews(file: PreviewFile): FileView[] {
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
    default:
      return ["source"];
  }
}

/** Source text for the Source view, formatted for its type. */
export function fileSource(file: PreviewFile) {
  const format = fileFormat(file);

  return {
    // Only minified JSON is reformatted; pretty-printed JSON is shown as stored.
    code:
      format === "json" && !file.content.slice(0, 2000).includes("\n")
        ? prettyJson(file.content)
        : file.content,
    language:
      format === "json"
        ? "json"
        : format === "diff"
          ? "diff"
          : format === "markdown"
            ? "markdown"
            : pathLanguage(file.path),
  };
}
