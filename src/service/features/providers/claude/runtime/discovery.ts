import { tmpdir } from "node:os";

import {
  query,
  resolveSettings,
  type Query,
  type Settings,
} from "@anthropic-ai/claude-agent-sdk";

import {
  claudeOverrideDefaults,
  claudePermissionModes,
  MODE_TURNED_OFF_BY_ORG,
  type ClaudeOverrides,
} from "../../../../../shared/providers/claude/permissions.js";
import type {
  ModelChoice,
  ProviderPolicy,
} from "../../../../../shared/providers/types.js";
import { logError, logEvent } from "../../../../platform/logging/logger.js";
import type { ClaudeCli } from "../configuration/executable.js";
import {
  policyBlocksMode,
  policySettings,
  readSessionSettings,
  type SessionSettings,
  type SettingsReader,
} from "../configuration/session-settings.js";
import { otherPolicyKeys, policyNotes } from "./policy-notes.js";
import { CachedRead, READ_CACHE_MS, turnlessSession } from "./session-reads.js";

type Discovered = { models: ModelChoice[]; policy?: ProviderPolicy };

const SETTINGS_REASON = "Not available with your Claude Code setup";

const runsAsRoot = () =>
  process.getuid?.() === 0 && process.env.IS_SANDBOX !== "1";

/** Modes the session refuses to switch to, which a task would lose too. */
async function blockedModes(session: Query, policy: Settings | undefined) {
  const blocked: ProviderPolicy["blocked"] = [];

  for (const value of claudePermissionModes) {
    if (value === "default") continue;

    try {
      await session.setPermissionMode(value);
    } catch (error) {
      // Anything else, such as the session ending, says nothing about the mode.
      if (!/permission mode/i.test(String(error))) throw error;

      blocked.push({
        value,
        reason: policyBlocksMode(value, policy)
          ? MODE_TURNED_OFF_BY_ORG
          : SETTINGS_REASON,
      });
    }
  }

  return blocked;
}

/**
 * Where policy comes from. `resolveSettings` sees what's on this computer and
 * not the admin console's, so policy only the session sees is the console's.
 */
async function policySource(
  resolve: typeof resolveSettings,
): Promise<ProviderPolicy["source"]> {
  try {
    const managed = (await resolve()).sources.find(
      ({ source }) => source === "managed",
    );

    return !managed || managed.policyOrigin === "remote" ? "console" : "device";
  } catch (error) {
    logError("provider.policy_source_failed", error);

    return undefined;
  }
}

/** The catalog's entry for a model ID, other than Default. */
const catalogEntry = (models: ModelChoice[], model: string) =>
  models.find(
    ({ value, resolvedModel }) =>
      value !== "default" && resolvedModel === model,
  );

/** Each model's own reasoning default or cap, by model name, when policy sets any. */
function byModel(
  policy: Settings,
  setting: "effortLevel" | "maxEffortLevel",
  field: "model_default_effort" | "model_max_effort",
) {
  const levels = Object.entries(policy.modelSettings ?? {}).flatMap(
    ([model, settings]) =>
      settings[setting] ? [[model, settings[setting]]] : [],
  );

  return levels.length ? { [field]: Object.fromEntries(levels) } : {};
}

/**
 * The Default entry as the model it runs. Claude Code's own description
 * follows an org's allowlist, and misses a model that settings or policy set.
 */
function withAppliedDefault(
  models: ModelChoice[],
  settings: SessionSettings | undefined,
) {
  const applied = settings?.applied?.model;
  const org = !!policySettings(settings)?.model;

  return models.map((choice) => {
    if (
      choice.value !== "default" ||
      !applied ||
      choice.resolvedModel === applied
    ) {
      return choice;
    }

    const match = catalogEntry(models, applied);

    return {
      ...choice,
      resolvedModel: applied,
      description: `Use the default model (currently ${match?.displayName ?? applied})${org ? " · Set by your organization" : ""}`,
      ...(match
        ? {
            supportsEffort: match.supportsEffort,
            supportedEffortLevels: match.supportedEffortLevels,
          }
        : {}),
    };
  });
}

/** What applies to new tasks, given the session's settings. */
async function policyFrom(
  session: Query,
  settings: SessionSettings | undefined,
  models: ModelChoice[],
  resolve: typeof resolveSettings,
): Promise<ProviderPolicy | undefined> {
  const policy = policySettings(settings);
  const applied = settings?.applied;
  const modes = await blockedModes(session, policy);

  if (!policy) {
    return modes.length
      ? { managed: false, blocked: modes, notes: [] }
      : undefined;
  }

  const source = await policySource(resolve);

  return {
    managed: true,
    ...(source ? { source } : {}),
    blocked: modes,
    ...(policy.availableModels
      ? {
          available_models: policy.availableModels,
          available_models_match: policy.availableModelsMatch ?? "prefix",
        }
      : {}),
    ...(policy.model && applied
      ? {
          default_model: {
            id: applied.model,
            name:
              catalogEntry(models, applied.model)?.displayName ?? applied.model,
          },
        }
      : {}),
    ...(policy.effortLevel ? { default_effort: policy.effortLevel } : {}),
    ...byModel(policy, "effortLevel", "model_default_effort"),
    ...(policy.maxEffortLevel ? { max_effort: policy.maxEffortLevel } : {}),
    ...byModel(policy, "maxEffortLevel", "model_max_effort"),
    ...(policy.permissions?.denyInsteadOfPrompting
      ? { prompts_denied: true }
      : {}),
    notes: policyNotes(policy),
  };
}

/** Reads the session's settings and policy, and logs what was found. */
async function readPolicy(
  session: Query & SettingsReader,
  models: ModelChoice[],
  resolve: typeof resolveSettings,
) {
  const settings = await readSessionSettings(session);
  const found = await policyFrom(session, settings, models, resolve);

  logEvent("info", "provider.policy_read", {
    // Without the session's settings, whether policy applies is unknown.
    settings_read: !!settings,
    managed: settings ? (found?.managed ?? false) : undefined,
    source: found?.source,
    blocked: found?.blocked.map(({ value }) => value).join(","),
    available_models: found?.available_models?.join(","),
    notes: found?.notes.map(({ label }) => label).join(","),
    other_keys: otherPolicyKeys(policySettings(settings) ?? {}).join(","),
    applied_model: settings?.applied?.model,
    applied_effort: settings?.applied?.effort ?? undefined,
  });

  return { settings, policy: found };
}

/**
 * The models the installed Claude Code offers and the policy that applies, read
 * by starting the native harness without a turn. It follows the same rules as a
 * task's session, so its answer is what a task would get. Polling reads the
 * cache, and a failure is remembered briefly so a broken runtime isn't
 * relaunched on every read.
 */
export class ClaudeDiscovery {
  private catalog = new CachedRead<Discovered>(
    () => this.discover(),
    "provider.discovery_failed",
  );

  constructor(
    private launch: typeof query,
    private cli: Pick<ClaudeCli, "executable">,
    private configuration: Pick<
      ClaudeOverrides,
      "settings_files"
    > = claudeOverrideDefaults,
    private resolve: typeof resolveSettings = resolveSettings,
  ) {}

  async models() {
    return (await this.catalog.get()).models;
  }

  async policy() {
    return (await this.catalog.get()).policy;
  }

  private async discover() {
    const turnless = turnlessSession(
      this.launch,
      this.configuration.settings_files,
      {
        pathToClaudeCodeExecutable: await this.cli.executable(),
        // Outside any project, so one folder's settings don't lock modes for all.
        cwd: tmpdir(),
        permissionMode: "default",
        // Lets the policy check try Bypass. No tool can run without a turn.
        // Claude Code won't start with it as root, where Bypass can't run anyway.
        allowDangerouslySkipPermissions: !runsAsRoot(),
        canUseTool: async () => ({
          behavior: "deny",
          message: "Model discovery cannot execute tools",
        }),
      },
    );

    const { session, timeout } = turnless;

    try {
      const models = await Promise.race([session.supportedModels(), timeout]);

      // Widened because a callback sets it, which TypeScript can't see.
      let policyFailed = false as boolean;

      // Models stay useful without it, and tasks are still checked as they run.
      const read = await Promise.race([
        readPolicy(session, models, this.resolve),
        timeout,
      ]).catch((error: unknown) => {
        logError("provider.policy_read_failed", error);
        policyFailed = true;

        return undefined;
      });

      const policy = read?.policy;

      return {
        result: {
          models: withAppliedDefault(models, read?.settings),
          ...(policy ? { policy } : {}),
        },
        // A failed read tells nothing about policy, so it's retried soon.
        expires: Date.now() + (policyFailed ? 30000 : READ_CACHE_MS),
      };
    } finally {
      turnless.close();
    }
  }
}
