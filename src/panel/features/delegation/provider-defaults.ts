import type { ProviderMetadata } from "../../../shared/providers/metadata.js";
import { providerMetadata } from "../../../shared/providers/metadata.js";
import { scalarText } from "../../../shared/text.js";

export function providerOptionDefaults(
  provider: string,
  metadata: ProviderMetadata | undefined,
  settings: Record<string, unknown>,
) {
  const permissions = providerMetadata(provider, metadata)?.nativePermissions;

  return {
    permission_mode: permissions
      ? scalarText(settings[permissions.permissionSetting], "inherit")
      : "inherit",
    approval_decider: permissions?.approvalDeciderSetting
      ? scalarText(settings[permissions.approvalDeciderSetting], "user")
      : "user",
  };
}
