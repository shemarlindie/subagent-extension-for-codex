import type { Options, Settings } from "@anthropic-ai/claude-agent-sdk";

import {
  readSessionSettings,
  type SettingsReader,
} from "./session-settings.js";

const CHOOSE_ANOTHER = "Choose another option in Settings or ask your admin.";

const UNCONFIRMED =
  "You chose the extension sandbox, but Claude Code didn't confirm it's on, so the task didn't start. Update Claude Code, or choose another option in Settings.";

type RequestedSandbox = Pick<Options, "sandbox" | "managedSettings">;

/**
 * What differs from the sandbox the task asked for. Only policy outranks these
 * SDK options, so a difference comes from the organization.
 */
function shortfall(
  requested: RequestedSandbox,
  effective: Settings["sandbox"],
) {
  if (!effective?.enabled) {
    return `You chose the extension sandbox, but your organization's policy turns the sandbox off. ${CHOOSE_ANOTHER}`;
  }

  if (
    effective.failIfUnavailable !== requested.sandbox?.failIfUnavailable ||
    effective.allowUnsandboxedCommands !==
      requested.sandbox?.allowUnsandboxedCommands
  ) {
    return `You chose the extension sandbox, but your organization's policy changes how it runs. ${CHOOSE_ANOTHER}`;
  }

  if (
    requested.managedSettings?.sandbox?.network?.allowManagedDomainsOnly &&
    !effective.network?.allowManagedDomainsOnly
  ) {
    return `You chose the extension sandbox with a locked network, but your organization's policy doesn't let the extension lock it. ${CHOOSE_ANOTHER}`;
  }

  return undefined;
}

/**
 * Why this turn can't have the sandbox it asked for, read from the session
 * itself, so it covers every policy source. Each turn checks again, because
 * Claude Code picks up new policy while it runs. A CLI that refused to start
 * also lands here, and its own result follows on the stream.
 */
export async function sandboxBlock(
  session: SettingsReader,
  requested: RequestedSandbox,
) {
  if (!requested.sandbox) return undefined;
  const settings = await readSessionSettings(session);

  return settings
    ? shortfall(requested, settings.effective.sandbox)
    : UNCONFIRMED;
}
