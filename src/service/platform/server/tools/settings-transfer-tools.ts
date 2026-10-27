import { z } from "zod";

import { type Settings } from "../../../features/settings/settings.js";
import {
  saveSettingsFile,
  settingsFileOutputSchema,
} from "../../../features/settings/settings-file.js";
import {
  exportSettings,
  importSettings,
  settingsExportOutputSchema,
  settingsImportOutputSchema,
  settingsTransferInputSchema,
} from "../../../features/settings/settings-transfer.js";
import { tool } from "./definition.js";

/** App-only settings transfer. File destinations and contents belong to the service. */
export function settingsTransferTools(settings: Settings, owner: string) {
  return {
    app_export_settings: tool({
      readOnly: true,
      description:
        "User interface only: export saved defaults as versioned JSON without approved projects.",
      schema: z.strictObject({}),
      outputSchema: settingsExportOutputSchema,
      run: () => exportSettings(settings, owner),
    }),
    app_import_settings: tool({
      description:
        "User interface only: import saved defaults with user authority. Skip unknown keys, invalid values and an unavailable default provider. Return the skipped keys.",
      schema: settingsTransferInputSchema,
      outputSchema: settingsImportOutputSchema,
      run: (a) => importSettings(settings, owner, a),
    }),
    app_save_settings_file: tool({
      description:
        "User interface only: save the user's defaults as a new JSON file in Downloads on the service computer and return its path.",
      schema: z.strictObject({}),
      outputSchema: settingsFileOutputSchema,
      run: () => saveSettingsFile(settings, owner),
    }),
  };
}
