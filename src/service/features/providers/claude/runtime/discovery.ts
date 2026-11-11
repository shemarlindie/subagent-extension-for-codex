import { tmpdir } from "node:os";

import {
  type Query,
  query,
  resolveSettings,
  type SDKUserMessage,
  type Settings,
} from "@anthropic-ai/claude-agent-sdk";

import {
  claudeOverrideDefaults,
  type ClaudeOverrides,
  claudePermissionModes,
  MODE_TURNED_OFF_BY_ORG,
} from "../../../../../shared/providers/claude/permissions.js";
import type {
  ModelChoice,
  ProviderPolicy,
} from "../../../../../shared/providers/types.js";
import { logError, logEvent } from "../../../../platform/logging/logger.js";
import type { ClaudeCli } from "../configuration/executable.js";
import { claudeEnvironment } from "../configuration/execution-environment.js";
import {
  policyBlocksMode,
  policySettings,
  READ_TIMEOUT_MS,
  readSessionSettings,
  type SessionSettings,
  type SettingsReader,
} from "../configuration/session-settings.js";

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

function policyNotes(policy: Settings) {
  return [
    ...(policy.allowManagedHooksOnly
      ? [{ label: "Hooks", detail: "Only your organization's hooks run." }]
      : []),
    ...(policy.allowManagedPermissionRulesOnly
      ? [
          {
            label: "Permission rules",
            detail: "Only your organization's permission rules apply.",
          },
        ]
      : []),
  ];
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

/** Whether policy sets the default effort, for every model or for one. */
const setsEffort = (policy: Settings) =>
  !!policy.effortLevel ||
  Object.values(policy.modelSettings ?? {}).some(
    ({ effortLevel }) => effortLevel,
  );

/** Each model's own reasoning cap, when policy sets any. */
function effortCaps(policy: Settings) {
  const caps = Object.entries(policy.modelSettings ?? {}).flatMap(
    ([model, { maxEffortLevel }]) =>
      maxEffortLevel ? [[model, maxEffortLevel]] : [],
  );

  return caps.length ? { model_max_effort: Object.fromEntries(caps) } : {};
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
          default_model:
            catalogEntry(models, applied.model)?.displayName ?? applied.model,
        }
      : {}),
    ...(setsEffort(policy) && applied?.effort
      ? { default_effort: applied.effort }
      : {}),
    ...(policy.maxEffortLevel ? { max_effort: policy.maxEffortLevel } : {}),
    ...effortCaps(policy),
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
  private catalog?: Discovered & { expires: number };
  private catalogRequest?: Promise<Discovered>;
  private catalogFailure?: { expires: number; error: Error };

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
    return (await this.discovered()).models;
  }

  async policy() {
    return (await this.discovered()).policy;
  }

  /** Cached briefly. A failed discovery is not retried at once. */
  private discovered(): Promise<Discovered> {
    if (this.catalog && this.catalog.expires > Date.now()) {
      return Promise.resolve(this.catalog);
    }

    if (this.catalogRequest) return this.catalogRequest;

    if (this.catalogFailure && this.catalogFailure.expires > Date.now()) {
      return Promise.reject(this.catalogFailure.error);
    }

    const request = this.discover();
    this.catalogRequest = request;

    void request
      .finally(() => {
        this.catalogRequest = undefined;
      })
      .catch((error: unknown) => {
        logError("provider.discovery_failed", error);
      });

    return request;
  }

  private async discover(): Promise<Discovered> {
    const pathToClaudeCodeExecutable = await this.cli.executable();
    const abortController = new AbortController();
    let release!: () => void;

    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });

    // Initialize the native harness without submitting a user turn or granting tools.
    // eslint-disable-next-line require-yield -- an open prompt stream that never sends a turn
    const prompt = (async function* (): AsyncGenerator<SDKUserMessage> {
      await pending;
    })();

    const session = this.launch({
      prompt,
      options: {
        pathToClaudeCodeExecutable,
        // Match the task environment and the user's settings-file policy.
        env: claudeEnvironment(process.env),
        abortController,
        persistSession: false,
        // Outside any project, so one folder's settings don't lock modes for all.
        cwd: tmpdir(),
        settingSources: this.configuration.settings_files
          ? ["user", "project", "local"]
          : [],
        // Model listing must not run the user's settings-file hooks on every refresh.
        settings: { disableAllHooks: true },
        strictMcpConfig: true,
        mcpServers: {},
        tools: [],
        permissionMode: "default",
        // Lets the policy check try Bypass. No tool can run without a turn.
        // Claude Code won't start with it as root, where Bypass can't run anyway.
        allowDangerouslySkipPermissions: !runsAsRoot(),
        canUseTool: async () => ({
          behavior: "deny",
          message: "Model discovery cannot execute tools",
        }),
      },
    }) as Query & SettingsReader;

    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      // Claude Code answers only once its org policy fetch settles, so this
      // waits as long as a task would.
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abortController.abort();
          reject(new Error("Claude model discovery timed out"));
        }, READ_TIMEOUT_MS);
      });

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

      this.catalog = {
        models: withAppliedDefault(models, read?.settings),
        ...(policy ? { policy } : {}),
        // A failed read tells nothing about policy, so it's retried soon.
        expires: Date.now() + (policyFailed ? 30000 : 5 * 60 * 1000),
      };

      this.catalogFailure = undefined;

      return this.catalog;
    } catch (error) {
      // Polling must not repeatedly launch a failing harness.
      this.catalogFailure = {
        expires: Date.now() + 30000,
        error: error instanceof Error ? error : new Error(String(error)),
      };

      throw error;
    } finally {
      clearTimeout(timer);
      release();
      session.close();
    }
  }
}
