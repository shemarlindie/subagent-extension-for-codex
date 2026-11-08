import type { ProviderReadiness } from "../../../src/shared/providers/types";

export const previewClaudeReady = {
  ready: true,
  details: {
    executable: "/opt/homebrew/Caskroom/claude-code/2.1.319/claude",
    version: "2.1.319",
    supported_versions: "2.1.300+",
  },
} satisfies ProviderReadiness;

/** A located CLI that is older than the supported range. */
export const previewClaudeUnavailable = {
  ready: false,
  message:
    "Claude Code 2.1.200 at /opt/homebrew/Caskroom/claude-code/2.1.200/claude is older than the supported 2.1.300+. Update it using its original installer (see https://code.claude.com/docs/en/setup), or set SUBAGENT_EXTENSION_FOR_CODEX_CLAUDE_PATH to a supported copy.",
  details: {
    problem: "too_old",
    executable: "/opt/homebrew/Caskroom/claude-code/2.1.200/claude",
    version: "2.1.200",
    supported_versions: "2.1.300+",
  },
} satisfies ProviderReadiness;
