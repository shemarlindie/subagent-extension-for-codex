import { useMemo } from "react";

import {
  ChangedFileTreeItem,
  type ChangedFileTreeItemProps,
} from "./changed-file-tree-item";
import { changedFileTree } from "./changed-file-tree-nodes";
import type { ChangedFileEntry } from "./changed-files";

type ChangedFileTreeProps = Omit<ChangedFileTreeItemProps, "node"> & {
  entries: ChangedFileEntry[];
};

/** Only mounted while the navigator is open. Closed folders unmount their rows. */
export function ChangedFileTree({ entries, ...props }: ChangedFileTreeProps) {
  const nodes = useMemo(() => changedFileTree(entries), [entries]);

  return (
    <nav className="changed-file-tree" aria-label="Changed files by folder">
      <ul className="changed-file-tree-items">
        {nodes.map((node) => (
          <ChangedFileTreeItem
            key={
              node.kind === "directory" ? `${node.path}/` : node.entry.file.path
            }
            node={node}
            {...props}
          />
        ))}
      </ul>
    </nav>
  );
}
