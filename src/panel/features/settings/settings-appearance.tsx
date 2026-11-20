import { Controller, type Control } from "react-hook-form";

import { FormSwitch } from "../../shared/forms/form-switch";
import type { settingsSearch } from "./search/settings-search";
import { SettingsSearchHighlight } from "./search/settings-search-highlight";
import type { Values } from "./settings-layout";
import type { SettingsSectionView } from "./settings-sections";

/** The form field for task rows' worker icons. */
export const ROW_ICONS_FIELD = "appearance-row_icons";

const TITLE = "Appearance";
const LABEL = "Worker icons in task list";

const HELP = "Show each task's worker profile icon before its title.";

const KEYWORDS = "profile researcher reviewer implementer row";

interface AppearanceOptions {
  control: Control<Values>;
  edits: number;
}

/**
 * Panel display choices. They save with the form, but the panel keeps them
 * itself, so they stay out of the service settings.
 */
export function appearanceSection(
  search: ReturnType<typeof settingsSearch>,
  { control, edits }: AppearanceOptions,
): SettingsSectionView {
  const matches = search.matches(`${TITLE} ${LABEL} ${HELP} ${KEYWORDS}`)
    ? 1
    : 0;

  return {
    id: "appearance",
    title: TITLE,
    edits,
    hidden: !matches,
    matches,
    score: search.matches(LABEL) ? 0 : 1,
    content: <SettingsAppearance control={control} />,
  };
}

function SettingsAppearance({ control }: { control: Control<Values> }) {
  return (
    <div className="setting-row setting-row-inline">
      <div className="setting-text">
        <label
          id="setting-row-icons-label"
          htmlFor="setting-row-icons-switch"
          className="setting-label"
        >
          <SettingsSearchHighlight text={LABEL} />
        </label>
        <p id="setting-row-icons-help" className="help">
          {HELP}
        </p>
      </div>
      <div className="setting-control">
        <Controller
          control={control}
          name={ROW_ICONS_FIELD}
          render={({ field }) => (
            <FormSwitch
              id="setting-row-icons-switch"
              checked={field.value === "true"}
              onCheckedChange={(checked) => field.onChange(String(checked))}
              onBlur={field.onBlur}
              labelId="setting-row-icons-label"
              describedBy="setting-row-icons-help"
            />
          )}
        />
      </div>
    </div>
  );
}
