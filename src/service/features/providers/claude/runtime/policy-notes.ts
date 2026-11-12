import type { Settings } from "@anthropic-ai/claude-agent-sdk";

type Note = { label: string; detail: string };

/**
 * Policy keys the panel already shows or applies, by dotted path. A key under
 * one of these counts as covered too.
 */
const COVERED = [
  "permissions.disableBypassPermissionsMode",
  "permissions.disableAutoMode",
  "disableAutoMode",
  "availableModels",
  "availableModelsMatch",
  "enforceAvailableModels",
  "deniedModels",
  "allowManagedHooksOnly",
  "allowManagedPermissionRulesOnly",
  "model",
  "effortLevel",
  "maxEffortLevel",
  "modelSettings",
  "permissions.denyInsteadOfPrompting",
  "sandbox.enabled",
  "sandbox.failIfUnavailable",
  "sandbox.network.allowManagedDomainsOnly",
  "allowedMcpServers",
  "deniedMcpServers",
  "allowManagedMcpServersOnly",
  "managedMcpServers",
  "strictPluginOnlyCustomization",
  "permissions.allow",
  "permissions.deny",
  "permissions.ask",
  "permissions.blockReadsOutsideWorkingDirectories",
  "permissions.blockWritesOutsideWorkingDirectories",
  "claudeMd",
  "alwaysThinkingEnabled",
  "fallbackModel",
  // Tasks always pass a mode, so the org's default mode has no effect.
  "permissions.defaultMode",
];

/**
 * Top-level keys that can't change what a task does: terminal UI, sign-in and
 * provider routing, plugins and marketplaces, Remote Control, workflows,
 * attribution, retention and version bounds. A key Claude Code adds later
 * shows in "Also set" until someone sorts it.
 */
const IGNORED = new Set([
  "$schema",
  // Terminal UI
  "outputStyle",
  "viewMode",
  "language",
  "syntaxHighlightingDisabled",
  "maxProseWidth",
  "spellcheck",
  "terminalTitleFromRename",
  "statusLine",
  "subagentStatusLine",
  "prUrlTemplate",
  "footerLinksRegexes",
  "theme",
  "editorMode",
  "keybindingFlavor",
  "vimInsertModeRemaps",
  "verbose",
  "preferredNotifChannel",
  "autoScrollEnabled",
  "wheelScrollAccelerationEnabled",
  "showTurnDuration",
  "showMessageTimestamps",
  "showThinkingSummaries",
  "showClearContextOnPlanAccept",
  "terminalProgressBarEnabled",
  "tui",
  "prefersReducedMotion",
  "timeFormat",
  "timeZone",
  "companyAnnouncements",
  "feedbackSurveyRate",
  "feedbackDrafts",
  "emojiCompletionEnabled",
  "promptSuggestionEnabled",
  "defaultView",
  "inputNeededNotifEnabled",
  "agentPushNotifEnabled",
  "disableAgentView",
  "fileSuggestion",
  "teammateMode",
  "disableArtifact",
  "enableArtifact",
  // Sign-in and provider
  "apiKeyHelper",
  "proxyAuthHelper",
  "awsCredentialExport",
  "awsAuthRefresh",
  "gcpAuthRefresh",
  "otelHeadersHelper",
  "env",
  "gatewayInternalNetworks",
  "allowedProviders",
  "forceRemoteSettingsRefresh",
  "modelOverrides",
  "modelPricing",
  // Plugins and marketplaces
  "enabledPlugins",
  "prependPlugins",
  "appendPlugins",
  "pluginConfigs",
  "pluginTrustMessage",
  "pluginSuggestionMarketplaces",
  "extraKnownMarketplaces",
  "additionalMarketplaces",
  "strictKnownMarketplaces",
  "allowedMarketplaces",
  "blockedMarketplaces",
  "disableCommandPluginSources",
  "disableSideloadFlags",
  "syncClaudeAiPlugins",
  // Remote Control
  "remote",
  "remoteControlAtStartup",
  "disableRemoteControl",
  "isolatePeerMachines",
  "daemonColdStart",
  "crossSessionInbound",
  "autoUploadSessions",
  "channelsEnabled",
  "allowedChannelPlugins",
  "sshConfigs",
  "sshHostCommands",
  "disableDeepLinkRegistration",
  // Workflows
  "disableWorkflows",
  "enableWorkflows",
  "workflowSizeGuideline",
  "workflowKeywordTriggerEnabled",
  // Attribution
  "attribution",
  "attributionProject",
  "attributionProjectPolicy",
  "includeCoAuthoredBy",
  // Retention
  "cleanupPeriodDays",
  "desktopSessionCleanupPeriodDays",
  // Version bounds and how settings sources combine
  "autoUpdatesChannel",
  "minimumVersion",
  "requiredMinimumVersion",
  "requiredMaximumVersion",
  "managedSourcesBehavior",
  "parentSettingsBehavior",
]);

const isLogin = (key: string) => key.startsWith("forceLogin");

/** Groups whose nested keys are listed one by one. */
const NESTED = new Set(["permissions", "sandbox"]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Every set key's dotted path, opening the nested groups. */
function setPaths(value: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, item]) => {
    if (item === undefined || item === null) return [];

    const path = prefix + key;
    const nested = NESTED.has(prefix.split(".")[0] || key);

    return nested && isObject(item) ? setPaths(item, `${path}.`) : [path];
  });
}

const covered = (path: string) =>
  COVERED.some((key) => path === key || path.startsWith(`${key}.`));

/** Set keys no row covers and that can affect tasks, for "Also set". */
export function otherPolicyKeys(policy: Settings) {
  return setPaths(policy).filter((path) => {
    const top = path.split(".")[0]!;

    return !covered(path) && !IGNORED.has(top) && !isLogin(top);
  });
}

type Details = (policy: Settings) => (string | false | undefined)[];

/** Each row's sentences, of which those that apply are shown. */
const NOTES: [label: string, details: Details][] = [
  [
    "Hooks",
    (p) => [p.allowManagedHooksOnly && "Only your organization's hooks run."],
  ],
  [
    "Permission rules",
    ({ allowManagedPermissionRulesOnly, permissions: rules }) => [
      allowManagedPermissionRulesOnly &&
        "Only your organization's permission rules apply.",
      !!(rules?.allow || rules?.deny || rules?.ask) &&
        "Your organization allows or blocks some tools without asking.",
    ],
  ],
  [
    "File access",
    ({ permissions }) => [
      permissions?.blockReadsOutsideWorkingDirectories &&
        "Reads outside the workspace are blocked.",
      permissions?.blockWritesOutsideWorkingDirectories &&
        "Writes outside the workspace are blocked.",
    ],
  ],
  [
    "Sandbox",
    ({ sandbox }) => [
      sandbox?.enabled && "Bash runs in the sandbox.",
      sandbox?.failIfUnavailable && "A task stops when it can't run.",
      sandbox?.network?.allowManagedDomainsOnly &&
        "Only your organization's domains are reachable.",
    ],
  ],
  [
    "MCP servers",
    (p) => [
      p.allowManagedMcpServersOnly
        ? "Only your organization's servers run."
        : !!(p.allowedMcpServers || p.deniedMcpServers) &&
          "Your organization limits which servers run.",
      !!p.managedMcpServers && "Your organization adds its own servers.",
      !!p.strictPluginOnlyCustomization &&
        "Only plugins can add servers and other customizations.",
    ],
  ],
  [
    "Instructions",
    (p) => [!!p.claudeMd && "Your organization adds instructions."],
  ],
  [
    "Thinking",
    (p) => [p.alwaysThinkingEnabled === false && "Extended thinking is off."],
  ],
  [
    "Fallback",
    (p) => [
      !!p.fallbackModel?.length &&
        "Another model runs when the chosen one is unavailable.",
    ],
  ],
  [
    "Also set",
    (p) => {
      const others = otherPolicyKeys(p);

      return [others.length > 0 && `${others.join(", ")}.`];
    },
  ],
];

/**
 * Other active policy as plain-language rows. They say what applies, without
 * values that may be long or sensitive, such as rules, instructions or server
 * URLs.
 */
export const policyNotes = (policy: Settings): Note[] =>
  NOTES.flatMap(([label, details]) => {
    const set = details(policy).filter(Boolean);

    return set.length ? [{ label, detail: set.join(" ") }] : [];
  });
