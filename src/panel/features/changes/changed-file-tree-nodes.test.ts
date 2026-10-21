import { expect, test } from "vitest";

import { changedFileTree, type TreeNode } from "./changed-file-tree-nodes";
import { changedFileEntries } from "./changed-files";
import type { Changes } from "./types";

function changes(paths: string[]): Changes {
  return {
    scope: "task",
    diff: "",
    additions: paths.length,
    deletions: 0,
    files: paths.map((path) => ({
      path,
      status: "modified",
      additions: 1,
      deletions: 0,
      source: "tool",
      incomplete: false,
    })),
  };
}

/** The tree as indented names, which reads more plainly than nested objects. */
function outline(nodes: TreeNode[], depth = 0): string[] {
  return nodes.flatMap((node) =>
    node.kind === "file"
      ? [`${"  ".repeat(depth)}${node.name}`]
      : [
          `${"  ".repeat(depth)}${node.name}/`,
          ...outline(node.children, depth + 1),
        ],
  );
}

test("directories come first, and single-directory chains join into one row", () => {
  const tree = changedFileTree(
    changedFileEntries(
      changes([
        "README.md",
        "src/panel/features/changes/a.ts",
        "src/panel/features/changes/b.ts",
        "src/panel/shared/c.ts",
        "docs/guide.md",
      ]),
    ),
  );

  expect(outline(tree)).toEqual([
    "src/panel/",
    "  features/changes/",
    "    a.ts",
    "    b.ts",
    "  shared/",
    "    c.ts",
    "docs/",
    "  guide.md",
    "README.md",
  ]);

  const [src] = tree;
  expect(src?.kind === "directory" && src.path).toBe("src/panel");
});
