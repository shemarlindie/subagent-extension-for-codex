import { Menu } from "@base-ui/react/menu";
import { useRef } from "react";

import { NewTaskButton } from "../features/delegation/new-task/new-task-button";
import { ProjectScope } from "../features/projects/project-scope";
import { Button, buttonClass } from "../shared/components/button/button";
import { Icon } from "../shared/components/icons/icons";
import { Infotip } from "../shared/components/infotip";
import { MotionContent } from "../shared/components/motion/motion-content";
import { TooltipWrapper } from "../shared/components/tooltip";
import { connectionTrouble } from "./state/connection";
import { useController, useSnapshot } from "./state/controller-context";
import { projectChoices } from "./state/selectors";

export function Header() {
  const controller = useController(),
    state = useSnapshot(),
    blocked = !state.connected || state.busy,
    // Thread mode scopes the panel to the conversation; Settings stays available.
    threadMode = !!state.conversation;

  const newTaskFocus = useRef(false);

  const openNewTask = () => {
    newTaskFocus.current = true;
    controller.newTasks.open();
  };

  const menuFinalFocus = () => {
    if (!newTaskFocus.current) return true;
    newTaskFocus.current = false;

    // Closing the menu must not take focus back from the arriving composer.
    return document.getElementById("new-task-message") ?? true;
  };

  const settings = () => controller.run(() => controller.settings());

  const projectName =
    projectChoices(state).find(
      (project) => project.repository === state.repository,
    )?.name ??
    state.repository?.split("/").at(-1) ??
    "All projects";

  // Only connection problems are visible. The task list explains a missing connection.
  const trouble = connectionTrouble(state.connection);

  const status = (
    <>
      <span
        id="connection"
        className={trouble ? "connection" : "visually-hidden"}
        role="status"
      >
        <MotionContent changeKey={state.connection}>
          {state.connection}
        </MotionContent>
      </span>
      {/* Narrow panels show this icon in place of the text, which stays announced. */}
      {trouble && (
        <Infotip label={state.connection}>
          <button type="button" className="text-button connection-icon">
            <Icon name="alert-triangle" size={14} />
          </button>
        </Infotip>
      )}
    </>
  );

  return (
    <header>
      {/* The host tab or rail already shows the logo, so the title is text only. */}
      <div className="brand">
        <span>Delegated Work</span>
        <span className="muted" aria-hidden="true">
          ·
        </span>
        {threadMode ? (
          <strong id="project-name" title={state.repository}>
            {projectName}
          </strong>
        ) : (
          <ProjectScope />
        )}
      </div>
      <div className="toolbar">
        {status}
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
              <Menu.Popup className="menu-popup" finalFocus={menuFinalFocus}>
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
                <Menu.Item
                  className="menu-item"
                  disabled={blocked}
                  onClick={settings}
                >
                  Settings
                </Menu.Item>
                {!threadMode && (
                  <>
                    <Menu.Item
                      className="menu-item"
                      disabled={blocked}
                      onClick={openNewTask}
                    >
                      New task
                    </Menu.Item>
                    <Menu.Item
                      className="menu-item"
                      disabled={blocked}
                      onClick={() =>
                        controller.run(() => controller.delegate())
                      }
                    >
                      Advanced task…
                    </Menu.Item>
                  </>
                )}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
        {!threadMode && <NewTaskButton disabled={blocked} />}
      </div>
    </header>
  );
}
