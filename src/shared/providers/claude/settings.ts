import { z } from "zod";

import type {
  SettingRow,
  SettingSection,
} from "../../settings/document-contract.js";
import { settingText } from "../../settings/setting-text.js";
import {
  claudeOverrideDefaults,
  claudePermissionModes,
  claudePermissionModeSchema,
  permissionLabel,
} from "./permissions.js";

const help = {
  permission_mode:
    "Tasks use this mode unless you choose another. Your other Claude Code settings still apply while Load Claude Code settings is on.",
  sandbox:
    "Runs Bash commands in Claude Code's sandbox, and stops a task when the sandbox can't run. Your Claude Code settings and your organization's policy decide the rest. Off leaves the sandbox to your Claude Code settings. Codex can turn it on for a task, and only you can turn it off.",
  subagents: "Delegated sessions may start subagents with the Agent tool.",
  settings_files:
    "Sessions load your user, project and local Claude Code settings, including instructions, skills, hooks, permission rules, sandbox settings and MCP servers. Off ignores all of them, including your deny rules and sandbox.",
  user_mcp:
    "Sessions may use MCP servers from your Claude Code configuration, such as project, user and plugin servers. This also requires Load Claude Code settings. Off leaves only the extension's own server.",
};

const userOnly = "Only you can change these settings.";

/** Claude's settings block, saved under `providers.claude`. */
export const claudeSettingsSchema = z
  .strictObject({
    permission_mode: claudePermissionModeSchema
      .meta({
        title: "Claude permission mode",
        description: help.permission_mode,
      })
      .default("default"),
    // Restriction titles drop "Claude": their settings group already names it.
    sandbox: z
      .boolean()
      .meta({ title: "Bash sandbox", description: help.sandbox })
      .default(claudeOverrideDefaults.sandbox),
    subagents: z
      .boolean()
      .meta({ title: "Allow subagents", description: help.subagents })
      .default(claudeOverrideDefaults.subagents),
    settings_files: z
      .boolean()
      .meta({
        title: "Load Claude Code settings",
        description: help.settings_files,
      })
      .default(claudeOverrideDefaults.settings_files),
    user_mcp: z
      .boolean()
      .meta({ title: "Your MCP servers", description: help.user_mcp })
      .default(claudeOverrideDefaults.user_mcp),
  })
  .prefault({});

const field = claudeSettingsSchema.unwrap().shape;

const row = (key: keyof typeof field) => ({
  path: `providers.claude.${key}`,
  ...settingText(field[key]),
});

export const claudeApprovalRows: SettingRow[] = [
  {
    kind: "select",
    ...row("permission_mode"),
    options: claudePermissionModes.map((mode) => ({
      value: mode,
      label: permissionLabel(mode),
    })),
  },
];

export const claudeRestrictionsSection: SettingSection = {
  id: "restrictions",
  title: "Claude session restrictions",
  help: [
    `Limits on delegated Claude sessions, in every permission mode. ${userOnly}`,
  ],
  rows: [
    { kind: "switch", ...row("sandbox") },
    { kind: "switch", ...row("subagents") },
    { kind: "switch", ...row("settings_files") },
    { kind: "switch", ...row("user_mcp") },
  ],
};
