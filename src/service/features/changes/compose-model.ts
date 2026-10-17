import { diffArrays, type StructuredPatchHunk as Hunk } from "diff";

type Gap = { kind: "gap"; start: number; count: number };

type KnownLine = { kind: "keep"; base: number; text: string };

type AddedLine = { kind: "add"; text: string };

type Node = Gap | KnownLine | AddedLine;

export type DiffItem =
  { kind: "gap"; count: number } | { kind: " " | "+" | "-"; text: string };

export type Document = { nodes: Node[]; removed: Map<number, string> };

const noNewline = "\\ No newline at end of file";

export function createDocument(created: boolean): Document {
  return {
    nodes: created ? [] : [{ kind: "gap", start: 1, count: Infinity }],
    removed: new Map(),
  };
}

/** Split an unknown run so a node begins at the zero-based current line. */
function locate(doc: Document, position: number) {
  let line = 0;

  for (let index = 0; index < doc.nodes.length; index++) {
    const node = doc.nodes[index]!;
    const size = node.kind === "gap" ? node.count : 1;

    if (position < line + size) {
      if (node.kind === "gap" && position > line) {
        const head = position - line;

        doc.nodes.splice(
          index,
          1,
          { kind: "gap", start: node.start, count: head },
          { kind: "gap", start: node.start + head, count: node.count - head },
        );

        return index + 1;
      }

      return index;
    }

    line += size;
  }

  if (position > line) throw new Error("Hunk starts past the known file end.");

  return doc.nodes.length;
}

function endAt(doc: Document, index: number) {
  if (doc.nodes.slice(index + 1).some((node) => node.kind !== "gap")) {
    throw new Error("A no-newline marker contradicts known text after it.");
  }

  doc.nodes.splice(index + 1);
}

/** Reveal a base line from context or a removal. Tokens include their newline. */
function lineAt(doc: Document, index: number, text: string) {
  const node = doc.nodes[index];
  if (!node) throw new Error("Hunk runs past the known file end.");
  if (node.kind !== "gap") return node;
  const line: KnownLine = { kind: "keep", base: node.start, text };
  const remaining = node.count - 1;

  const rest: Gap[] =
    remaining > 0
      ? [{ kind: "gap", start: node.start + 1, count: remaining }]
      : [];

  doc.nodes.splice(index, 1, line, ...rest);

  return line;
}

type PatchLine = { operation: " " | "+" | "-"; text: string };

function patchLines(hunk: Hunk): PatchLine[] {
  const lines: PatchLine[] = [];

  for (const raw of hunk.lines) {
    if (raw === noNewline) {
      const previous = lines.at(-1);

      if (!previous || !previous.text.endsWith("\n")) {
        throw new Error("Invalid no-newline marker.");
      }

      previous.text = previous.text.slice(0, -1);
      continue;
    }

    const operation = raw[0];

    if (operation !== " " && operation !== "+" && operation !== "-") {
      throw new Error("Invalid hunk line operation.");
    }

    lines.push({ operation, text: raw.slice(1) + "\n" });
  }

  if (
    lines.filter((line) => line.operation !== "+").length !== hunk.oldLines ||
    lines.filter((line) => line.operation !== "-").length !== hunk.newLines
  ) {
    throw new Error("Hunk line counts do not match its body.");
  }

  return lines;
}

/** Apply hunks in the coordinates of the file immediately before this edit. */
export function applyHunks(doc: Document, hunks: Hunk[]) {
  let delta = 0;
  let previousEnd = 0;

  for (const hunk of hunks) {
    // newStart handles both jsdiff's insertion oldStart and Claude's preceding
    // old line convention. It already includes earlier hunks' line delta.
    const position =
      hunk.oldLines > 0
        ? hunk.oldStart - 1 + delta
        : Math.max(0, hunk.newStart - 1);

    if (!Number.isSafeInteger(position) || position < previousEnd) {
      throw new Error("Hunks overlap or have invalid coordinates.");
    }

    let index = locate(doc, position);
    const lines = patchLines(hunk);

    for (const line of lines) {
      if (line.operation === "+") {
        doc.nodes.splice(index++, 0, { kind: "add", text: line.text });
        continue;
      }

      const node = lineAt(doc, index, line.text);

      if (node.text !== line.text) {
        throw new Error("Hunk context or removal contradicts known text.");
      }

      if (!line.text.endsWith("\n")) endAt(doc, index);

      if (line.operation === " ") {
        index++;
      } else {
        if (node.kind === "keep") doc.removed.set(node.base, node.text);
        doc.nodes.splice(index, 1);
      }
    }

    delta += hunk.newLines - hunk.oldLines;
    previousEnd = position + hunk.newLines;
  }

  const finalLine = doc.nodes.findIndex(
    (node) => node.kind !== "gap" && !node.text.endsWith("\n"),
  );

  if (finalLine >= 0) endAt(doc, finalLine);
}

/** Re-diff each fully known region between unknown base-line runs. */
export function diffItems(doc: Document): DiffItem[] {
  const output: DiffItem[] = [];
  const removed = [...doc.removed.entries()].sort((a, b) => a[0] - b[0]);
  let removedIndex = 0;
  let oldSide: string[] = [];
  let newSide: string[] = [];

  const flush = () => {
    for (const part of diffArrays(oldSide, newSide)) {
      let kind: " " | "+" | "-" = " ";
      if (part.added) kind = "+";
      if (part.removed) kind = "-";
      for (const text of part.value) output.push({ kind, text });
    }

    oldSide = [];
    newSide = [];
  };

  const removedBefore = (base: number) => {
    while (removedIndex < removed.length && removed[removedIndex]![0] < base) {
      oldSide.push(removed[removedIndex++]![1]);
    }
  };

  for (const node of doc.nodes) {
    if (node.kind === "add") {
      newSide.push(node.text);
      continue;
    }

    removedBefore(node.kind === "gap" ? node.start : node.base);

    if (node.kind === "keep") {
      oldSide.push(node.text);
      newSide.push(node.text);
      continue;
    }

    flush();
    output.push({ kind: "gap", count: node.count });
  }

  removedBefore(Infinity);
  flush();

  return output;
}
