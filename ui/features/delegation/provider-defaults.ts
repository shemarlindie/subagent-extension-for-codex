import type { ProviderMetadata } from "../../../src/features/providers/metadata.js";
import { providerMetadata } from "../../../src/features/providers/metadata.js";

export function providerOptionDefaults(
  provider: string,
  metadata: ProviderMetadata | undefined,
  settings: Record<string, unknown>,
) {
  const permissions = providerMetadata(provider, metadata)?.nativePermissions;

  return {
    permission_mode: permissions
      ? String(settings[permissions.permissionSetting] ?? "inherit")
      : "inherit",
    approval_decider: permissions?.approvalDeciderSetting
      ? String(settings[permissions.approvalDeciderSetting] ?? "user")
      : "user",
  };
}
