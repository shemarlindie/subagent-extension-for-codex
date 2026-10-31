import { z } from "zod";

import type {
  SettingRow,
  SettingSection,
} from "../../settings/document-contract.js";
import { settingText } from "../../settings/setting-text.js";
import {
  claudeOverrideDefaults,
  claudeOverrideLabels,
  claudePathGuardSchema,
  claudePermissionModes,
  claudePermissionModeSchema,
  claudeSandboxSchema,
  claudeToolsSchema,
  permissionLabel,
} from "./permissions.js";

const help = {
  permission_mode:
    "Tasks use this mode unless you choose another. Your other Claude Code settings still apply while Load Claude Code settings is on.",
  sandbox:
    "Your Claude Code settings decide the sandbox by default. The extension sandbox allows writes only in the workspace and blocks home and sibling reads and the network. Locking its network also ignores domains your Claude Code settings allow.",
  tools:
    "All tools offers every Claude Code tool. The restricted set offers file, search, Bash, question, skill and MCP tools, and only read, question and skill tools to read-only work. By worker profile restricts only read-only profiles.",
  path_guard:
    "Keeps file tools inside the task workspace and out of Git metadata. By worker profile applies it only to read-only profiles.",
  subagents: "Delegated sessions may start subagents with the Agent tool.",
  settings_files:
    "Sessions load your user, project and local Claude Code settings, including instructions, skills, hooks, permission rules, sandbox settings and MCP servers. Off ignores all of them, including your deny rules and sandbox.",
  user_mcp:
    "Sessions may use MCP servers from your Claude Code configuration, such as project, user and plugin servers. This also requires Load Claude Code settings. Off leaves only the extension's own server.",
};

const userOnly = "Only you can change these settings.";

const options = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

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
    sandbox: claudeSandboxSchema
      .meta({ title: "Bash sandbox", description: help.sandbox })
      .default(claudeOverrideDefaults.sandbox),
    tools: claudeToolsSchema
      .meta({ title: "Tools", description: help.tools })
      .default(claudeOverrideDefaults.tools),
    path_guard: claudePathGuardSchema
      .meta({ title: "Workspace path guard", description: help.path_guard })
      .default(claudeOverrideDefaults.path_guard),
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
    {
      kind: "select",
      ...row("sandbox"),
      options: options(claudeOverrideLabels.sandbox),
    },
    {
      kind: "select",
      ...row("tools"),
      options: options(claudeOverrideLabels.tools),
    },
    {
      kind: "select",
      ...row("path_guard"),
      options: options(claudeOverrideLabels.path_guard),
    },
    { kind: "switch", ...row("subagents") },
    { kind: "switch", ...row("settings_files") },
    { kind: "switch", ...row("user_mcp") },
  ],
};
