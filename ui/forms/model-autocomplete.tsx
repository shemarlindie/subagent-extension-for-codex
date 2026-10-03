import { useState } from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { useController, useFormContext } from "react-hook-form";
import type { ModelChoice } from "../../src/core/model";
import type { DelegateValues } from "./delegate-fields";
function matches(model: ModelChoice, query: string) {
  const text = query.trim().toLowerCase();
  return [model.value, model.displayName, model.description].some((field) =>
    field?.toLowerCase().includes(text),
  );
}
/** Discovered models are suggestions; custom model IDs and aliases remain valid. */
export function ModelAutocomplete({
  models,
  placeholder,
  describedBy,
}: {
  models: ModelChoice[];
  placeholder: string;
  describedBy?: string;
}) {
  const { control } = useFormContext<DelegateValues>();
  const { field } = useController({ control, name: "model" });
  const [open, setOpen] = useState(false);
  // An unmatched custom ID closes the menu so the rest of the form stays usable.
  const hasMatches = models.some((model) => matches(model, field.value));
  return (
    <Autocomplete.Root
      items={models}
      value={field.value}
      onValueChange={field.onChange}
      itemToStringValue={(model: ModelChoice) => model.value}
      filter={matches}
      open={open && hasMatches}
      onOpenChange={setOpen}
      openOnInputClick
    >
      <Autocomplete.Input
        id="model"
        name={field.name}
        ref={field.ref}
        onBlur={field.onBlur}
        maxLength={200}
        placeholder={placeholder}
        aria-describedby={describedBy}
      />
      {models.length > 0 && (
        <Autocomplete.Portal>
          <Autocomplete.Positioner
            className="autocomplete-positioner"
            sideOffset={6}
            align="start"
          >
            <Autocomplete.Popup
              id="available-models"
              className="autocomplete-popup"
            >
              <Autocomplete.List>
                {(model: ModelChoice) => (
                  <Autocomplete.Item
                    key={model.value}
                    value={model}
                    className="autocomplete-item"
                  >
                    <span className="select-item-text">
                      <span>
                        {model.displayName}
                        {model.displayName !== model.value && (
                          <span className="model-id"> {model.value}</span>
                        )}
                      </span>
                      {model.description && (
                        <span className="select-item-description">
                          {model.description}
                        </span>
                      )}
                    </span>
                  </Autocomplete.Item>
                )}
              </Autocomplete.List>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      )}
    </Autocomplete.Root>
  );
}
