import type { ProviderReadiness } from "../../../src/shared/providers/types";

const previewClaudeReady = {
  ready: true,
  details: {
    executable: "/opt/homebrew/Caskroom/claude-code/2.1.328/claude",
    version: "2.1.328",
    supported_versions: "2.1.324+",
  },
} satisfies ProviderReadiness;

/** A ready CLI, whose claude.ai sign-in ends in six days when `signInEnding`. */
export const previewClaudeReadiness = (
  signInEnding?: boolean,
): ProviderReadiness =>
  signInEnding
    ? {
        ...previewClaudeReady,
        credential_expires_at: new Date(
          Date.now() + 6 * 86_400_000,
        ).toISOString(),
      }
    : previewClaudeReady;

/** A located CLI that is older than the supported range. */
export const previewClaudeUnavailable = {
  ready: false,
  message:
    "Claude Code 2.1.200 at /opt/homebrew/Caskroom/claude-code/2.1.200/claude is older than the supported 2.1.324+. Update it using its original installer (see https://code.claude.com/docs/en/setup), or set SUBAGENT_EXTENSION_FOR_CODEX_CLAUDE_PATH to a supported copy.",
  details: {
    problem: "too_old",
    executable: "/opt/homebrew/Caskroom/claude-code/2.1.200/claude",
    version: "2.1.200",
    supported_versions: "2.1.324+",
  },
} satisfies ProviderReadiness;
