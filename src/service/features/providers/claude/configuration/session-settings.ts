import type { Settings } from "@anthropic-ai/claude-agent-sdk";

import type { ClaudePermissionMode } from "../../../../../shared/providers/claude/permissions.js";
import { errorCategory } from "../../../../platform/logging/error-metadata.js";
import { logEvent } from "../../../../platform/logging/logger.js";

/**
 * How long Claude Code may take to report its settings at startup. It gives up
 * on a hung org policy fetch after about 30 seconds and carries on, as a task
 * should too, so this has to outlast that.
 */
export const READ_TIMEOUT_MS = 45_000;

/** What `getSettings` returns. The SDK has it at runtime, without declaring it. */
export type SessionSettings = {
  effective: Settings;
  sources?: { source: string; settings: Settings }[];
};

export type SettingsReader = { getSettings?(): Promise<SessionSettings> };

/** A session's own settings, or nothing when it can't report them in time. */
export async function readSessionSettings(session: SettingsReader) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      session.getSettings?.(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Timed out")),
          READ_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    // A warning, as a refused start also lands here and reports its own cause.
    logEvent("warn", "provider.settings_read_failed", {
      error_type: error instanceof Error ? error.name : "NonError",
      error_category: errorCategory(error),
    });

    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** The org's policy as the session sees it, whichever source it came from. */
export const policySettings = (settings: SessionSettings | undefined) =>
  settings?.sources?.find(({ source }) => source === "policySettings")
    ?.settings;

/** Whether policy is what turned this mode off. A user's settings can too. */
export function policyBlocksMode(
  mode: ClaudePermissionMode,
  policy: Settings | undefined,
) {
  if (mode === "bypassPermissions") {
    return !!policy?.permissions?.disableBypassPermissionsMode;
  }

  return (
    mode === "auto" &&
    !!(policy?.disableAutoMode ?? policy?.permissions?.disableAutoMode)
  );
}
