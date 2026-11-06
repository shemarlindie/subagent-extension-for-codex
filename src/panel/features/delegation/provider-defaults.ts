import type { ProviderMetadata } from "../../../shared/providers/metadata.js";
import { providerMetadata } from "../../../shared/providers/metadata.js";
import { allowedPermissionMode } from "../../../shared/providers/policy.js";
import type { ProviderPolicy } from "../../../shared/providers/types.js";
import { settingAt } from "../../../shared/settings/settings-schema.js";
import { scalarText } from "../../../shared/text.js";

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
    // One shared setting answers for every provider with native permissions.
    approval_decider: permissions?.approvalDecider
      ? scalarText(settingAt(settings, "approvals.decider"), "user")
      : "user",
  };
}
