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
    // One shared setting answers for every provider with native permissions.
    approval_decider: permissions?.approvalDecider
      ? scalarText(settings.default_approval_decider, "user")
      : "user",
  };
}
