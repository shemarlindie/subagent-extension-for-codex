import { expect, test } from "vitest";

import { changedFileTree, type TreeNode } from "./changed-file-tree-nodes";
import type { ListedChange } from "./types";

const files = (paths: string[]): ListedChange[] =>
  paths.map((path) => ({
    path,
    status: "modified",
    additions: 1,
    deletions: 0,
    source: "tool",
    incomplete: false,
    signature: path,
  }));

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
    files([
      "README.md",
      "src/panel/features/changes/a.ts",
      "src/panel/features/changes/b.ts",
      "src/panel/shared/c.ts",
      "docs/guide.md",
    ]),
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
