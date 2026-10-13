import { Menu } from "@base-ui/react/menu";

import { buttonClass } from "../../shared/components/button/button";
import { Icon } from "../../shared/components/icons/icons";
import { TooltipWrapper } from "../../shared/components/tooltip";

type FilePreviewOptionsProps = {
  wrapLines: boolean;
  onWrapLinesChange: (wrapLines: boolean) => void;
};

export function FilePreviewOptions({
  wrapLines,
  onWrapLinesChange,
}: FilePreviewOptionsProps) {
  return (
    <Menu.Root>
      <TooltipWrapper label="File preview options">
        <Menu.Trigger
          className={buttonClass("ghost", {
            className: "toolbar-icon-button file-preview-options",
          })}
          aria-label="File preview options"
        >
          <Icon name="more-vertical" size={14} />
        </Menu.Trigger>
      </TooltipWrapper>
      <Menu.Portal>
        <Menu.Positioner className="menu-positioner" align="end" sideOffset={4}>
          <Menu.Popup className="menu-popup">
            <Menu.CheckboxItem
              className="menu-item"
              checked={wrapLines}
              onCheckedChange={onWrapLinesChange}
            >
              Wrap lines
              <Menu.CheckboxItemIndicator
                className="file-preview-option-check"
                keepMounted
              >
                <Icon name="check" size={14} />
              </Menu.CheckboxItemIndicator>
            </Menu.CheckboxItem>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
