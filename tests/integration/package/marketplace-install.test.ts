import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, test } from "vitest";

import {
  freePort,
  type Service,
  serviceEnv,
  stopService,
} from "../../support/service.js";

const exec = promisify(execFile);

/** The Codex CLI to install with: CODEX_BIN, or codex on PATH. */
function findCodex() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;

  try {
    return execFileSync(process.platform === "win32" ? "where" : "which", [
      "codex",
    ])
      .toString()
      .split(/\r?\n/)[0]
      ?.trim();
  } catch {
    return undefined;
  }
}

const codex = findCodex();

/**
 * A published marketplace to install from instead of the assembled build,
 * such as owner/repo@v1.2.3; the release workflow sets it after publishing.
 */
const published = process.env.MARKETPLACE_SOURCE;

type McpServer = {
  name: string;
  transport: {
    command: string;
    args: string[];
    env: Record<string, string>;
    cwd: string;
  };
};

// CI installs @openai/codex; without it there is nothing to install with.
describe.skipIf(!codex)("marketplace install with the Codex CLI", () => {
  let root: string;
  let codexHome: string;
  let service: Service;

  const runCodex = (...args: string[]) =>
    exec(codex!, args, {
      env: { ...process.env, CODEX_HOME: codexHome },
      maxBuffer: 16 * 1024 * 1024,
    });

  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "marketplace-")));
    codexHome = join(root, "codex-home");
    await mkdir(codexHome);
    service = { data: join(root, "data"), port: await freePort() };

    if (published) return;

    // Assemble from the existing build (pretest builds it).
    await access(resolve("dist/stdio.js"));

    await exec(process.execPath, [
      "scripts/assemble-release.mjs",
      "--out",
      join(root, "release"),
    ]);
  }, 120_000);

  afterAll(async () => {
    await stopService(service).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  test("installs from the marketplace and serves over Codex's MCP command", async () => {
    await runCodex(
      "plugin",
      "marketplace",
      "add",
      published ?? join(root, "release"),
    );

    await runCodex("plugin", "add", "codex-subagent-extension@shemarlindie");

    const { version } = JSON.parse(await readFile("package.json", "utf8"));

    const installed = join(
      codexHome,
      "plugins/cache/shemarlindie/codex-subagent-extension",
      version,
    );

    await access(join(installed, "dist/stdio.js"));

    const servers: McpServer[] = JSON.parse(
      (await runCodex("mcp", "list", "--json")).stdout,
    );

    const server = servers.find(
      (entry) => entry.name === "codex-subagent-extension",
    );

    assert.ok(server, JSON.stringify(servers));
    assert.equal(server.transport.env.PLUGIN_ROOT, installed);

    // Run the command Codex would, against an isolated data directory and port.
    const client = new Client({ name: "marketplace-test", version: "1" });

    await client.connect(
      new StdioClientTransport({
        command: server.transport.command,
        args: server.transport.args,
        cwd: server.transport.cwd,
        env: serviceEnv(service, server.transport.env),
        stderr: "pipe",
      }),
    );

    try {
      assert.equal(client.getServerVersion()?.version, version);
      const { tools } = await client.listTools();
      assert.ok(tools.some((tool) => tool.name === "start_agent_task"));

      const result = await client.callTool({
        name: "list_agent_projects",
        arguments: {},
      });

      assert.ok(!result.isError, JSON.stringify(result.content));
    } finally {
      await client.close();
    }

    const health = await (
      await fetch(`http://127.0.0.1:${service.port}/health`)
    ).json();

    assert.equal(health.version, version);
    assert.equal(health.launcher, "stdio");
  });
});
