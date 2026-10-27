import { z } from "zod";

import { packageVersion } from "../../platform/service/runtime.js";
import { type Settings } from "./settings.js";
import {
  settingsUpdateOutputSchema,
  settingsUpdateSchema,
} from "./settings-values.js";

/**
 * Settings export and import. An export holds one owner's saved defaults with
 * a format number, so a later format can migrate older files. Approved
 * projects stay out: their paths are machine specific, and approving one
 * stays an explicit act.
 */
const SETTINGS_FORMAT = 1;

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
  settings: z.record(z.string(), z.unknown()),
});

export function exportSettings(settings: Settings, owner: string) {
  const document = {
    format: SETTINGS_FORMAT,
    version: packageVersion,
    settings: settings.exportValues(owner),
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

  return parsed.data.settings;
}

/**
 * Applies an export through the settings update, with user authority. Keys
 * this version doesn't know, and a provider that isn't enabled here, are
 * skipped and reported so one difference doesn't block the rest.
 */
export function importSettings(
  settings: Settings,
  owner: string,
  input: unknown,
) {
  const { document } = settingsTransferInputSchema.parse(input);
  const set: Record<string, unknown> = {};
  const ignored: string[] = [];

  for (const [key, value] of Object.entries(parseDocument(document))) {
    const shape: Partial<Record<string, z.ZodType>> =
      settingsUpdateSchema.shape.set.shape;

    const known =
      Object.hasOwn(shape, key) && shape[key]?.safeParse(value).success;

    if (
      !known ||
      (key === "default_provider" &&
        !settings.providers().includes(value as string))
    ) {
      ignored.push(key);
    } else {
      set[key] = value;
    }
  }

  // An update keeps a turned-off limit off, so an import sets the toggles.
  for (const [limit, toggle] of [
    ["max_cost_usd", "use_cost_budget"],
    ["max_runtime_minutes", "use_runtime_budget"],
  ] as const) {
    if (!(limit in set)) continue;
    set[toggle] ??= set[limit] !== null;
    if (set[limit] === null) delete set[limit];
  }

  if (!Object.keys(set).length) {
    throw new Error("No valid settings to import.");
  }

  return { ...settings.update(owner, { set }, "user"), ignored };
}
