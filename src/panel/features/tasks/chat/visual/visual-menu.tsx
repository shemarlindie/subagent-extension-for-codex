import { Menu } from "@base-ui/react/menu";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ChatVisual } from "../../../../../core/shared/tasks/conversation/chat.js";
import { useController } from "../../../../app/state/controller-context";
import { buttonClass } from "../../../../shared/components/button/button";
import { Icon } from "../../../../shared/components/icons/icons";
import { TooltipWrapper } from "../../../../shared/components/tooltip";
import { copyText } from "../../../../shared/utils/copy-text";
import { errorMessage } from "../../../../shared/utils/error-message";
import { writeClipboardText } from "../../../../shared/utils/write-clipboard";
import { visualPageFile, visualPngFile } from "./visual-export";
import { prepareVisualImage } from "./visual-image";

type VisualMenuProps = { item: ChatVisual };

/** A note about one version of the visual. */
type VersionNote = { code: string; text: string };

/**
 * Copies or saves a visual. Saved files carry the panel's theme at the click.
 * A declined save shows nothing, since a cancelled dialog looks the same.
 */
export function VisualMenu({ item }: VisualMenuProps) {
  const controller = useController();
  const [open, setOpen] = useState(false);
  // The version the menu showed last, so its items stay while it closes.
  const [shownCode, setShownCode] = useState<string>();
  const [note, setNote] = useState<VersionNote>();
  // A new version must not inherit the previous one's checkmark or note.
  const [copiedCode, setCopiedCode] = useState<string>();
  const copied = copiedCode === item.code;
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Only the latest action shows its outcome, whichever finishes last.
  const latestAction = useRef(0);

  useEffect(
    () => () => {
      latestAction.current++;
      clearTimeout(resetTimer.current);
    },
    [],
  );

  /** Starts an action and returns whether it's still the latest. */
  function startAction() {
    const action = ++latestAction.current;
    setNote(undefined);

    return () => action === latestAction.current;
  }

  async function copy() {
    const { code } = item;
    const latest = startAction();

    const copied = await copyText(code, writeClipboardText, (error) => {
      if (latest()) controller.report(error);
    });

    if (!copied || !latest()) return;

    setCopiedCode(code);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopiedCode(undefined), 1500);
  }

  /** Saves the file, built at the click in the panel's theme then. */
  async function save(file: (root: Element) => File | Promise<File>) {
    const { code } = item;
    const latest = startAction();
    let text: string | undefined;

    try {
      const result = await controller.transport.saveFile(
        await file(document.documentElement),
      );

      if (result === "unsupported") text = "This host can't save files.";
    } catch (error) {
      text = errorMessage(error);
    }

    if (text && latest()) setNote({ code, text });
  }

  // Prepared when the menu first shows a version, so the PNG item appears only
  // when the file can be made.
  const menuCode = open ? item.code : shownCode;

  const image = useMemo(
    () => (menuCode === undefined ? undefined : prepareVisualImage(menuCode)),
    [menuCode],
  );

  function toggle(next: boolean) {
    setOpen(next);
    if (!next) setShownCode(item.code);
  }

  const label = copied ? "Copied" : "Download or copy";

  return (
    <>
      <Menu.Root open={open} onOpenChange={toggle}>
        <TooltipWrapper label={label}>
          <Menu.Trigger
            className={buttonClass("default", { className: "visual-menu" })}
            aria-label={label}
          >
            <Icon name={copied ? "check" : "download"} size={14} />
          </Menu.Trigger>
        </TooltipWrapper>
        <Menu.Portal>
          <Menu.Positioner
            className="menu-positioner"
            align="end"
            sideOffset={4}
          >
            <Menu.Popup className="menu-popup">
              <Menu.Item className="menu-item" onClick={() => void copy()}>
                Copy code
              </Menu.Item>
              <Menu.Separator className="menu-separator" />
              <Menu.Item
                className="menu-item"
                onClick={() => void save((root) => visualPageFile(item, root))}
              >
                Download HTML page
              </Menu.Item>
              {image && (
                <Menu.Item
                  className="menu-item"
                  onClick={() =>
                    void save((root) =>
                      visualPngFile(item, image.svg, image.size, root),
                    )
                  }
                >
                  Download PNG image
                </Menu.Item>
              )}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {note?.code === item.code && (
        <p className="visual-note form-error" role="alert">
          {note.text}
        </p>
      )}
    </>
  );
}
