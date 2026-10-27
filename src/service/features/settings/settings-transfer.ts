import { z } from "zod";

import {
  settingAt,
  settingPaths,
  settingSchemaAt,
  withSetting,
} from "../../../shared/settings/settings-schema.js";
import { scalarText } from "../../../shared/text.js";
import { packageVersion } from "../../platform/service/runtime.js";
import { type Settings } from "./settings.js";
import { settingsUpdateOutputSchema } from "./settings-tool-schemas.js";

/**
 * Settings export and import. An export holds one owner's saved defaults with
 * a format number, so a later format can migrate older files. Approved
 * projects stay out: their paths are machine specific, and approving one
 * stays an explicit act.
 */
const SETTINGS_FORMAT = 2;

export const settingsTransferInputSchema = z.strictObject({
  document: z.string().min(1).meta({
    description: "A settings export as JSON text.",
  }),
});

export const settingsExportOutputSchema = z.object({
  document: z.string(),
});

export const settingsImportOutputSchema = settingsUpdateOutputSchema.extend({
  ignored: z.array(z.string()),
});

const documentSchema = z.object({
  format: z.number().int().positive(),
  version: z.string().optional(),
  settings: z.looseObject({}),
});

export function exportSettings(settings: Settings, owner: string) {
  const document = {
    format: SETTINGS_FORMAT,
    version: packageVersion,
    settings: settings.values(owner),
  };

  return { document: JSON.stringify(document, null, 2) };
}

function parseDocument(text: string) {
  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("The pasted settings aren't valid JSON.");
  }

  const parsed = documentSchema.safeParse(json);

  if (!parsed.success) {
    throw new Error("The pasted text isn't a settings export.");
  }

  if (parsed.data.format > SETTINGS_FORMAT) {
    throw new Error("Update the extension to import these settings.");
  }

  // Format 1 used flat keys from before the settings were grouped.
  if (parsed.data.format < SETTINGS_FORMAT) {
    throw new Error(
      "These settings come from an older version. Export them again.",
    );
  }

  return parsed.data.settings;
}

/**
 * Applies an export through the settings update, with user authority. Paths
 * this version doesn't know, invalid values and a provider that isn't enabled
 * here are skipped and reported, so one difference doesn't block the rest.
 */
export function importSettings(
  settings: Settings,
  owner: string,
  input: unknown,
) {
  const { document } = settingsTransferInputSchema.parse(input);
  const exported = parseDocument(document);
  let set: Record<string, unknown> = {};
  const ignored: string[] = [];

  for (const path of settingPaths(exported)) {
    const value = settingAt(exported, path);

    const valid =
      settingSchemaAt(path)?.safeParse(value).success === true &&
      (path !== "task.provider" ||
        settings.providers().includes(scalarText(value)));

    if (valid) set = withSetting(set, path, value);
    else ignored.push(path);
  }

  if (!settingPaths(set).length) {
    throw new Error("No valid settings to import.");
  }

  return { ...settings.update(owner, { set }, "user"), ignored };
}
