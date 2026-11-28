// Qualifies the org policy behavior the extension builds on, without quota. It
// plants a cached policy in a temporary config directory, so it needs no org.
// An eligible session sends only a fake key to the settings endpoint, which
// refuses it, and no turn runs. Exits non-zero when anything has changed.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { query } from "@anthropic-ai/claude-agent-sdk";

import { claudeEnvironment } from "../src/providers/claude/service/configuration/execution-environment.ts";

const executable =
  process.env.SUBAGENT_EXTENSION_FOR_CODEX_CLAUDE_PATH || "claude";

const policy = {
  availableModels: ["haiku"],
  disableAutoMode: "disable",
  permissions: { disableBypassPermissionsMode: "disable" },
};

const failures = [];

const check = (ok, message) => {
  console.log(`${ok ? "ok" : "FAILED"}: ${message}`);
  if (!ok) failures.push(message);
};

/** An idle session on a temporary config directory, optionally with a cached policy. */
async function idleSession(cached, read) {
  const home = mkdtempSync(join(tmpdir(), "claude-policy-check-"));
  const config = join(home, ".claude");
  mkdirSync(config);
  writeFileSync(join(config, "settings.json"), "{}");

  if (cached) {
    writeFileSync(join(config, "remote-settings.json"), JSON.stringify(cached));
  }

  let release;

  const pending = new Promise((resolve) => {
    release = resolve;
  });

  const session = query({
    // eslint-disable-next-line require-yield -- an open prompt stream that never sends a turn
    prompt: (async function* () {
      await pending;
    })(),
    options: {
      pathToClaudeCodeExecutable: executable,
      cwd: home,
      persistSession: false,
      settingSources: [],
      tools: [],
      strictMcpConfig: true,
      mcpServers: {},
      permissionMode: "default",
      // Tagged like the service, from a minimal environment.
      env: claudeEnvironment({
        PATH: process.env.PATH,
        HOME: home,
        CLAUDE_CONFIG_DIR: config,
        ANTHROPIC_API_KEY: "sk-ant-not-a-real-key",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      }),
    },
  });

  try {
    return await read(session);
  } finally {
    release();
    session.close();
    // Claude Code can still be writing to its config directory as it exits.
    rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  }
}

async function read(session) {
  if (typeof session.getSettings !== "function") return undefined;

  const settings = await session.getSettings();

  return {
    settings,
    models: (await session.supportedModels()).map(({ value }) => value),
  };
}

const open = await idleSession(undefined, read);

if (!open) {
  check(false, "Query.getSettings exists");
} else {
  const limited = await idleSession(policy, read);

  check(true, "Query.getSettings exists");

  check(
    limited.settings.sources?.some(({ source }) => source === "policySettings"),
    "policy: sources lists policySettings",
  );

  const { effective } = limited.settings;

  check(
    !!effective?.disableAutoMode &&
      !!effective.permissions?.disableBypassPermissionsMode,
    "policy: effective settings turn off Auto and Bypass",
  );

  check(
    limited.models.includes("haiku") && !limited.models.includes("opus"),
    "policy: supportedModels follows availableModels",
  );
}

if (failures.length) {
  console.error(
    `\nOrg policy behavior changed. Sandboxed tasks may refuse to start, and the panel's locks may be wrong. See docs/claude-verification.md.`,
  );

  process.exit(1);
}

process.exit(0);
