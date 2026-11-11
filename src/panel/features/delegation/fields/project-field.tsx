import { useFormContext } from "react-hook-form";

import type { Project } from "../../../app/state/types";
import { Button } from "../../../shared/components/button/button";
import { AsyncControl } from "../../../shared/forms/async-control";
import { Field } from "../../../shared/forms/fields";
import { FormFieldError } from "../../../shared/forms/form-field-error";
import { FormFieldHint } from "../../../shared/forms/form-field-hint";
import { FormSelect } from "../../../shared/forms/form-select";
import { projectDisplayName, projectPathLabel } from "../../projects/selectors";
import type { DelegateValues } from "../delegate-values";
import { ProjectAutocomplete } from "./project-autocomplete";

interface ProjectFieldProps {
  projects: Project[];
  allowParent: boolean;
  loading?: boolean;
  contextLoading?: boolean;
  error?: string;
  contextError?: string;
  disabled?: boolean;
  browseDisabled?: boolean;
  onBrowse?: () => void;
}

export function ProjectField({
  projects,
  allowParent,
  loading = false,
  contextLoading = false,
  error,
  contextError,
  disabled = false,
  browseDisabled = disabled,
  onBrowse,
}: ProjectFieldProps) {
  const { control } = useFormContext<DelegateValues>();
  const options = projects.filter((project) => project.kind === "repository");

  return (
    <Field id="repository" label="Project">
      <div className="project-selection">
        <div className="project-selection-control">
          {allowParent ? (
            <AsyncControl
              loading={loading || contextLoading}
              label={
                loading
                  ? "Loading approved projects"
                  : "Resolving project context"
              }
            >
              <ProjectAutocomplete
                disabled={disabled || loading || contextLoading}
                projects={options}
              />
            </AsyncControl>
          ) : (
            <FormSelect
              searchable
              control={control}
              name="repository"
              id="repository"
              label="Project"
              itemsLabel="projects"
              required
              disabled={disabled || loading || contextLoading}
              loading={loading || contextLoading}
              loadingLabel={
                loading
                  ? "Loading approved projects"
                  : "Resolving project context"
              }
              placeholder="Choose a project"
              rules={{
                required: "Choose a project before starting a task.",
              }}
              options={options.map((project) => ({
                value: project.repository,
                label: projectDisplayName(project),
                description: project.pending
                  ? `${projectPathLabel(project)} · Chat project, added when the task starts`
                  : projectPathLabel(project),
                showDescriptionInValue: true,
              }))}
            />
          )}
        </div>
        {onBrowse && (
          <Button
            disabled={browseDisabled}
            onClick={onBrowse}
            title="Choose and add a repository on the service host"
          >
            Browse…
          </Button>
        )}
      </div>
      <FormFieldError message={error} />
      <FormFieldError
        message={
          contextError
            ? `Project context could not be resolved: ${contextError}`
            : undefined
        }
      />
      <FormFieldHint
        message={
          !loading &&
          !contextLoading &&
          !error &&
          !options.length &&
          !allowParent
            ? "Add a project before starting a task."
            : undefined
        }
      />
      {allowParent && (
        <p className="help">
          Use a registered Git root or a Git repository inside an approved
          parent.
        </p>
      )}
    </Field>
  );
}
