import { Collapsible } from "@base-ui/react/collapsible";

import { Chevron } from "../../shared/components/chevron";
import { Icon } from "../../shared/components/icons/icons";
import { TooltipWrapper } from "../../shared/components/tooltip";
import type { TreeNode } from "./changed-file-tree-nodes";
import { isViewed } from "./use-viewed-files";

export type ChangedFileTreeItemProps = {
  node: TreeNode;
  viewed: ReadonlyMap<string, string>;
  activePath: string;
  onSelect: (path: string) => void;
};

const STATUS_LETTERS = { added: "A", modified: "M", deleted: "D" };

export function ChangedFileTreeItem({
  node,
  viewed,
  activePath,
  onSelect,
}: ChangedFileTreeItemProps) {
  if (node.kind === "directory") {
    return (
      <Collapsible.Root defaultOpen render={<li />}>
        <TooltipWrapper label={node.path}>
          <Collapsible.Trigger className="changed-file-tree-directory">
            <Chevron size={10} />
            <span className="changed-file-tree-name">{node.name}/</span>
          </Collapsible.Trigger>
        </TooltipWrapper>
        <Collapsible.Panel>
          <ul className="changed-file-tree-items">
            {node.children.map((child) => (
              <ChangedFileTreeItem
                key={
                  child.kind === "directory"
                    ? `${child.path}/`
                    : child.entry.file.path
                }
                node={child}
                viewed={viewed}
                activePath={activePath}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </Collapsible.Panel>
      </Collapsible.Root>
    );
  }

  const { path, status } = node.entry.file,
    read = isViewed(viewed, node.entry);

  return (
    <li>
      <TooltipWrapper label={path}>
        <button
          type="button"
          className="changed-file-tree-file"
          aria-label={path}
          aria-description={`${status}${read ? ", viewed" : ""}`}
          aria-current={path === activePath ? "location" : undefined}
          data-viewed={read || undefined}
          onClick={() => onSelect(path)}
        >
          <span
            className="changed-file-tree-status"
            data-status={status}
            aria-hidden
          >
            {STATUS_LETTERS[status]}
          </span>
          <span className="changed-file-tree-name">{node.name}</span>
          {read && (
            <span className="changed-file-tree-viewed" aria-hidden>
              <Icon name="check" size={12} />
            </span>
          )}
        </button>
      </TooltipWrapper>
    </li>
  );
}
