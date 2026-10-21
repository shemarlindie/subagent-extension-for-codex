import { Popover } from "@base-ui/react/popover";
import { useRef, useState } from "react";

import { buttonClass } from "../../shared/components/button/button";
import { Chevron } from "../../shared/components/chevron";
import { Icon } from "../../shared/components/icons/icons";
import { scrollContainer } from "../../shared/utils/scroll-container";
import { ChangedFileTree } from "./changed-file-tree";
import type { ChangedFileEntry } from "./changed-files";

type ChangedFileNavigatorProps = {
  entries: ChangedFileEntry[];
  viewed: ReadonlyMap<string, string>;
  activePath: string;
  onSelect: (path: string) => void;
};

/** A file navigator that stays available while the reader scrolls the diffs. */
export function ChangedFileNavigator({
  entries,
  viewed,
  activePath,
  onSelect,
}: ChangedFileNavigatorProps) {
  const [open, setOpen] = useState(false),
    [boundary, setBoundary] = useState<HTMLElement>(),
    popupRef = useRef<HTMLDivElement>(null),
    triggerRef = useRef<HTMLButtonElement>(null);

  function changeOpen(next: boolean) {
    if (next && triggerRef.current) {
      setBoundary(scrollContainer(triggerRef.current));
    }

    setOpen(next);
  }

  return (
    <div className="changed-file-navigator">
      <Popover.Root open={open} onOpenChange={changeOpen}>
        <Popover.Trigger
          ref={triggerRef}
          className={buttonClass("default", {
            className: "changed-file-navigator-trigger",
          })}
          aria-label="Files"
        >
          <span>Files · {entries.length}</span>
          <Chevron size={10} />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            className="changed-file-navigator-positioner"
            side="top"
            sideOffset={8}
            align="start"
            collisionPadding={12}
            collisionBoundary={boundary}
            collisionAvoidance={{ side: "shift", align: "shift" }}
          >
            <Popover.Popup
              className="changed-file-navigator-popup"
              ref={popupRef}
              initialFocus={() =>
                popupRef.current?.querySelector<HTMLElement>(
                  '[aria-current="location"]',
                ) ?? true
              }
            >
              <div className="changed-file-navigator-heading">
                <Popover.Title className="changed-file-navigator-title">
                  Changed files
                </Popover.Title>
                <Popover.Close
                  className={buttonClass("ghost", {
                    className:
                      "toolbar-icon-button changed-file-navigator-close",
                  })}
                  aria-label="Collapse file navigator"
                >
                  <Icon name="close" size={8} strokeWidth={3} />
                </Popover.Close>
              </div>
              {open && (
                <ChangedFileTree
                  entries={entries}
                  viewed={viewed}
                  activePath={activePath}
                  onSelect={onSelect}
                />
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
