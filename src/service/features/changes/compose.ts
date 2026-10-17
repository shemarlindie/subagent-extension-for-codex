import { formatPatch, type StructuredPatchHunk as Hunk } from "diff";

import {
  applyHunks,
  createDocument,
  type DiffItem,
  diffItems,
} from "./compose-model.js";

const context = 3;

function emitLines(items: Exclude<DiffItem, { kind: "gap" }>[]) {
  return items.flatMap((item) => {
    if (item.text.endsWith("\n")) {
      return [item.kind + item.text.slice(0, -1)];
    }

    return [item.kind + item.text, "\\ No newline at end of file"];
  });
}

type KnownItem = Exclude<DiffItem, { kind: "gap" }>;

type PendingHunk = { oldStart: number; newStart: number; items: KnownItem[] };

/**
 * Compose sequential edits without reading the file or retaining whole text.
 * Identical text moved across an unknown run can leave a valid nonminimal diff,
 * including when the actual file returned to its original bytes.
 */
export function composeHunks(
  stored: Hunk[],
  edit: Hunk[],
  created = false,
): Hunk[] {
  const document = createDocument(created);
  applyHunks(document, stored);
  applyHunks(document, edit);
  const items = diffItems(document);
  const hunks: Hunk[] = [];
  let oldLine = 1;
  let newLine = 1;
  let current: PendingHunk | undefined;
  let trailing = 0;

  const close = () => {
    if (!current) return;

    if (trailing > context) {
      current.items.splice(current.items.length - (trailing - context));
    }

    hunks.push({
      oldStart: current.oldStart,
      newStart: current.newStart,
      oldLines: current.items.filter((item) => item.kind !== "+").length,
      newLines: current.items.filter((item) => item.kind !== "-").length,
      lines: emitLines(current.items),
    });

    current = undefined;
  };

  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;

    if (item.kind === "gap") {
      close();
      oldLine += item.count;
      newLine += item.count;
      continue;
    }

    if (item.kind === " ") {
      if (current) {
        current.items.push(item);
        trailing++;
        if (trailing > 2 * context) close();
      }

      oldLine++;
      newLine++;
      continue;
    }

    if (!current) {
      const leading: KnownItem[] = [];

      for (
        let before = index - 1;
        before >= 0 && leading.length < context;
        before--
      ) {
        const candidate = items[before]!;
        if (candidate.kind !== " ") break;
        leading.unshift(candidate);
      }

      current = {
        oldStart: oldLine - leading.length,
        newStart: newLine - leading.length,
        items: leading,
      };
    }

    trailing = 0;
    current.items.push(item);
    if (item.kind === "-") oldLine++;
    else newLine++;
  }

  close();

  return hunks;
}

/** Render a stored net diff with Git file headers and standard zero-line ranges. */
export function formatFileDiff(
  path: string,
  hunks: Hunk[],
  created = false,
  deleted = false,
): string {
  return formatPatch({
    isGit: true,
    isCreate: created,
    isDelete: deleted,
    oldFileName: created ? "/dev/null" : `a/${path}`,
    newFileName: deleted ? "/dev/null" : `b/${path}`,
    oldHeader: undefined,
    newHeader: undefined,
    hunks,
  });
}
