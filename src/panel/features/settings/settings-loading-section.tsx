import { settingsSections as buildSettingsSections } from "../../../shared/settings/settings-document";
import {
  Help,
  SettingRowView,
  SettingsContext,
  type SettingsControls,
} from "./settings-fields";
import { sectionPaths, type SettingSection } from "./settings-layout";
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
  const keys = sectionPaths(section);

  return (
    <SettingsContext.Provider
      value={{
        show: () => {},
        sectionOf: () => undefined,
        current: keys,
        form: {},
      }}
    >
      {section.help?.length ? (
        <div className="settings-section-intro">
          <Help id={`settings-${section.id}-help`} parts={section.help} />
        </div>
      ) : null}
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
            key={row.path}
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
});
