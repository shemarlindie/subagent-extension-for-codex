/** The read and update contracts of the settings tools. */
import { z } from "zod";

import { sectionSchema } from "../../../shared/settings/settings-document.js";
import {
  settingPaths,
  settingsPatchSchema,
} from "../../../shared/settings/settings-schema.js";

// Reads leave out a disabled provider's model defaults, so values are loose.
const valuesSchema = z.looseObject({});

// The panel's settings document: field schemas, values, and the groups the
// settings dialog shows, each with a stable ID.
export const settingsReadOutputSchema = z.object({
  // Field types, choices, and bounds; agents read this to update settings.
  schema: z.looseObject({
    type: z.literal("object"),
    properties: z.record(z.string(), z.looseObject({})).optional(),
    required: z.array(z.string()).optional(),
  }),
  values: valuesSchema,
  // What each shown setting resets to.
  defaults: valuesSchema,
  // What the settings dialog shows, section by section.
  sections: z.array(sectionSchema),
});

export const settingsUpdateOutputSchema = z.object({ values: valuesSchema });

export const settingsUpdateSchema = z.strictObject({
  set: settingsPatchSchema
    .refine(
      (patch) => settingPaths(patch).length > 0,
      "Set at least one setting",
    )
    .meta({
      description:
        "Nested settings to change, using the paths get_settings returns. Omitted settings stay unchanged.",
      minProperties: 1,
    }),
});
