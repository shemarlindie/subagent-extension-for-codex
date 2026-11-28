import {
  permissionModeName,
  resolveClaudePermission,
  type ClaudePermissionMode,
} from "../../../providers/claude/shared/permissions";
import type { Worker } from "../../app/state/types";
import { workerChoice } from "./delegation";
import { providerOptionDefaults } from "./provider-defaults";

type PermissionOption = { value: string; label: string; disabled?: boolean };

/**
 * The mode "Use extension setting" runs, as the service resolves it: Plan for
 * a read-only profile, else the saved mode, or its fallback when policy
 * blocks it. Unknown until settings load.
 */
export function inheritedPermissionMode(
  worker: string,
  defaults: unknown,
  info: Worker | undefined,
) {
  if (!defaults) return undefined;

  const { provider, profile = "" } = workerChoice(worker);

  const saved = providerOptionDefaults(
    provider,
    info?.metadata,
    defaults,
    info?.policy,
  ).permission_mode as ClaudePermissionMode;

  return resolveClaudePermission({}, saved, profile).mode;
}

/** Names the mode on the "Use extension setting" option, once it's known. */
export const withInheritedMode = <T extends PermissionOption>(
  options: T[] | undefined,
  mode: string | undefined,
) =>
  options?.map((option) =>
    option.value === "inherit" && mode
      ? { ...option, label: `${option.label} (${permissionModeName(mode)})` }
      : option,
  );
