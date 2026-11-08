import type { AboutInfo } from "../../../src/shared/about/types";
import type { ProviderReadiness } from "../../../src/shared/providers/types";

export const previewAbout = (
  claude: ProviderReadiness,
  behind: boolean,
): AboutInfo => ({
  build: {
    version: "0.2.0",
    built_at: "2026-11-08T09:30:00.000Z",
    commit: "d9f4c3a7b812e6a05df9d82b4ca9135e670abc12",
    dirty: true,
    sdks: [
      { name: "@anthropic-ai/claude-agent-sdk", version: "0.3.319" },
      { name: "@modelcontextprotocol/sdk", version: "1.32.2" },
      { name: "@modelcontextprotocol/ext-apps", version: "1.7.5" },
    ],
  },
  installation: "checkout",
  runtime: {
    node: "24.21.0",
    platform: "darwin",
    arch: "arm64",
    launcher: "stdio",
  },
  claude,
  claude_recommended: { version: "2.1.319", behind },
  claude_upgrade: {
    installation: "Homebrew (stable)",
    command: "'/opt/homebrew/bin/brew' upgrade --cask claude-code",
    note: "Run in a terminal after delegated turns finish. This keeps the installed cask and release channel. Recheck afterward.",
  },
});
