import compareVersions from "semver/functions/compare.js";

import { logEvent } from "../../../../core/service/platform/logging/logger.js";
import type { ProviderReadiness } from "../../../../core/shared/providers/types.js";
import { claudeMetadata } from "../../shared/metadata.js";
import { claudeCliSupport } from "./executable.js";
import { claudeUpgradeInfo } from "./upgrade.js";

export async function claudeAbout(
  readiness: ProviderReadiness,
  refresh: boolean,
) {
  const { version, executable, problem } = readiness.details;
  const upgrade = await claudeUpgradeInfo(version ? executable : undefined);

  if (refresh) {
    logEvent("info", "about.claude_rechecked", {
      ready: readiness.ready,
      problem,
      version,
      executable,
      installation: upgrade.installation,
    });
  }

  return {
    displayName: claudeMetadata.displayName,
    cliName: claudeMetadata.cliName,
    readiness,
    upgrade,
    updateUrl: "https://code.claude.com/docs/en/setup#update-claude-code",
    recommended: version
      ? {
          version: claudeCliSupport.paired,
          behind: compareVersions(version, claudeCliSupport.paired) < 0,
        }
      : undefined,
  };
}
