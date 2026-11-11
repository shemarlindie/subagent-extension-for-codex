import { Menu } from "@base-ui/react/menu";
import { useRef } from "react";

import { NewTaskButton } from "../features/delegation/new-task/new-task-button";
import { ProjectScope } from "../features/projects/project-scope";
import { PendingUpdatesIndicator } from "../features/tasks/pending-updates/pending-updates-indicator";
import { Button, buttonClass } from "../shared/components/button/button";
import { Icon } from "../shared/components/icons/icons";
import { Infotip } from "../shared/components/infotip";
import { MotionContent } from "../shared/components/motion/motion-content";
import { TooltipWrapper } from "../shared/components/tooltip";
import { connectionTrouble } from "./state/connection";
import { useController, useSnapshot } from "./state/controller-context";
import { projectChoices } from "./state/selectors";
import type { TaskRail } from "./task-layout";

type HeaderProps = {
  taskRail: Pick<TaskRail, "collapsed" | "toggle">;
};

export function Header({ taskRail }: HeaderProps) {
  const controller = useController();

  const {
    connected,
    busy,
    conversation,
    projects,
    repository,
    connection,
    projectCandidate,
    scopeKnown,
  } = useSnapshot([
    "connected",
    "busy",
    "conversation",
    "projects",
    "repository",
    "connection",
    "projectCandidate",
    "scopeKnown",
  ]);

  const blocked = !connected || busy;
  // Thread mode scopes the panel to the conversation; Settings stays available.
  const threadMode = !!conversation;

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
    projectChoices({ projects, repository }).find(
      (project) => project.repository === repository,
    )?.name ??
    repository?.split("/").at(-1) ??
    "All projects";

  // Only connection problems are visible. The task list explains a missing connection.
  const trouble = connectionTrouble(connection);

  const status = (
    <>
      <span
        id="connection"
        className={trouble ? "connection" : "visually-hidden"}
        role="status"
      >
        <MotionContent changeKey={connection}>{connection}</MotionContent>
      </span>
      {/* Narrow panels show this icon in place of the text, which stays announced. */}
      {trouble && (
        <Infotip label={connection}>
          <button type="button" className="text-button connection-icon">
            <Icon name="alert-triangle" size={14} />
          </button>
        </Infotip>
      )}
    </>
  );

  const railLabel = taskRail.collapsed ? "Show task list" : "Hide task list";

  return (
    <header>
      {/* Narrow panels switch between the list and a task, so CSS hides this. */}
      <TooltipWrapper label={railLabel}>
        <Button
          variant="ghost"
          className="toolbar-icon-button task-rail-toggle"
          aria-label={railLabel}
          aria-expanded={!taskRail.collapsed}
          aria-controls="task-rail"
          onClick={taskRail.toggle}
        >
          <Icon name="sidebar" size={14} />
        </Button>
      </TooltipWrapper>
      {/* The host tab or rail already shows the logo, so the title is text only. */}
      <div className="brand">
        <span>Delegated Work</span>
        <span className="muted" aria-hidden="true">
          ·
        </span>
        {threadMode ? (
          <strong id="project-name" title={repository}>
            {projectName}
          </strong>
        ) : (
          <ProjectScope />
        )}
      </div>
      <div className="toolbar">
        {status}
        {/* Outside the inline toolbar, so narrow panels keep it. */}
        {threadMode && <PendingUpdatesIndicator />}
        {/* Narrow panels swap these for the menu below; both stay mounted so CSS decides. */}
        <div className="toolbar toolbar-inline">
          {projectCandidate && (
            <TooltipWrapper
              label={`Let tasks run and edit files in ${projectCandidate}. It stays allowed until you remove it in Manage projects.`}
              triggerLabel="Allow tasks here"
            >
              <Button
                id="add-chat-project"
                variant="ghost"
                className="toolbar-icon-button"
                disabled={!connected || !scopeKnown || busy}
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
                {projectCandidate && (
                  <Menu.Item
                    className="menu-item"
                    disabled={!connected || !scopeKnown || busy}
                    onClick={() => controller.addProject()}
                  >
                    Allow tasks here
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
