import assert from "node:assert/strict";

import { test } from "vitest";

import { policyNotes } from "./policy-notes.js";

const labels = (policy: Parameters<typeof policyNotes>[0]) =>
  policyNotes(policy).map(({ label }) => label);

test("each row appears only when its policy is set, without the values", () => {
  assert.deepEqual(labels({ alwaysThinkingEnabled: true }), []);

  const notes = policyNotes({
    permissions: {
      deny: ["Bash(curl:*)"],
      blockWritesOutsideWorkingDirectories: true,
    },
    sandbox: { enabled: true, network: { allowManagedDomainsOnly: true } },
    allowedMcpServers: [{ serverName: "github" }],
    claudeMd: "Never push to the release branch.",
    alwaysThinkingEnabled: false,
    fallbackModel: ["sonnet"],
  });

  assert.deepEqual(
    notes.map(({ label }) => label),
    [
      "Permission rules",
      "File access",
      "Sandbox",
      "MCP servers",
      "Instructions",
      "Thinking",
      "Fallback",
    ],
  );

  const details = notes.map(({ detail }) => detail).join(" ");

  assert.ok(!details.includes("curl"));
  assert.ok(!details.includes("release branch"));
});

test("Also set lists other keys that can affect tasks, nested ones included", () => {
  assert.deepEqual(
    policyNotes({
      permissions: { additionalDirectories: ["/srv"], allow: ["Read"] },
      sandbox: { filesystem: { denyRead: ["~/.ssh"] } },
      disableAllHooks: true,
      theme: "dark",
      forceLoginMethod: "claudeai",
      enabledPlugins: { "lint@tools": true },
    }).find(({ label }) => label === "Also set")?.detail,
    "permissions.additionalDirectories, sandbox.filesystem.denyRead, disableAllHooks.",
  );
});
