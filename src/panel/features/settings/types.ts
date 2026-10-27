import type { SettingSection } from "../../../shared/settings/settings-document.js";
import type { SettingsValues } from "../../../shared/settings/settings-schema.js";

type ModelScopeValues = SettingsValues["models"]["global"];

/**
 * Saved settings as the panel reads them. Reads leave out a disabled
 * provider's model defaults, so provider entries may be missing.
 */
export type Defaults = Omit<SettingsValues, "models"> & {
  models: Omit<SettingsValues["models"], "providers"> & {
    providers: Partial<Record<string, ModelScopeValues>>;
  };
};

/**
 * `get_settings` as the dialog reads it: current values, the defaults a
 * reset restores, and the sections and rows to show. The JSON `schema` is for
 * agents; the dialog ignores it.
 */
export type SettingsDocument = {
  values: Defaults;
  defaults: Defaults;
  sections: SettingSection[];
};
