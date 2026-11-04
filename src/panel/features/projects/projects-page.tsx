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
import { ProjectGitTag } from "./project-git-tag";
import { ProjectListSkeleton } from "./project-list-skeleton";
import { projectDisplayName } from "./selectors";

export function ProjectsPage() {
  const controller = useController(),
    state = useSnapshot(),
    // The project whose archive replaces the list, until the user goes back.
    [archive, setArchive] = useState<{ repository: string; name: string }>(),
    closedArchive = useRef<string>(undefined);

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

  const disabled =
    state.busy ||
    !state.connected ||
    !state.scopeKnown ||
    Boolean(state.dialog);

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
          disabled={state.busy || Boolean(state.dialog)}
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
        {state.projectsLoaded && !state.projects.length ? (
          <p className="muted managed-projects-empty">No saved projects.</p>
        ) : null}
        <LoadingSwap
          className="managed-projects-loading-swap"
          loading={!state.projectsLoaded}
          skeleton={<ProjectListSkeleton />}
        >
          <ul className="managed-projects" aria-label="Saved projects">
            {state.projects.map((project) => {
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
                        <ProjectGitTag git={project.git} />
                      </div>
                      <code className="managed-project-path">
                        {project.repository}
                      </code>
                    </div>
                    <Button
                      variant="text"
                      className="managed-project-archive"
                      disabled={disabled}
                      aria-label={`View archived tasks in ${name}`}
                      data-repository={project.repository}
                      onClick={() =>
                        setArchive({ repository: project.repository, name })
                      }
                    >
                      View archived tasks
                    </Button>
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
                </li>
              );
            })}
          </ul>
        </LoadingSwap>
      </div>
    </PageFrame>
  );
}
