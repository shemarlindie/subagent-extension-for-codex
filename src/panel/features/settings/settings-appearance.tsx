import { FormSwitch } from "../../shared/forms/form-switch";
import { setCompactRows, useCompactRows } from "../tasks/list/compact-rows";
import type { settingsSearch } from "./search/settings-search";
import { SettingsSearchHighlight } from "./search/settings-search-highlight";
import type { SettingsSectionView } from "./settings-sections";

const TITLE = "Appearance";
const LABEL = "Compact task rows";

const HELP =
  "Show each task on one line, with its profile icon and status. Applies right away, without Save.";

const KEYWORDS = "density dense list single line";

/**
 * Panel display choices. The panel keeps them itself, so they apply at once
 * and stay out of the saved settings.
 */
export function appearanceSection(
  search: ReturnType<typeof settingsSearch>,
): SettingsSectionView {
  const matches = search.matches(`${TITLE} ${LABEL} ${HELP} ${KEYWORDS}`)
    ? 1
    : 0;

  return {
    id: "appearance",
    title: TITLE,
    hidden: !matches,
    matches,
    score: search.matches(LABEL) ? 0 : 1,
    content: <SettingsAppearance />,
  };
}

function SettingsAppearance() {
  const compact = useCompactRows();

  return (
    <div className="setting-row setting-row-inline">
      <div className="setting-text">
        <label
          id="setting-compact-rows-label"
          htmlFor="setting-compact-rows-switch"
          className="setting-label"
        >
          <SettingsSearchHighlight text={LABEL} />
        </label>
        <p id="setting-compact-rows-help" className="help">
          {HELP}
        </p>
      </div>
      <div className="setting-control">
        <FormSwitch
          id="setting-compact-rows-switch"
          checked={compact}
          onCheckedChange={setCompactRows}
          labelId="setting-compact-rows-label"
          describedBy="setting-compact-rows-help"
        />
      </div>
    </div>
  );
}
