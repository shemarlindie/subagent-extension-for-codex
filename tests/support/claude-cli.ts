import type { ClaudeCli } from "../../src/features/providers/claude/executable.js";

/** The fake Claude Code path tests pass to the SDK; nothing runs it. */
export const fakeClaudePath = "/test/bin/claude";

/** A supported Claude Code CLI, so provider tests don't depend on the host's installation. */
export const readyClaudeCli: Pick<ClaudeCli, "status" | "executable"> = {
  status: async () => ({
    ready: true,
    path: fakeClaudePath,
    version: "2.1.293",
    supported: "2.1.285–2.1.295",
  }),
  executable: async () => fakeClaudePath,
};
