/**
 * Artifact file helpers shared by the service and the panel: format detection,
 * file names, and the bounded summaries the panel's file cards render. Keep this
 * module free of runtime imports so the browser bundle can use it.
 */
import type { Artifact } from "./model.js";

/** How an artifact is rendered; detected from its MIME type, type and title. */
export type ArtifactFormat =
  "diff" | "json" | "markdown" | "csv" | "image" | "code" | "text";

/** The fields that decide an artifact's format and file name. */
export type ArtifactInfo = Pick<Artifact, "type" | "title" | "mime_type">;

export type DiffFileStat = {
  path: string;
  /** The old path when the file was renamed. */
  from?: string;
  status: "added" | "deleted" | "modified" | "renamed";
  additions: number;
  deletions: number;
};

/** What a file card shows without loading the artifact's content. */
export type ArtifactSnippet =
  | { kind: "lines"; text: string; language?: string }
  | { kind: "markdown"; text: string }
  | { kind: "table"; rows: string[][]; total_rows: number }
  | {
      kind: "diff";
      files: DiffFileStat[];
      total_files: number;
      additions: number;
      deletions: number;
    }
  // A data URL: a service-made thumbnail, or a small SVG as itself.
  | { kind: "image"; src: string }
  | { kind: "none" }
  // The artifact could not be read; its card says so and the others still list.
  | { kind: "error"; message: string };

/** An artifact without its content, plus what the panel needs to list it. */
export type ArtifactSummary = Omit<Artifact, "content"> & {
  file_name: string;
  format: ArtifactFormat;
  /** Bytes as downloaded (decoded for base64 images). */
  size: number;
  snippet: ArtifactSnippet;
  /** JSON shaped like a worker result, which the preview can show as a report. */
  report?: boolean;
};

const MIME_FORMATS: Record<string, ArtifactFormat> = {
  "text/x-diff": "diff",
  "text/x-patch": "diff",
  "text/diff": "diff",
  "application/json": "json",
  "text/markdown": "markdown",
  "text/x-markdown": "markdown",
  "text/csv": "csv",
  "text/tab-separated-values": "csv",
};

const MIME_EXTENSIONS: Record<string, string> = {
  "text/x-diff": "diff",
  "text/x-patch": "patch",
  "text/diff": "diff",
  "application/json": "json",
  "text/markdown": "md",
  "text/x-markdown": "md",
  "text/csv": "csv",
  "text/tab-separated-values": "tsv",
  "text/html": "html",
  "text/css": "css",
  "text/javascript": "js",
  "application/javascript": "js",
  "application/typescript": "ts",
  "application/xml": "xml",
  "text/xml": "xml",
  "application/yaml": "yaml",
  "text/yaml": "yaml",
  "application/x-sh": "sh",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
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

const TYPE_EXTENSIONS: Record<string, string> = {
  diff: "diff",
  log: "log",
};

function extensionOf(name: string) {
  return /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase();
}

export function baseMime(artifact: ArtifactInfo) {
  return artifact.mime_type.split(";")[0].trim().toLowerCase();
}

/** The extension the downloaded file gets. */
export function artifactExtension(artifact: ArtifactInfo) {
  const mime = baseMime(artifact);

  return (
    MIME_EXTENSIONS[mime] ??
    TYPE_EXTENSIONS[artifact.type] ??
    extensionOf(artifact.title) ??
    (mime.startsWith("text/") ? "txt" : "bin")
  );
}

/** A file name for the artifact, keeping a title that is already a file name. */
export function artifactFileName(artifact: ArtifactInfo) {
  const extension = artifactExtension(artifact),
    titled = extensionOf(artifact.title);

  if (titled && (titled === extension || LANGUAGES[titled]))
    return artifact.title.trim();

  const stem =
    artifact.title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) ||
    artifact.type ||
    "artifact";

  return `${stem}.${extension}`;
}

export function artifactFormat(artifact: ArtifactInfo): ArtifactFormat {
  const mime = baseMime(artifact);
  if (MIME_FORMATS[mime]) return MIME_FORMATS[mime];
  if (mime.startsWith("image/")) return "image";
  if (artifact.type === "diff") return "diff";
  const extension = extensionOf(artifact.title);

  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "csv" || extension === "tsv") return "csv";
  if (extension === "json") return "json";
  if (extension === "diff" || extension === "patch") return "diff";
  if (artifactLanguage(artifact)) return "code";

  return "text";
}

/** The highlight.js language for code-like artifacts, if one is known. */
export function artifactLanguage(artifact: ArtifactInfo) {
  const mimeExtension = MIME_EXTENSIONS[baseMime(artifact)];

  return (
    LANGUAGES[extensionOf(artifact.title) ?? ""] ??
    LANGUAGES[mimeExtension ?? ""]
  );
}

/** The highlight.js language for a path inside a diff. */
export function pathLanguage(path: string | undefined) {
  return LANGUAGES[extensionOf(path ?? "") ?? ""];
}

/** Raster images are stored as base64; SVG is stored as markup. */
export function isBase64Image(artifact: ArtifactInfo) {
  const mime = baseMime(artifact);

  return mime.startsWith("image/") && mime !== "image/svg+xml";
}

export function delimiterOf(artifact: ArtifactInfo) {
  return baseMime(artifact) === "text/tab-separated-values" ||
    extensionOf(artifact.title) === "tsv"
    ? "\t"
    : ",";
}

/** Byte length of the artifact as downloaded, without copying the content. */
export function artifactBytes(artifact: Artifact) {
  const content = artifact.content;

  if (isBase64Image(artifact)) {
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

/**
 * The first `count` lines, reading no further than needed. Each line is cut at
 * `maxLineChars` so one minified line cannot make the snippet large.
 */
export function headLines(content: string, count: number, maxLineChars = 400) {
  const lines: string[] = [];
  let start = 0;

  while (lines.length < count && start <= content.length) {
    let end = content.indexOf("\n", start);
    if (end < 0) end = content.length;
    lines.push(content.slice(start, Math.min(end, start + maxLineChars)));
    start = end + 1;
  }

  // A trailing newline does not start another line.
  if (lines.length > 1 && lines.at(-1) === "" && start > content.length)
    lines.pop();

  return lines.join("\n");
}

/**
 * Parses CSV or TSV, honoring quoted fields with embedded separators and
 * newlines. With `maxRows`, it stops reading once that many rows are complete.
 */
export function parseDelimited(
  content: string,
  separator = ",",
  maxRows = Infinity,
): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;

  for (
    let index = 0;
    index < content.length && rows.length < maxRows;
    index++
  ) {
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

  if ((field || row.length) && rows.length < maxRows) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** Rows in CSV or TSV content, counting quoted newlines as part of their field. */
export function countDelimitedRows(content: string) {
  let rows = 0,
    quoted = false,
    rowHasContent = false;

  for (let index = 0; index < content.length; index++) {
    const char = content[index];

    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && content[index + 1] === "\n") index++;
      rows++;
      rowHasContent = false;
      continue;
    }

    rowHasContent = true;
  }

  return rows + (rowHasContent ? 1 : 0);
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

const RESULT_SECTIONS = [
  "findings",
  "evidence",
  "changes",
  "tests",
  "recommendations",
] as const;

/** Whether a parsed value is a worker result (summary plus evidence sections). */
export function isResultShape(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;

  return (
    typeof record.summary === "string" &&
    RESULT_SECTIONS.every((section) => Array.isArray(record[section]))
  );
}

function gitPath(path: string) {
  return path.replace(/^"|"$/g, "").replace(/^[ab]\//, "");
}

/**
 * Counts each file's added and removed lines in one pass over a unified diff,
 * without building per-line objects. Lists the first `maxFiles` files; the
 * totals cover them all.
 */
export function scanDiff(content: string, maxFiles = Infinity) {
  const files: DiffFileStat[] = [];
  let current: DiffFileStat | undefined,
    totalFiles = 0,
    additions = 0,
    deletions = 0,
    // Lines left in the current hunk, from its header. Inside a hunk, "--- x"
    // is a removed line, not the next file's header.
    oldLeft = 0,
    newLeft = 0;

  const start = (path: string) => {
    totalFiles++;
    current = { path, status: "modified", additions: 0, deletions: 0 };
    if (files.length < maxFiles) files.push(current);
  };

  let index = 0;

  while (index < content.length) {
    let end = content.indexOf("\n", index);
    if (end < 0) end = content.length;
    const line = content.slice(index, end).replace(/\r$/, "");
    index = end + 1;

    // Hunk lines all start with " ", "+", "-" or "\"; anything else (such as the
    // next "diff --git") means the header's counts were wrong, so the hunk ends.
    if ((oldLeft > 0 || newLeft > 0) && !/^[ +\-\\]/.test(line)) {
      oldLeft = 0;
      newLeft = 0;
    }

    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith("\\")) continue;

      if (line.startsWith("+")) {
        current!.additions++;
        additions++;
        newLeft--;
      } else if (line.startsWith("-")) {
        current!.deletions++;
        deletions++;
        oldLeft--;
      } else {
        oldLeft--;
        newLeft--;
      }

      continue;
    }

    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);

    if (hunk && current) {
      oldLeft = Number(hunk[1] ?? 1);
      newLeft = Number(hunk[2] ?? 1);
    } else if (line.startsWith("diff --git ")) {
      const paths = / b\/(.*)$/.exec(line);
      start(paths ? paths[1] : line.slice(11));
    } else if (line.startsWith("--- ")) {
      // A plain unified diff has no "diff --git" line before its headers.
      if (!current || current.additions || current.deletions)
        start(gitPath(line.slice(4)));
      if (line === "--- /dev/null") current!.status = "added";
      else current!.from = gitPath(line.slice(4));
    } else if (line.startsWith("+++ ") && current) {
      if (line === "+++ /dev/null") current.status = "deleted";
      else current.path = gitPath(line.slice(4));
    } else if (line.startsWith("rename from ") && current)
      current.from = line.slice(12);
    else if (line.startsWith("rename to ") && current) {
      current.path = line.slice(10);
      current.status = "renamed";
    } else if (line.startsWith("new file mode") && current)
      current.status = "added";
    else if (line.startsWith("deleted file mode") && current)
      current.status = "deleted";
  }

  for (const file of files)
    if (file.status === "modified" && file.from && file.from !== file.path)
      file.status = "renamed";
    else if (file.from === file.path) delete file.from;

  return { files, total_files: totalFiles, additions, deletions };
}

export const SNIPPET_LINES = 8;
export const SNIPPET_FILES = 5;
export const SNIPPET_ROWS = 5;
const SNIPPET_MARKDOWN_CHARS = 1200;
/** Minified JSON is reformatted for the snippet only up to this size. */
const PRETTY_JSON_CHARS = 2_000_000;
/** SVG is shown as itself; larger ones would make the summary heavy. */
const SVG_SNIPPET_CHARS = 64_000;

/**
 * Everything a file card shows, read from the start of the content (diffs are
 * the exception: their totals need one counting pass). Raster thumbnails need
 * an image library, so the service adds them; this returns none for them.
 */
export function summarizeArtifact(artifact: Artifact): ArtifactSummary {
  const { content, ...info } = artifact;
  const format = artifactFormat(artifact);
  let snippet: ArtifactSnippet,
    report = false;

  switch (format) {
    case "diff": {
      const diff = scanDiff(content, SNIPPET_FILES);

      snippet = diff.total_files
        ? { kind: "diff", ...diff }
        : {
            kind: "lines",
            text: headLines(content, SNIPPET_LINES),
            language: "diff",
          };

      break;
    }

    case "json": {
      // Parsed once here (the summary is cached) to detect reports and to
      // format minified JSON, so the panel never parses it for a card.
      const value =
        content.length <= PRETTY_JSON_CHARS ? parseJson(content) : undefined;

      report = isResultShape(value);

      const source =
        value === undefined || content.slice(0, 2000).includes("\n")
          ? content
          : JSON.stringify(value, null, 2);

      snippet = {
        kind: "lines",
        text: headLines(source, SNIPPET_LINES),
        language: "json",
      };

      break;
    }

    case "markdown":
      snippet = {
        kind: "markdown",
        text: content.slice(0, SNIPPET_MARKDOWN_CHARS),
      };

      break;
    case "csv":
      snippet = {
        kind: "table",
        rows: parseDelimited(content, delimiterOf(artifact), SNIPPET_ROWS),
        total_rows: countDelimitedRows(content),
      };

      break;
    case "image":
      snippet =
        baseMime(artifact) === "image/svg+xml" &&
        content.length <= SVG_SNIPPET_CHARS
          ? {
              kind: "image",
              src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`,
            }
          : { kind: "none" };

      break;

    default: {
      const language = artifactLanguage(artifact);

      // No undefined keys: a cached summary (JSON) must equal a fresh one.
      snippet = {
        kind: "lines",
        text: headLines(content, SNIPPET_LINES),
        ...(language ? { language } : {}),
      };
    }
  }

  return {
    ...info,
    file_name: artifactFileName(artifact),
    format,
    size: artifactBytes(artifact),
    snippet,
    ...(report ? { report } : {}),
  };
}
