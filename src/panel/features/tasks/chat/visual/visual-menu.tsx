import { Menu } from "@base-ui/react/menu";
import { useEffect, useRef, useState } from "react";

import type { ChatVisual } from "../../../../../shared/tasks/conversation/chat.js";
import { useController } from "../../../../app/state/controller-context";
import { buttonClass } from "../../../../shared/components/button/button";
import { Icon } from "../../../../shared/components/icons/icons";
import { TooltipWrapper } from "../../../../shared/components/tooltip";
import { copyText } from "../../../../shared/utils/copy-text";
import { errorMessage } from "../../../../shared/utils/error-message";
import { writeClipboardText } from "../../../../shared/utils/write-clipboard";
import { visualThemeCss } from "./visual-document";
import { visualPageFile } from "./visual-export";

type VisualMenuProps = { item: ChatVisual };

/** A note about one version of the visual. */
type VersionNote = { code: string; text: string };

/**
 * Copies or saves a visual. Saved files carry the panel's theme at the click.
 * A declined save shows nothing, since a cancelled dialog looks the same.
 */
export function VisualMenu({ item }: VisualMenuProps) {
  const controller = useController();
  const [note, setNote] = useState<VersionNote>();
  // A new version must not inherit the previous one's checkmark or note.
  const [copiedCode, setCopiedCode] = useState<string>();
  const copied = copiedCode === item.code;
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  async function copy() {
    const { code } = item;
    setNote(undefined);
    if (!(await copyText(code, writeClipboardText, controller.report))) return;

    setCopiedCode(code);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopiedCode(undefined), 1500);
  }

  async function save(file: () => File) {
    const { code } = item;
    setNote(undefined);

    try {
      const result = await controller.transport.saveFile(file());

      if (result === "unsupported") {
        setNote({ code, text: "This host can't save files." });
      }
    } catch (error) {
      setNote({ code, text: errorMessage(error) });
    }
  }

  const theme = () => visualThemeCss(document.documentElement);
  const label = copied ? "Copied" : "Download or copy";

  return (
    <>
      <Menu.Root>
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
                onClick={() => void save(() => visualPageFile(item, theme()))}
              >
                Download HTML page
              </Menu.Item>
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
