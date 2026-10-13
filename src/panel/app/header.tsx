import { Menu } from "@base-ui/react/menu";
import { useRef } from "react";

import { ProjectScope } from "../features/projects/project-scope";
import { Button, buttonClass } from "../shared/components/button/button";
import { Icon } from "../shared/components/icons/icons";
import { MotionContent } from "../shared/components/motion/motion";
import { canAnimate, MOTION } from "../shared/components/motion/motion-utils";
import { TooltipWrapper } from "../shared/components/tooltip";
import { useController, useSnapshot } from "./state/controller-context";
import { projectChoices } from "./state/selectors";

export function Header() {
  const controller = useController(),
    state = useSnapshot(),
    blocked = !state.connected || state.busy,
    // Thread mode scopes the panel to the conversation; Settings stays available.
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

  const projectName =
    projectChoices(state).find(
      (project) => project.repository === state.repository,
    )?.name ??
    state.repository?.split("/").at(-1) ??
    "All projects";

  const status = (
    <span id="connection" className="connection muted" role="status">
      <MotionContent changeKey={state.connection}>
        {state.connection}
      </MotionContent>
    </span>
  );

  return (
    <header data-mode={threadMode ? "thread" : "global"}>
      <div className="brand">
        {threadMode && (
          <Icon name="quiet-constellation" size={20} className="mark" />
        )}
        <div className="brand-text">
          {threadMode && (
            <div className="brand-title">
              <span>Delegated Work</span>
              <span className="muted" aria-hidden="true">
                |
              </span>
              <strong id="project-name" title={state.repository}>
                {projectName}
              </strong>
            </div>
          )}
          {status}
          {!threadMode && <ProjectScope />}
        </div>
      </div>
      <div className="toolbar">
        {/* Narrow panels swap these for the menu below; both stay mounted so CSS decides. */}
        <div className="toolbar toolbar-inline">
          {state.projectCandidate && (
            <TooltipWrapper label="Add chat project">
              <Button
                id="add-chat-project"
                variant="ghost"
                className="toolbar-icon-button"
                aria-label="Add chat project"
                title={state.projectCandidate}
                disabled={!state.connected || !state.scopeKnown || state.busy}
                onClick={() => controller.addProject()}
              >
                <Icon name="plus" size={14} />
              </Button>
            </TooltipWrapper>
          )}
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
        </div>
        <Menu.Root>
          <TooltipWrapper label="Panel actions">
            <Menu.Trigger
              className={buttonClass("ghost", {
                className: "toolbar-menu toolbar-icon-button",
              })}
              aria-label="Panel actions"
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
                {state.projectCandidate && (
                  <Menu.Item
                    className="menu-item"
                    disabled={
                      !state.connected || !state.scopeKnown || state.busy
                    }
                    onClick={() => controller.addProject()}
                  >
                    Add chat project
                  </Menu.Item>
                )}
                <Menu.Item className="menu-item" onClick={refresh}>
                  Refresh
                </Menu.Item>
                {state.host.canExpand && (
                  <Menu.Item className="menu-item" onClick={expand}>
                    {expandLabel}
                  </Menu.Item>
                )}
                <Menu.Item
                  className="menu-item"
                  disabled={blocked}
                  onClick={settings}
                >
                  Settings
                </Menu.Item>
                {!threadMode && (
                  <Menu.Item
                    className="menu-item"
                    disabled={blocked}
                    onClick={() => controller.run(() => controller.delegate())}
                  >
                    New Task
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
