import type { ProviderMetadata } from "../../../core/shared/providers/metadata.js";
import { providerMetadata } from "../../../core/shared/providers/metadata.js";
import { allowedPermissionMode } from "../../../core/shared/providers/policy.js";
import type { ProviderPolicy } from "../../../core/shared/providers/types.js";
import { settingAt } from "../../../core/shared/settings/setting-path.js";
import { scalarText } from "../../../core/shared/text.js";

export function providerOptionDefaults(
  provider: string,
  metadata: ProviderMetadata | undefined,
  settings: unknown,
  policy?: ProviderPolicy,
) {
  const permissions = providerMetadata(provider, metadata)?.nativePermissions;

  return {
    permission_mode: permissions
      ? allowedPermissionMode(
          policy,
          scalarText(
            settingAt(settings, permissions.permissionSetting),
            "inherit",
          ),
        )
      : "inherit",
    sandbox:
      permissions?.sandbox &&
      settingAt(settings, permissions.sandbox.setting) === true
        ? ("on" as const)
        : ("off" as const),
    // One shared setting answers for every provider with native permissions.
    approval_decider: permissions?.approvalDecider
      ? scalarText(settingAt(settings, "approvals.decider"), "user")
      : "user",
  };
}
