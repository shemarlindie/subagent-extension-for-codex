import type { ChangedFileEntry } from "./changed-files";

/** A directory in the changed-file tree, named by the path segments it joins. */
type TreeDirectory = {
  kind: "directory";
  /** One segment, or several joined with "/" when a directory holds only one directory. */
  name: string;
  path: string;
  children: TreeNode[];
};

type TreeFile = {
  kind: "file";
  name: string;
  entry: ChangedFileEntry;
};

export type TreeNode = TreeDirectory | TreeFile;

type Building = { files: TreeFile[]; directories: Map<string, Building> };

function build(name: string, path: string, building: Building): TreeDirectory {
  let directory: TreeDirectory = {
    kind: "directory",
    name,
    path,
    children: [
      ...[...building.directories].map(([child, inner]) =>
        build(child, path ? `${path}/${child}` : child, inner),
      ),
      ...building.files,
    ],
  };

  // A chain of single-directory folders reads as one row.
  const [only] = directory.children;

  if (path && directory.children.length === 1 && only?.kind === "directory") {
    directory = { ...only, name: `${name}/${only.name}` };
  }

  return directory;
}

/**
 * The changed files as a tree: directories first, then files, each in the
 * list's order. The root's children are returned.
 */
export function changedFileTree(entries: ChangedFileEntry[]): TreeNode[] {
  const root: Building = { files: [], directories: new Map() };

  for (const entry of entries) {
    const segments = entry.file.path.split("/");
    const name = segments.pop() ?? entry.file.path;
    let directory = root;

    for (const segment of segments) {
      let next = directory.directories.get(segment);

      if (!next) {
        next = { files: [], directories: new Map() };
        directory.directories.set(segment, next);
      }

      directory = next;
    }

    directory.files.push({ kind: "file", name, entry });
  }

  return build("", "", root).children;
}
