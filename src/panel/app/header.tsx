import { Menu } from "@base-ui/react/menu";
import { useRef } from "react";

import { Button, buttonClass } from "../shared/components/button/button";
import { Icon } from "../shared/components/icons/icons";
import { MotionContent } from "../shared/components/motion/motion";
import { canAnimate, MOTION } from "../shared/components/motion/motion-utils";
import { TooltipWrapper } from "../shared/components/tooltip";
import { useController, useSnapshot } from "./state/controller-context";

export function Header() {
  const controller = useController(),
    state = useSnapshot(),
    blocked = !state.connected || state.busy,
    // Thread mode scopes the panel to the conversation, so global actions go.
    threadMode = !!state.conversation,
    expandLabel =
      state.host.displayMode === "fullscreen" ? "Collapse" : "Expand";

  // One full turn acknowledges the click, however quickly the refresh returns.
  const glyph = useRef<HTMLSpanElement>(null);

  const refresh = () => {
      if (canAnimate(glyph.current))
        glyph.current!.animate(
          [{ transform: "rotate(0)" }, { transform: "rotate(360deg)" }],
          { duration: 500, easing: MOTION.easing },
        );
      controller.run(() => controller.refresh());
    },
    expand = () =>
      controller.run(async () => {
        await controller.transport.expand?.();
      }),
    settings = () => controller.run(() => controller.settings());

  const status = (
    <span id="connection" className="connection muted" role="status">
      <MotionContent changeKey={state.connection}>
        {state.connection}
      </MotionContent>
    </span>
  );

  return (
    <header>
      <div className={`brand${threadMode ? "" : " brand-global"}`}>
        {threadMode && <Icon name="worker" size={20} className="mark" />}
        <div className="brand-text">
          {threadMode && <strong>Delegated Work</strong>}
          {status}
        </div>
      </div>
      <span className="grow" />
      <div className="toolbar">
        {/* Narrow panels swap these for the menu below; both stay mounted so CSS decides. */}
        <div className="toolbar toolbar-inline">
          <TooltipWrapper label="Refresh tasks">
            <Button
              id="refresh"
              variant="ghost"
              className="toolbar-icon-button"
              aria-label="Refresh tasks"
              onClick={refresh}
            >
              <span ref={glyph} className="refresh-glyph" aria-hidden="true">
                <Icon name="refresh" size={14} />
              </span>
            </Button>
          </TooltipWrapper>
          {state.host.canExpand && (
            <TooltipWrapper label={expandLabel}>
              <Button
                id="expand"
                variant="ghost"
                className="toolbar-icon-button"
                aria-label={expandLabel}
                onClick={expand}
              >
                <Icon
                  name={
                    state.host.displayMode === "fullscreen"
                      ? "collapse"
                      : "expand"
                  }
                  size={14}
                />
              </Button>
            </TooltipWrapper>
          )}
          {!threadMode && (
            <TooltipWrapper label="Settings">
              <Button
                id="settings"
                variant="ghost"
                className="toolbar-icon-button"
                aria-label="Settings"
                disabled={blocked}
                onClick={settings}
              >
                <Icon name="settings" size={14} />
              </Button>
            </TooltipWrapper>
          )}
        </div>
        <Menu.Root>
          <TooltipWrapper label="More actions">
            <Menu.Trigger
              className={buttonClass("ghost", {
                className: "toolbar-menu toolbar-icon-button",
              })}
              aria-label="More actions"
            >
              <Icon name="more-horizontal" size={14} />
            </Menu.Trigger>
          </TooltipWrapper>
          <Menu.Portal>
            <Menu.Positioner
              className="menu-positioner"
              align="end"
              sideOffset={4}
            >
              <Menu.Popup className="menu-popup">
                <Menu.Item className="menu-item" onClick={refresh}>
                  Refresh
                </Menu.Item>
                {!threadMode && (
                  <Menu.Item
                    className="menu-item"
                    disabled={blocked}
                    onClick={settings}
                  >
                    Settings
                  </Menu.Item>
                )}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
        {!threadMode && (
          <Button
            id="delegate"
            variant="primary"
            disabled={blocked}
            onClick={() => controller.run(() => controller.delegate())}
          >
            New Task
          </Button>
        )}
      </div>
    </header>
  );
}
