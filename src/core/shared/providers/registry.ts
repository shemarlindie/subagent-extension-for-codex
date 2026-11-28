import type { z } from "zod";

import type {
  SettingRow,
  SettingSection,
} from "../settings/document-contract.js";
import type { TaskView } from "../tasks/model.js";
import type { ProviderMetadata } from "./metadata.js";
import type { ProviderPolicy } from "./types.js";

/** How a provider's org policy changes the settings document. */
interface ProviderSettingsPolicy {
  /** The sections with the policy's locks, warnings and facts applied. */
  apply: (
    sections: SettingSection[],
    policy: ProviderPolicy | undefined,
    values: unknown,
  ) => SettingSection[];
  /** What Inherit lands on after provider and profile settings. */
  inheritHelp: (
    policy: ProviderPolicy | undefined,
    runtime: { model?: string; effort?: string; modelReasons?: boolean },
  ) => string[];
}

export interface ProviderDefinition {
  id: string;
  metadata: ProviderMetadata;
  settings?: {
    schema: z.ZodType<Record<string, unknown>>;
    approvalRows: SettingRow[];
    restrictionSection: SettingSection;
    policy: ProviderSettingsPolicy;
  };
  taskFacts?: (task: TaskView) => Record<string, string>;
}

type Definitions = readonly [ProviderDefinition, ...ProviderDefinition[]];

let definitions: Definitions | undefined;

export function registerProviders(providers: Definitions) {
  if (definitions) throw new Error("Providers already registered");
  definitions = providers;
}

export function providerDefinitions() {
  if (!definitions) {
    throw new Error("Register providers before reading their definitions");
  }

  return definitions;
}
