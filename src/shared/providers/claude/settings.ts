import { z } from "zod";

import type {
  SettingRow,
  SettingSection,
} from "../../settings/settings-document.js";
import {
  approvalDeciderSchema,
  claudeEnvironmentSchema,
  claudeOverrideDefaults,
  claudeOverrideLabels,
  claudePathGuardSchema,
  claudePermissionModes,
  claudePermissionModeSchema,
  claudeSandboxSchema,
  claudeToolsSchema,
  permissionLabel,
} from "./permissions.js";

export const claudeSettingHelp = {
  claude_permission_mode:
    "Tasks use this mode unless you choose another. Your other Claude Code settings still apply while Load Claude Code settings is on.",
  claude_sandbox:
    "Your Claude Code settings decide the sandbox by default. The extension sandbox allows writes only in the workspace and blocks home and sibling reads and the network. Locking its network also ignores domains your Claude Code settings allow.",
  claude_environment:
    "The full environment is the service's, minus the extension's secrets. The filtered allowlist passes only basic process variables and Claude credentials.",
  claude_tools:
    "All tools offers every Claude Code tool. The restricted set offers file, search, Bash, question, skill and MCP tools, and only read, question and skill tools to read-only work. By worker profile restricts only read-only profiles.",
  claude_path_guard:
    "Keeps file tools inside the task workspace and out of Git metadata. By worker profile applies it only to read-only profiles.",
  claude_subagents:
    "Delegated sessions may start subagents with the Agent tool.",
  claude_settings_files:
    "Sessions load your user, project and local Claude Code settings, including instructions, skills, hooks, permission rules, sandbox settings and MCP servers. Off ignores all of them, including your deny rules and sandbox.",
  claude_user_mcp:
    "Sessions may use MCP servers from your Claude Code configuration, such as project, user and plugin servers. This also requires Load Claude Code settings. Off leaves only the extension's own server.",
  default_approval_decider:
    "Who answers permission prompts that Claude Code doesn't decide itself.",
};

const settingHelp = claudeSettingHelp;
const userOnly = "Only you can change these settings.";

const options = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

export const claudeSettingsShape = {
  claude_permission_mode: claudePermissionModeSchema.meta({
    title: "Claude permission mode",
    description: settingHelp.claude_permission_mode,
  }),
  // Restriction titles drop "Claude": their settings group already names it.
  claude_sandbox: claudeSandboxSchema.meta({
    title: "Bash sandbox",
    description: settingHelp.claude_sandbox,
  }),
  claude_environment: claudeEnvironmentSchema.meta({
    title: "Environment",
    description: settingHelp.claude_environment,
  }),
  claude_tools: claudeToolsSchema.meta({
    title: "Tools",
    description: settingHelp.claude_tools,
  }),
  claude_path_guard: claudePathGuardSchema.meta({
    title: "Workspace path guard",
    description: settingHelp.claude_path_guard,
  }),
  claude_subagents: z.boolean().meta({
    title: "Allow subagents",
    description: settingHelp.claude_subagents,
  }),
  claude_settings_files: z.boolean().meta({
    title: "Load Claude Code settings",
    description: settingHelp.claude_settings_files,
  }),
  claude_user_mcp: z.boolean().meta({
    title: "Your MCP servers",
    description: settingHelp.claude_user_mcp,
  }),
  default_approval_decider: approvalDeciderSchema.meta({
    title: "Approval decision maker",
    description: settingHelp.default_approval_decider,
  }),
};

export const claudeStoredSettingsShape = {
  claude_permission_mode: claudePermissionModeSchema.default("default"),
  default_approval_decider: approvalDeciderSchema.default("user"),
  claude_sandbox: claudeSandboxSchema.default(
    claudeOverrideDefaults.claude_sandbox,
  ),
  claude_environment: claudeEnvironmentSchema.default(
    claudeOverrideDefaults.claude_environment,
  ),
  claude_tools: claudeToolsSchema.default(claudeOverrideDefaults.claude_tools),
  claude_path_guard: claudePathGuardSchema.default(
    claudeOverrideDefaults.claude_path_guard,
  ),
  claude_subagents: z
    .boolean()
    .default(claudeOverrideDefaults.claude_subagents),
  claude_settings_files: z
    .boolean()
    .default(claudeOverrideDefaults.claude_settings_files),
  claude_user_mcp: z.boolean().default(claudeOverrideDefaults.claude_user_mcp),
};

export const claudeApprovalRows: SettingRow[] = [
  {
    kind: "select",
    key: "claude_permission_mode",
    label: "Claude permission mode",
    help: [settingHelp.claude_permission_mode],
    options: claudePermissionModes.map((mode) => ({
      value: mode,
      label: permissionLabel(mode),
    })),
  },
  {
    kind: "select",
    key: "default_approval_decider",
    label: "Approval decision maker",
    help: [settingHelp.default_approval_decider],
    options: options({ user: "User", parent_agent: "Parent agent" }),
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
      key: "claude_sandbox",
      label: "Bash sandbox",
      help: [settingHelp.claude_sandbox],
      options: options(claudeOverrideLabels.claude_sandbox),
    },
    {
      kind: "select",
      key: "claude_environment",
      label: "Environment",
      help: [settingHelp.claude_environment],
      options: options(claudeOverrideLabels.claude_environment),
    },
    {
      kind: "select",
      key: "claude_tools",
      label: "Tools",
      help: [settingHelp.claude_tools],
      options: options(claudeOverrideLabels.claude_tools),
    },
    {
      kind: "select",
      key: "claude_path_guard",
      label: "Workspace path guard",
      help: [settingHelp.claude_path_guard],
      options: options(claudeOverrideLabels.claude_path_guard),
    },
    {
      kind: "switch",
      key: "claude_subagents",
      label: "Allow subagents",
      help: [settingHelp.claude_subagents],
    },
    {
      kind: "switch",
      key: "claude_settings_files",
      label: "Load Claude Code settings",
      help: [settingHelp.claude_settings_files],
    },
    {
      kind: "switch",
      key: "claude_user_mcp",
      label: "Your MCP servers",
      help: [settingHelp.claude_user_mcp],
    },
  ],
};
