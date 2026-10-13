import { settingsSections as buildSettingsSections } from "../../../shared/settings/settings-document";
import {
  Help,
  SettingRowView,
  SettingsContext,
  type SettingsControls,
} from "./settings-fields";
import { sectionKeys, type SettingSection } from "./settings-layout";
import { ModelTable } from "./settings-model-table";

interface LoadingSettingsSectionProps extends SettingsControls {
  section: SettingSection;
}

/** A section's rows as placeholders while the settings read loads. */
export function LoadingSettingsSection({
  section,
  control,
  register,
}: LoadingSettingsSectionProps) {
  const keys = sectionKeys(section);

  return (
    <SettingsContext.Provider
      value={{
        show: () => {},
        sectionOf: () => undefined,
        current: keys,
        form: {},
      }}
    >
      <div className="settings-section-intro">
        <Help id={`settings-${section.id}-help`} parts={section.help} />
      </div>
      {section.rows.map((row) =>
        row.kind === "models" ? (
          <ModelTable
            key="models"
            scopes={row.scopes}
            control={control}
            register={register}
            loading
            reserveProviderScope={section.id === "models"}
          />
        ) : (
          <SettingRowView
            key={row.key}
            row={row}
            control={control}
            register={register}
            loading
          />
        ),
      )}
    </SettingsContext.Provider>
  );
}

// Use the shared settings definitions for all structure that is known before
// the settings read. Dynamic provider scopes are added after the read returns.
export const loadingSections = buildSettingsSections({
  values: {},
  providers: [],
  catalogs: [],
  modelProviders: [],
  shown: {},
  remembered: { max_cost_usd: 5, max_runtime_minutes: 20 },
});
