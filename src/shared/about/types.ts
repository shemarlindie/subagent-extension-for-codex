import type { ProviderReadiness } from "../providers/types.js";

export interface ClaudeUpgradeInfo {
  installation: string;
  /** Only provided when the command targets the detected installation. POSIX shell syntax. */
  command?: string;
  note: string;
}

export interface ExtensionBuildInfo {
  version: string;
  /** UTC build timestamp captured by the bundler. Absent for source runs. */
  built_at?: string;
  commit?: string;
  dirty?: boolean;
  sdks: { name: string; version: string }[];
}

export interface AboutInfo {
  build: ExtensionBuildInfo;
  installation: "checkout" | "package";
  runtime: { node: string; platform: string; arch: string; launcher: string };
  claude?: ProviderReadiness;
  /** The CLI release the bundled SDK pairs with. Only set when the CLI version is known. */
  claude_recommended?: { version: string; behind: boolean };
  claude_upgrade?: ClaudeUpgradeInfo;
}
