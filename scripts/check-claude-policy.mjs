// Qualifies the org policy behavior the extension builds on, without quota. It
// plants a cached policy in a temporary config directory, so it needs no org.
// An eligible session sends only a fake key to the settings endpoint, which
// refuses it, and no turn runs. Exits non-zero when anything has changed.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { query } from "@anthropic-ai/claude-agent-sdk";

const executable =
  process.env.SUBAGENT_EXTENSION_FOR_CODEX_CLAUDE_PATH || "claude";

const policy = {
  availableModels: ["haiku"],
  disableAutoMode: "disable",
  permissions: { disableBypassPermissionsMode: "disable" },
  sandbox: { enabled: false },
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
      allowDangerouslySkipPermissions: true,
      sandbox: { enabled: true, failIfUnavailable: true },
      env: {
        PATH: process.env.PATH,
        HOME: home,
        CLAUDE_CONFIG_DIR: config,
        ANTHROPIC_API_KEY: "sk-ant-not-a-real-key",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
    },
  });

  try {
    return await read(session);
  } finally {
    release();
    session.close();
    rmSync(home, { recursive: true, force: true });
  }
}

const modeRejection = (session, mode) =>
  session.setPermissionMode(mode).then(
    () => undefined,
    (error) => String(error),
  );

async function read(session) {
  if (typeof session.getSettings !== "function") return undefined;

  const settings = await session.getSettings();

  return {
    settings,
    models: (await session.supportedModels()).map(({ value }) => value),
    bypass: await modeRejection(session, "bypassPermissions"),
    auto: await modeRejection(session, "auto"),
    plan: await modeRejection(session, "plan"),
  };
}

const open = await idleSession(undefined, read);

if (!open) {
  check(false, "Query.getSettings exists");
} else {
  const limited = await idleSession(policy, read);

  check(true, "Query.getSettings exists");

  check(
    open.settings.effective.sandbox?.enabled === true,
    "effective.sandbox reports the sandbox an SDK option asks for",
  );

  check(!open.bypass && !open.auto, "no policy: Bypass and Auto are accepted");

  check(
    limited.settings.sources?.some(({ source }) => source === "policySettings"),
    "policy: sources lists policySettings",
  );

  check(
    limited.settings.effective.sandbox?.enabled === false,
    "policy: effective.sandbox reports the sandbox turned off",
  );

  check(
    /permission mode/i.test(limited.bypass ?? "") &&
      /permission mode/i.test(limited.auto ?? ""),
    "policy: setPermissionMode rejects Bypass and Auto, naming the permission mode",
  );

  check(!limited.plan, "policy: setPermissionMode still accepts Plan");

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
