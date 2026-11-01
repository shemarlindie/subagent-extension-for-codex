import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, test } from "vitest";

import { npmCommand } from "../../support/npm.js";
import {
  freePort,
  type Service,
  serviceEnv,
  stopService,
} from "../../support/service.js";

const exec = promisify(execFile);

/**
 * The Codex CLI to install with, as a command and leading arguments:
 * CODEX_BIN, or codex on PATH. On Windows, npm's codex shims need a shell,
 * so this Node runs the npm package's script beside them.
 */
function findCodex(): [string, string[]] | undefined {
  if (process.env.CODEX_BIN) return [process.env.CODEX_BIN, []];

  if (process.platform !== "win32") {
    try {
      return [execFileSync("which", ["codex"]).toString().trim(), []];
    } catch {
      return undefined;
    }
  }

  try {
    const shim = execFileSync("where", ["codex"])
      .toString()
      .split(/\r?\n/)[0]!
      .trim();

    if (/\.exe$/i.test(shim)) return [shim, []];

    const script = join(
      dirname(shim),
      "node_modules/@openai/codex/bin/codex.js",
    );

    return existsSync(script) ? [process.execPath, [script]] : undefined;
  } catch {
    return undefined;
  }
}

const codex = findCodex();

/**
 * A published marketplace to install in place of the packed release, such as
 * owner/repo@v1.2.3. The release workflow sets it after publishing.
 */
const published = process.env.MARKETPLACE_SOURCE;

/** The fields of a `codex mcp list --json` entry that this test reads. */
type McpServer = {
  name: string;
  transport: {
    command: string;
    args: string[];
    env: Record<string, string>;
    cwd: string;
  };
};

// CI installs @openai/codex. Without it there is nothing to install with.
describe.skipIf(!codex)("marketplace install with the Codex CLI", () => {
  let root: string;
  let codexHome: string;
  let service: Service;

  const runCodex = (...args: string[]) =>
    exec(codex![0], [...codex![1], ...args], {
      env: { ...process.env, CODEX_HOME: codexHome },
      maxBuffer: 16 * 1024 * 1024,
    });

  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "marketplace-")));
    codexHome = join(root, "codex-home");
    await mkdir(codexHome);
    service = { data: join(root, "data"), port: await freePort() };

    // Codex fetches a published marketplace, so there is nothing to pack.
    if (published) return;

    // Assemble from the existing build (pretest builds it).
    await access(resolve("dist/stdio.js"));

    await exec(process.execPath, [
      "scripts/assemble-release.mjs",
      "--out",
      join(root, "release"),
    ]);

    // Install what npm publishes: the release packed and extracted.
    const { stdout } = await exec(
      ...npmCommand([
        "pack",
        join(root, "release"),
        "--json",
        "--pack-destination",
        root,
      ]),
    );

    const [{ filename }] = JSON.parse(stdout);
    // A relative archive path, since GNU tar reads "C:" in a path as a remote host.
    await exec("tar", ["-xzf", filename], { cwd: root });
  }, 120_000);

  afterAll(async () => {
    await stopService(service).catch(() => {});

    // Windows can release SQLite and directory handles just after process exit.
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });

  test("installs from the marketplace and serves over Codex's MCP command", async () => {
    await runCodex(
      "plugin",
      "marketplace",
      "add",
      published ?? join(root, "package"),
    );

    await runCodex(
      "plugin",
      "add",
      "subagent-extension-for-codex@shemarlindie",
    );

    const { version } = JSON.parse(await readFile("package.json", "utf8"));

    // Codex's own cache layout: plugins/cache/<marketplace>/<plugin>/<version>.
    const plugin = join(
      codexHome,
      "plugins/cache/shemarlindie/subagent-extension-for-codex",
    );

    // A published source must be the checkout's version, which the checks below expect.
    const versions = await readdir(plugin);

    assert.deepEqual(
      versions,
      [version],
      `Codex installed ${versions.join(", ")}, but the checkout is ${version}`,
    );

    const installed = join(plugin, version);

    await access(join(installed, "dist/stdio.js"));

    const servers: McpServer[] = JSON.parse(
      (await runCodex("mcp", "list", "--json")).stdout,
    );

    const server = servers.find(
      (entry) => entry.name === "subagent-extension-for-codex",
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
      assert.ok(tools.some((tool) => tool.name === "start_task"));

      const result = await client.callTool({
        name: "list_projects",
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
    // The plugin's proxy started this service, so a later plugin update can
    // hand it over to the new version.
    assert.equal(health.launcher, "stdio");
  });
});
