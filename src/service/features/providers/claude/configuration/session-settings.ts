import type { PermissionMode, Settings } from "@anthropic-ai/claude-agent-sdk";

/** How long Claude Code may take to report its settings at startup. */
const READ_TIMEOUT_MS = 30_000;

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
  } catch {
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
  mode: PermissionMode | string,
  policy: Settings | undefined,
) {
  if (mode === "bypassPermissions") {
    return !!policy?.permissions?.disableBypassPermissionsMode;
  }

  return mode === "auto" && !!policy?.disableAutoMode;
}
