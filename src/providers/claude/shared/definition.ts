import type { ProviderDefinition } from "../../../core/shared/providers/registry.js";
import { claudeMetadata } from "./metadata.js";
import { claudeTaskFacts } from "./presentation.js";
import { inheritHelp, withClaudePolicy } from "./settings-policy.js";
import {
  claudeApprovalRows,
  claudeRestrictionsSection,
  claudeSettingsSchema,
} from "./settings.js";

export const claudeDefinition = {
  id: "claude",
  metadata: claudeMetadata,
  taskFacts: claudeTaskFacts,
  settings: {
    schema: claudeSettingsSchema,
    approvalRows: claudeApprovalRows,
    restrictionSection: claudeRestrictionsSection,
    policy: { apply: withClaudePolicy, inheritHelp },
  },
} satisfies ProviderDefinition;
