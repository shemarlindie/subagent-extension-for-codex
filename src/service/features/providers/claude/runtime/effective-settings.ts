import type { Settings } from "@anthropic-ai/claude-agent-sdk";

import type { ClaudePermissionMode } from "../../../../../shared/providers/claude/permissions.js";
import {
  permissionLabel,
  shortPermissionLabel,
} from "../../../../../shared/providers/claude/permissions.js";
import {
  type ClaudeEffectiveSettings,
  readClaudeTaskOptions,
} from "../../../../../shared/providers/claude/task-options.js";
import type { RunContext } from "../../types.js";
import {
  policyBlocksMode,
  policySettings,
  readSessionSettings,
  type SettingsReader,
} from "../configuration/session-settings.js";

/** Model choices that name no fixed model, so any model can honor them. */
const FLEXIBLE_MODELS = ["default", "best", "opusplan"];

/** Whether a session runs the model asked for: `opus[1m]` matches `claude-opus-5-5`. */
export function modelHonored(requested: string | undefined, actual: string) {
  const name = requested?.replace(/\[.*\]$/, "");

  return !name || FLEXIBLE_MODELS.includes(name) || actual.includes(name);
}

const modeName = (mode: string) =>
  shortPermissionLabel(permissionLabel(mode as ClaudePermissionMode));

function modeReason(requested: string, actual: string, policy?: Settings) {
  const why = policyBlocksMode(requested, policy)
    ? `Your organization turned off ${modeName(requested)}.`
    : `Claude Code doesn't allow ${modeName(requested)} for this session.`;

  return `Running with ${modeName(actual)}. ${why}`;
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

  if (newMode) {
    c.emit("agent.limited", {
      setting: "permission_mode",
      requested: options.permission_mode,
      effective: newMode,
      reason: modeReason(options.permission_mode, newMode, policy),
    });
  }

  if (newModel) {
    c.emit("agent.limited", {
      setting: "model",
      requested: c.task.model!,
      effective: newModel,
      reason: modelReason(c.task.model!, newModel, policy),
    });
  }
}
