import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { type Settings } from "./settings.js";
import { exportSettings } from "./settings-transfer.js";

export const settingsFileOutputSchema = z.object({ path: z.string() });

/** Saves only the caller's export. Neither contents nor destination come from the panel. */
export async function saveSettingsFile(settings: Settings, owner: string) {
  const { document } = exportSettings(settings, owner);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  const path = join(
    homedir(),
    `delegated-work-settings-${timestamp}-${randomUUID()}.json`,
  );

  // Exclusive creation also protects existing files and symlinks from replacement.
  await writeFile(path, `${document}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  return { path };
}
