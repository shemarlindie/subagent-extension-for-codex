import { Menu } from "@base-ui/react/menu";
import { useRef } from "react";

import { Button, buttonClass } from "./button";
import { useController, useSnapshot } from "./controller-context";
import { Icon } from "./icons";
import { MotionContent } from "./motion";
import { canAnimate, MOTION } from "./motion-utils";
import { TooltipWrapper } from "./tooltip";

export function Header() {
  const controller = useController(),
    state = useSnapshot(),
    consoleMode = state.mode === "console",
    blocked = !state.connected || state.busy,
    // A thread offers its own chat project in the context bar instead.
    canAddProject = !state.conversation,
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
    addProject = () => controller.addProject(),
    settings = () => controller.run(() => controller.settings());

  return (
    <header>
      <div className="brand">
        <span className="mark" aria-hidden="true">
          ⌘
        </span>
        {consoleMode ? (
          <h1>
            Codex subagent extension <span>Delegated work, in one place</span>
          </h1>
        ) : (
          <strong>Delegated work</strong>
        )}
      </div>
      <span className="grow" />
      <div className="toolbar">
        <span id="connection" className="connection muted" role="status">
          <MotionContent changeKey={state.connection}>
            {state.connection}
          </MotionContent>
        </span>
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
          {canAddProject && (
            <Button
              id="add-project"
              variant="ghost"
              className="toolbar-project-button"
              disabled={blocked}
              onClick={addProject}
            >
              <Icon name="plus" size={11} />
              Project
            </Button>
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
        {/* The console header has room for every button, so only the panel gets the menu. */}
        {!consoleMode && (
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
                  {state.host.canExpand && (
                    <Menu.Item className="menu-item" onClick={expand}>
                      {expandLabel}
                    </Menu.Item>
                  )}
                  {canAddProject && (
                    <Menu.Item
                      className="menu-item"
                      disabled={blocked}
                      onClick={addProject}
                    >
                      Add project
                    </Menu.Item>
                  )}
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
        )}
        {!threadMode && (
          <Button
            id="delegate"
            variant="primary"
            disabled={blocked}
            onClick={() => controller.run(() => controller.delegate())}
          >
            {consoleMode ? "＋ Delegate" : "New task"}
          </Button>
        )}
      </div>
    </header>
  );
}
