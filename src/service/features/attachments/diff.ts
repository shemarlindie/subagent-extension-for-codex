import { lstat, readlink } from "node:fs/promises";
import { join } from "node:path";

import { gitBytes, gitState } from "../workspaces/git.js";
import {
  AttachmentError,
  decodeText,
  lineCount,
  projectPath,
  readProjectFile,
} from "./project-file.js";

const GIT_TIMEOUT_MS = 30_000;
/** Room for the file list Git prints before the patch. */
const LIST_BYTES = 1024 * 1024;

/**
 * Overrides for the content filters the repository's config names. Git runs
 * a clean filter's command when it compares checkout files, so the snapshot
 * compares raw bytes instead.
 */
async function filterOverrides(project: string) {
  let names: Buffer;

  try {
    names = await gitBytes(
      project,
      [
        "config",
        "--name-only",
        "--get-regexp",
        String.raw`^filter\..+\.(clean|process)$`,
      ],
      LIST_BYTES,
      GIT_TIMEOUT_MS,
    );
  } catch (error) {
    // Git exits with 1 when nothing matches.
    if ((error as { code?: unknown }).code === 1) return [];
    throw error;
  }

  const drivers = new Set(
    names
      .toString("utf8")
      .split("\n")
      .map((name) => /^filter\.(.+)\.(?:clean|process)$/.exec(name)?.[1])
      .filter((driver) => driver !== undefined),
  );

  return [...drivers].flatMap((driver) => [
    "-c",
    `filter.${driver}.clean=`,
    "-c",
    `filter.${driver}.process=`,
    "-c",
    `filter.${driver}.required=false`,
  ]);
}

const ESCAPES: Record<string, string> = {
  "\x07": "\\a",
  "\b": "\\b",
  "\t": "\\t",
  "\n": "\\n",
  "\v": "\\v",
  "\f": "\\f",
  "\r": "\\r",
  '"': '\\"',
  "\\": "\\\\",
};

/**
 * A path as a patch header writes it: quoted with C escapes when it holds
 * control characters, a quote or a backslash. With `core.quotePath` off,
 * Git leaves other characters as they are.
 */
function quotedPath(path: string) {
  let quoted = "";
  let special = false;

  for (const c of path) {
    const code = c.charCodeAt(0);

    if (code < 0x20 || code === 0x7f || c === '"' || c === "\\") {
      special = true;
      quoted += ESCAPES[c] ?? `\\${code.toString(8).padStart(3, "0")}`;
    } else {
      quoted += c;
    }
  }

  return special ? `"${quoted}"` : path;
}

/** Git's patch for a new file, which `git diff` leaves out while it's untracked. */
function newFilePatch(path: string, text: string, mode: string) {
  const header = `diff --git ${quotedPath(`a/${path}`)} ${quotedPath(`b/${path}`)}\nnew file mode ${mode}\n`;
  if (!text) return { patch: header, lines: 0 };
  const lines = lineCount(text);
  const ended = text.endsWith("\n");
  const body = ended ? text.slice(0, -1) : text;

  return {
    patch: [
      header,
      `--- /dev/null\n+++ ${quotedPath(`b/${path}`)}\n`,
      `@@ -0,0 +1${lines === 1 ? "" : `,${lines}`} @@\n`,
      `+${body.replaceAll("\n", "\n+")}\n`,
      ended ? "" : "\\ No newline at end of file\n",
    ].join(""),
    lines,
  };
}

/** Git's output, or `tooLarge` once it passes `maxBytes`. */
async function boundedGit(
  project: string,
  args: string[],
  maxBytes: number,
  tooLarge: () => Error,
) {
  try {
    return await gitBytes(project, args, maxBytes, GIT_TIMEOUT_MS);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") throw tooLarge();
    throw error;
  }
}

/**
 * The changes to tracked files: Git's `--numstat -z --patch` output, whose
 * file list ends with an empty record before the patch.
 */
function trackedChanges(output: Buffer) {
  const files: string[] = [];
  let additions = 0;
  let deletions = 0;
  let offset = 0;

  while (offset < output.length) {
    const end = output.indexOf(0, offset);
    if (end === -1) throw new Error("Git's diff file list didn't end");
    const record = output.subarray(offset, end).toString("utf8");
    offset = end + 1;
    if (!record) break;
    // The path may hold tabs too.
    const [added, deleted] = record.split("\t", 2);
    const path = record.slice(`${added}\t${deleted}\t`.length);

    if (added === "-" || deleted === "-") {
      throw new AttachmentError(
        `${path} is a binary file. Pass paths to leave it out.`,
      );
    }

    files.push(path);
    additions += Number(added);
    deletions += Number(deleted);
  }

  return { files, additions, deletions, patch: output.subarray(offset) };
}

/** An untracked file's patch, within `room` bytes. Skips sockets and the like. */
async function untrackedPatch(
  project: string,
  path: string,
  room: number,
  tooLarge: () => Error,
) {
  const info = await lstat(join(project, path));

  if (info.isSymbolicLink()) {
    return newFilePatch(path, await readlink(join(project, path)), "120000");
  }

  if (!info.isFile()) return undefined;
  if (info.size > room) throw tooLarge();
  const { text } = await readProjectFile(project, path, room);

  return newFilePatch(path, text, info.mode & 0o111 ? "100755" : "100644");
}

/**
 * The project's uncommitted changes against `HEAD`, untracked files included,
 * as one patch of at most `limit` bytes. `paths` limits it. Fails when there
 * are no changes.
 */
export async function uncommittedDiff(
  project: string,
  paths: string[] | undefined,
  limit: number,
) {
  if ((await gitState(project)) !== "ready") {
    throw new AttachmentError(
      "Diff attachments need a Git repository with at least one commit.",
    );
  }

  const tooLarge = () =>
    new AttachmentError(
      `The diff is over the ${limit / 1024 / 1024} MB attachment limit. Pass paths to attach part of it.`,
    );

  // Each path must stay in the project once links resolve. Git gets it as
  // given, so a link's own change still shows.
  for (const path of paths ?? []) projectPath(project, path);
  const pathspecs = ["--", ...(paths ?? []).map((path) => `:(literal)${path}`)];

  const tracked = trackedChanges(
    await boundedGit(
      project,
      [
        ...(await filterOverrides(project)),
        // Untracked files' headers quote paths the same way.
        "-c",
        "core.quotePath=false",
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        // Inspect submodule commit pointers without running status in them.
        "--ignore-submodules=dirty",
        "--submodule=short",
        "--numstat",
        "-z",
        "--patch",
        "HEAD",
        ...pathspecs,
      ],
      limit + LIST_BYTES,
      tooLarge,
    ),
  );

  const { files } = tracked;
  const patches = [tracked.patch];
  let size = tracked.patch.length;
  let additions = tracked.additions;
  if (size > limit) throw tooLarge();

  const untracked = await boundedGit(
    project,
    ["ls-files", "--others", "--exclude-standard", "-z", ...pathspecs],
    LIST_BYTES,
    tooLarge,
  );

  for (const path of untracked.toString("utf8").split("\0")) {
    // Nested repositories are listed as folders.
    if (!path || path.endsWith("/")) continue;
    const added = await untrackedPatch(project, path, limit - size, tooLarge);
    if (!added) continue;
    const bytes = Buffer.from(added.patch);
    size += bytes.length;
    if (size > limit) throw tooLarge();
    patches.push(bytes);
    files.push(path);
    additions += added.lines;
  }

  if (!files.length) {
    throw new AttachmentError(
      `There are no uncommitted changes${paths ? " in these paths" : ""}.`,
    );
  }

  return {
    text: decodeText(Buffer.concat(patches), "The diff"),
    files,
    additions,
    deletions: tracked.deletions,
  };
}
