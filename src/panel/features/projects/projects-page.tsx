import { useLayoutEffect, useRef, useState } from "react";

import { PAGES } from "../../app/navigation/pages";
import { useController, useSnapshot } from "../../app/state/controller-context";
import { Button } from "../../shared/components/button/button";
import { EditableText } from "../../shared/components/editable-text/editable-text";
import { Icon } from "../../shared/components/icons/icons";
import { LoadingSwap } from "../../shared/components/loading-skeleton/loading-swap";
import { BackButton } from "../../shared/components/navigation/back-button";
import { PageFrame } from "../../shared/components/navigation/page-frame";
import { TooltipWrapper } from "../../shared/components/tooltip";
import { ProjectArchive } from "../tasks/archive/project-archive";
import { ProjectGitIcon } from "./project-git-icon";
import { ProjectListSkeleton } from "./project-list-skeleton";
import { projectDisplayName } from "./selectors";

export function ProjectsPage() {
  const controller = useController();

  const { busy, connected, scopeKnown, projects, projectsLoaded, dialogOpen } =
    useSnapshot(
      ["busy", "connected", "scopeKnown", "projects", "projectsLoaded"],
      (state) => ({ dialogOpen: Boolean(state.dialog) }),
    );

  // The project whose archive replaces the list, until the user goes back.
  const [archive, setArchive] = useState<{
    repository: string;
    name: string;
  }>();

  const closedArchive = useRef<string>(undefined);

  // Back from an archive, focus returns to the button that opened it.
  useLayoutEffect(() => {
    if (archive || !closedArchive.current) return;

    document
      .querySelector<HTMLElement>(
        `.managed-project-archive[data-repository="${CSS.escape(closedArchive.current)}"]`,
      )
      ?.focus();

    closedArchive.current = undefined;
  }, [archive]);

  const disabled = busy || !connected || !scopeKnown || dialogOpen;

  if (archive) {
    const closeArchive = () => {
      closedArchive.current = archive.repository;
      setArchive(undefined);
    };

    return <ProjectArchive {...archive} onBack={closeArchive} />;
  }

  return (
    <PageFrame
      title={PAGES.projects.label}
      headingId="projects-heading"
      back={
        <BackButton
          label={PAGES.tasks.label}
          disabled={busy || dialogOpen}
          onClick={() => controller.backToTasks()}
        />
      }
      actions={
        <Button
          id="project-add"
          variant="primary"
          disabled={disabled}
          onClick={() => controller.addProject()}
        >
          Add project
        </Button>
      }
    >
      <div className="project-manager">
        {projectsLoaded && !projects.length ? (
          <p className="muted managed-projects-empty">No saved projects.</p>
        ) : null}
        <LoadingSwap
          className="managed-projects-loading-swap"
          loading={!projectsLoaded}
          skeleton={<ProjectListSkeleton />}
        >
          <ul className="managed-projects" aria-label="Saved projects">
            {projects.map((project) => {
              const name = projectDisplayName(project);

              const saveName = async (value: string) => {
                controller.clearProjectError();

                const saved = await controller.manageProject(
                  project.repository,
                  value,
                );

                if (!saved) {
                  throw new Error(
                    controller.getSnapshot().formError ||
                      "The project changed. Reopen its name to retry.",
                  );
                }
              };

              return (
                <li key={project.repository} className="managed-project">
                  <div className="managed-project-summary">
                    <div className="managed-project-info">
                      <div className="managed-project-heading">
                        <strong className="managed-project-title">
                          <EditableText
                            value={name}
                            label="Project name"
                            maxLength={200}
                            disabled={disabled}
                            onSave={saveName}
                          />
                        </strong>
                        {project.kind === "parent" && (
                          <span className="muted">Parent approval</span>
                        )}
                        <ProjectGitIcon
                          git={project.git}
                          folder={project.repository}
                          name={name}
                        />
                      </div>
                      <code className="managed-project-path">
                        {project.repository}
                      </code>
                    </div>
                    <div className="toolbar">
                      <TooltipWrapper
                        label="View archived tasks"
                        triggerLabel={`View archived tasks in ${name}`}
                      >
                        <Button
                          variant="ghost"
                          className="toolbar-icon-button managed-project-archive"
                          disabled={disabled}
                          aria-label={`View archived tasks in ${name}`}
                          data-repository={project.repository}
                          onClick={() =>
                            setArchive({ repository: project.repository, name })
                          }
                        >
                          <Icon name="archive-view" size={16} />
                        </Button>
                      </TooltipWrapper>
                      <TooltipWrapper
                        label="Remove project"
                        triggerLabel={`Remove ${name}`}
                      >
                        <Button
                          variant="ghost"
                          className="toolbar-icon-button managed-project-remove"
                          disabled={disabled}
                          aria-label={`Remove ${name}`}
                          data-repository={project.repository}
                          onClick={() => controller.removeProject(project)}
                        >
                          <Icon name="minus" size={16} />
                        </Button>
                      </TooltipWrapper>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </LoadingSwap>
      </div>
    </PageFrame>
  );
}
