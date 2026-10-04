import { Autocomplete } from "@base-ui/react/autocomplete";
import { useController, useFormContext } from "react-hook-form";
import type { DelegateValues } from "./delegate-fields";
/** Suggestions never restrict a path inside an approved parent; the service validates it. */
interface ProjectAutocompleteProps {
  repositories: string[];
  disabled?: boolean;
}
export function ProjectAutocomplete({
  repositories,
  disabled = false,
}: ProjectAutocompleteProps) {
  const { control } = useFormContext<DelegateValues>();
  const { field, fieldState } = useController({
    control,
    name: "repository",
    rules: { required: "Enter an approved repository path." },
  });
  return (
    <Autocomplete.Root
      items={repositories}
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
                  {repository}
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
