import { useMemo } from "react";

import {
  ChangedFileTreeItem,
  type ChangedFileTreeItemProps,
} from "./changed-file-tree-item";
import { changedFileTree } from "./changed-file-tree-nodes";
import type { ListedChange } from "./types";

type ChangedFileTreeProps = Omit<ChangedFileTreeItemProps, "node"> & {
  files: ListedChange[];
};

/** Only mounted while the navigator is open. Closed folders unmount their rows. */
export function ChangedFileTree({ files, ...props }: ChangedFileTreeProps) {
  const nodes = useMemo(() => changedFileTree(files), [files]);

  return (
    <nav className="changed-file-tree" aria-label="Changed files by folder">
      <ul className="changed-file-tree-items">
        {nodes.map((node) => (
          <ChangedFileTreeItem
            key={node.kind === "directory" ? `${node.path}/` : node.file.path}
            node={node}
            {...props}
          />
        ))}
      </ul>
    </nav>
  );
}
