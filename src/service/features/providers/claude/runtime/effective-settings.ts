import type { Settings } from "@anthropic-ai/claude-agent-sdk";

import type { EventPayloadMap } from "../../../../../shared/events/event-contract.js";
import {
  type ClaudePermissionMode,
  permissionModeName,
} from "../../../../../shared/providers/claude/permissions.js";
import {
  type ClaudeEffectiveSettings,
  readClaudeTaskOptions,
} from "../../../../../shared/providers/claude/task-options.js";
import {
  FAMILY_ALIASES,
  isModelVariant,
} from "../../../../../shared/providers/policy.js";
import { titleCase } from "../../../../../shared/text.js";
import { logEvent } from "../../../../platform/logging/logger.js";
import type { RunContext } from "../../types.js";
import {
  policyBlocksMode,
  policySettings,
  readSessionSettings,
  type SettingsReader,
} from "../configuration/session-settings.js";

/** Model choices that name no fixed model, so any model can honor them. */
const FLEXIBLE_MODELS = ["default", "best", "opusplan"];

/**
 * Whether a session runs the model asked for: `opus[1m]` matches
 * `claude-opus-5-5`, and `claude-opus-5-5-fast` matches `claude-opus-5-5`. An
 * alias can be remapped to any ID, so only another family counts against it.
 */
export function modelHonored(requested: string | undefined, actual: string) {
  const name = requested?.replace(/\[.*\]$/, "");
  const ran = actual.replace(/\[.*\]$/, "");

  if (!name || FLEXIBLE_MODELS.includes(name)) return true;
  if (ran.includes(name) || isModelVariant(name, ran)) return true;

  return (
    FAMILY_ALIASES.includes(name) &&
    !FAMILY_ALIASES.some((family) => ran.includes(family))
  );
}

function modeReason(
  requested: ClaudePermissionMode,
  actual: string,
  policy?: Settings,
) {
  const why = policyBlocksMode(requested, policy)
    ? `Your organization turned off ${permissionModeName(requested)}.`
    : `Claude Code doesn't allow ${permissionModeName(requested)} for this session.`;

  return `Running with ${permissionModeName(actual)}. ${why}`;
}

function modelReason(requested: string, actual: string, policy?: Settings) {
  return policy?.availableModels || policy?.deniedModels
    ? `Running with ${actual}. Your organization doesn't allow ${requested}.`
    : `Running with ${actual} instead of ${requested}.`;
}

/** Whether policy caps reasoning, for every model or for one. */
const capsEffort = (policy?: Settings) =>
  !!policy?.maxEffortLevel ||
  Object.values(policy?.modelSettings ?? {}).some(
    ({ maxEffortLevel }) => maxEffortLevel,
  );

/**
 * Policy's cap is the likely reason. An org's per-model cap from the admin
 * console doesn't show in its policy, so other causes read plainly.
 */
const effortReason = (requested: string, actual: string, policy?: Settings) =>
  capsEffort(policy)
    ? `Running with ${titleCase(actual)} reasoning. Your organization doesn't allow ${titleCase(requested)}.`
    : `Running with ${titleCase(actual)} reasoning instead of ${titleCase(requested)}.`;

const EFFECTIVE_KEYS = ["permission_mode", "model", "effort"] as const;

/**
 * Compares what a session started with to what the task asked for, stores the
 * difference and reports each new one. Claude Code changes these silently when
 * policy rules them out. The requested values stay as the task's record.
 */
export async function recordEffectiveSettings(
  c: RunContext,
  init: { permissionMode?: string; model: string },
  session: SettingsReader,
) {
  const options = readClaudeTaskOptions(c.task);
  const before = options.effective;
  const after: ClaudeEffectiveSettings = {};
  const effort = c.task.reasoning_effort;

  if (init.permissionMode && init.permissionMode !== options.permission_mode) {
    after.permission_mode = init.permissionMode;
  }

  if (!modelHonored(c.task.model, init.model)) after.model = init.model;

  // Claude Code reports the effort it runs only when asked.
  const settings =
    effort && effort !== "default"
      ? await readSessionSettings(session)
      : undefined;

  const applied = settings?.applied?.effort;
  if (applied && applied !== effort) after.effort = applied;

  const changed = EFFECTIVE_KEYS.filter((key) => after[key] !== before?.[key]);
  if (!changed.length) return;
  c.effectiveOptions(after);

  const fresh = (key: (typeof EFFECTIVE_KEYS)[number]) =>
    changed.includes(key) ? after[key] : undefined;

  const newMode = fresh("permission_mode");
  const newModel = fresh("model");
  const newEffort = fresh("effort");
  if (!newMode && !newModel && !newEffort) return;

  const policy = policySettings(
    settings ?? (await readSessionSettings(session)),
  );

  const report = (limit: EventPayloadMap["agent.limited"]) => {
    const { setting, requested, effective } = limit;

    logEvent("info", "provider.settings_limited", {
      setting,
      requested,
      effective,
    });

    c.emit("agent.limited", limit);
  };

  if (newMode) {
    report({
      setting: "permission_mode",
      requested: options.permission_mode,
      effective: newMode,
      reason: modeReason(options.permission_mode, newMode, policy),
    });
  }

  if (newModel) {
    report({
      setting: "model",
      requested: c.task.model!,
      effective: newModel,
      reason: modelReason(c.task.model!, newModel, policy),
    });
  }

  if (newEffort) {
    report({
      setting: "reasoning_effort",
      requested: effort!,
      effective: newEffort,
      reason: effortReason(effort!, newEffort, policy),
    });
  }
}
