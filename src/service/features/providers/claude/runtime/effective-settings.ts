import type { Settings } from "@anthropic-ai/claude-agent-sdk";

import type { EventPayloadMap } from "../../../../../shared/events/event-contract.js";
import { permissionModeName } from "../../../../../shared/providers/claude/permissions.js";
import {
  type ClaudeEffectiveSettings,
  readClaudeTaskOptions,
} from "../../../../../shared/providers/claude/task-options.js";
import { FAMILY_ALIASES } from "../../../../../shared/providers/policy.js";
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
  if (ran.includes(name) || name.includes(ran)) return true;

  return (
    FAMILY_ALIASES.includes(name) &&
    !FAMILY_ALIASES.some((family) => ran.includes(family))
  );
}

function modeReason(requested: string, actual: string, policy?: Settings) {
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

  if (init.permissionMode && init.permissionMode !== options.permission_mode) {
    after.permission_mode = init.permissionMode;
  }

  if (!modelHonored(c.task.model, init.model)) after.model = init.model;

  const { permission_mode: mode, model } = after;

  if (mode === before?.permission_mode && model === before?.model) return;
  c.effectiveOptions(after);

  const newMode = mode !== before?.permission_mode ? mode : undefined;
  const newModel = model !== before?.model ? model : undefined;
  if (!newMode && !newModel) return;

  const policy = policySettings(await readSessionSettings(session));

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
}
