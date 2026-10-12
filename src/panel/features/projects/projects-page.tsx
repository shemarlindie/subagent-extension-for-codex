import { PAGES } from "../../app/navigation/pages";
import { useController, useSnapshot } from "../../app/state/controller-context";
import { Button } from "../../shared/components/button/button";
import { EditableText } from "../../shared/components/editable-text/editable-text";
import { Icon } from "../../shared/components/icons/icons";
import { LoadingSwap } from "../../shared/components/loading-skeleton/loading-swap";
import { BackButton } from "../../shared/components/navigation/back-button";
import { PageFrame } from "../../shared/components/navigation/page-frame";
import { TooltipWrapper } from "../../shared/components/tooltip";
import { ProjectListSkeleton } from "./project-list-skeleton";
import { projectDisplayName } from "./selectors";

export function ProjectsPage() {
  const controller = useController(),
    state = useSnapshot();

  const disabled =
    state.busy ||
    !state.connected ||
    !state.scopeKnown ||
    Boolean(state.dialog);

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
        <p className="form-note">
          Manage saved projects on the service host. Names help you identify
          projects; repository paths stay the same.
        </p>
        {state.projectsLoaded && !state.projects.length ? (
          <p className="muted">
            No saved projects. Add a Git repository to get started.
          </p>
        ) : null}
        <LoadingSwap
          className="managed-projects-loading-swap"
          loading={!state.projectsLoaded}
          skeleton={<ProjectListSkeleton />}
        >
          <ul className="managed-projects" aria-label="Saved projects">
            {state.projects.map((project) => {
              const name = projectDisplayName(project);

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
                            onSave={async (value) => {
                              controller.clearProjectError();

                              const saved = await controller.manageProject(
                                project.repository,
                                value,
                              );

                              if (!saved)
                                throw new Error(
                                  controller.getSnapshot().formError ||
                                    "The project changed. Reopen its name to retry.",
                                );
                            }}
                          />
                        </strong>
                        {project.kind === "parent" && (
                          <span className="muted">Parent approval</span>
                        )}
                      </div>
                      <code className="managed-project-path">
                        {project.repository}
                      </code>
                    </div>
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
