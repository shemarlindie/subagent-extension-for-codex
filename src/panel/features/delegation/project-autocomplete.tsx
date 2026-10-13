import { Autocomplete } from "@base-ui/react/autocomplete";
import { useController, useFormContext } from "react-hook-form";

import { matchesProjectQuery, projectDisplayName } from "../projects/selectors";
import type { Project } from "../projects/types";
import type { DelegateValues } from "./delegate-fields";

/** Suggestions never restrict a path inside an approved parent; the service validates it. */
interface ProjectAutocompleteProps {
  projects: Project[];
  disabled?: boolean;
}

export function ProjectAutocomplete({
  projects,
  disabled = false,
}: ProjectAutocompleteProps) {
  const { control } = useFormContext<DelegateValues>();

  const projectByRepository = new Map(
    projects.map((project) => [project.repository, project]),
  );

  const repositories = projects.map((project) => project.repository);

  const { field, fieldState } = useController({
    control,
    name: "repository",
    rules: { required: "Enter an approved repository path." },
  });

  return (
    <Autocomplete.Root
      items={repositories}
      filter={(repository, query) =>
        matchesProjectQuery(
          projectByRepository.get(repository) ?? { repository },
          query,
        )
      }
      value={field.value}
      onValueChange={field.onChange}
      openOnInputClick
    >
      <Autocomplete.Input
        id="repository"
        disabled={disabled}
        name={field.name}
        ref={field.ref}
        onBlur={field.onBlur}
        required
        aria-label="Project"
        aria-invalid={fieldState.invalid || undefined}
        aria-describedby={fieldState.error ? "repository-error" : undefined}
        placeholder="/absolute/path/to/repository"
      />
      <Autocomplete.Portal>
        <Autocomplete.Positioner
          className="autocomplete-positioner"
          sideOffset={6}
          align="start"
        >
          <Autocomplete.Popup className="autocomplete-popup">
            <Autocomplete.Empty className="autocomplete-empty">
              No matching registered root. You can enter a repository inside an
              approved parent.
            </Autocomplete.Empty>
            <Autocomplete.List>
              {(repository: string) => (
                <Autocomplete.Item
                  key={repository}
                  value={repository}
                  className="autocomplete-item"
                >
                  <span className="select-item-text">
                    <span>
                      {projectDisplayName(
                        projectByRepository.get(repository) ?? { repository },
                      )}
                    </span>
                    <span className="select-item-description">
                      {repository}
                    </span>
                  </span>
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
      {fieldState.error && (
        <p id="repository-error" className="form-error" role="alert">
          {fieldState.error.message}
        </p>
      )}
    </Autocomplete.Root>
  );
}
