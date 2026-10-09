import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  constants,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, test } from "vitest";

import { waitForListening } from "../../support/helpers.js";

const exec = promisify(execFile);

// Everything runs from the extracted tarball in a temporary directory outside
// the checkout, so no import can resolve from the checkout's node_modules.
let root: string;
let pkg: string;
let data: string;
let repository: string;
let serviceRepository: string;
let port: number;

/** The environment without this service's overrides, so tests never reach the user's live service. */
function cleanEnv() {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env))
    if (
      value !== undefined &&
      !key.startsWith("CODEX_SUBAGENT_EXTENSION_") &&
      key !== "PORT"
    )
      env[key] = value;

  return {
    ...env,
    CODEX_SUBAGENT_EXTENSION_DATA: data,
    PORT: String(port),
  };
}

async function freePort() {
  const reservation = createServer();
  await waitForListening(reservation.listen(0, "127.0.0.1"));
  const { port } = reservation.address() as import("node:net").AddressInfo;
  await new Promise<void>((done) => reservation.close(() => done()));

  return port;
}

/** Connects over the packaged stdio entry, which starts the packaged service when none is running. */
async function connectStdio() {
  const client = new Client({ name: "packed-artifact-test", version: "1" });

  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--enable-source-maps", join(pkg, "dist/stdio.js")],
      cwd: root,
      env: cleanEnv(),
      stderr: "pipe",
    }),
  );

  return client;
}

async function callJson(client: Client, name: string, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, JSON.stringify(result.content));

  return JSON.parse((result.content as { text: string }[])[0].text);
}

const health = () =>
  fetch(`http://127.0.0.1:${port}/health`).then((response) => response.json());

async function stopService() {
  const pid = Number(await readFile(join(data, "service.pid"), "utf8"));

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }

  for (let i = 0; i < 250; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }

    await new Promise((done) => setTimeout(done, 20));
  }

  process.kill(pid, "SIGKILL");
}

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "packed-artifact-")));
  data = join(root, "data");
  repository = join(root, "repository");
  serviceRepository = join(root, "service-repository");
  port = await freePort();

  // Pack the existing build (pretest builds it) instead of rebuilding through prepack.
  await access(resolve("dist/main.js"));

  const { stdout } = await exec(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", root],
    { maxBuffer: 64 * 1024 * 1024 },
  );

  const [{ filename }] = JSON.parse(stdout);
  await exec("tar", ["-xzf", join(root, filename), "-C", root]);
  pkg = join(root, "package");

  // A packaged .env is read relative to the package; test mode makes mention search log locally.
  await writeFile(
    join(pkg, ".env"),
    "CODEX_SUBAGENT_EXTENSION_MENTION_TEST_MODE=1\n",
  );

  for (const directory of [repository, serviceRepository]) {
    await mkdir(directory);
    await exec("git", ["init", "-q", directory]);
  }
}, 180_000);

afterAll(async () => {
  await stopService().catch(() => {});
  await rm(root, { recursive: true, force: true });
});

describe("packed artifact", () => {
  test("contains the bundled entries and the Claude binary, and no node_modules", async () => {
    const top = await readdir(pkg);

    assert.ok(
      !top.includes("node_modules"),
      `unexpected node_modules in ${top}`,
    );

    for (const file of [
      "dist/main.js",
      "dist/stdio.js",
      "dist/projects-cli.js",
      "dist/app.html",
      "dist/THIRD_PARTY_LICENSES.txt",
      "dist/claude/LICENSE.md",
      "assets/product-glyph-black.svg",
      "mcp.json",
    ])
      await access(join(pkg, file));

    const binary = join(
      pkg,
      "dist/claude",
      process.platform === "win32" ? "claude.exe" : "claude",
    );

    await access(binary, constants.X_OK);

    // The binary is the one the bundled SDK was built against.
    const sdk = JSON.parse(
      await readFile(
        resolve("node_modules/@anthropic-ai/claude-agent-sdk/package.json"),
        "utf8",
      ),
    );

    const { stdout } = await exec(binary, ["--version"]);
    assert.equal(stdout.trim(), `${sdk.claudeCodeVersion} (Claude Code)`);
  });

  test("the projects CLI registers and lists a repository from an unrelated directory", async () => {
    const run = (...args: string[]) =>
      exec(process.execPath, [join(pkg, "dist/projects-cli.js"), ...args], {
        cwd: root,
        env: cleanEnv(),
      });

    await run("register", repository);
    const { stdout } = await run("list");
    assert.ok(stdout.includes(repository), stdout);
  });

  test("stdio starts the packaged service and serves tools, icons, the panel and the packaged .env", async () => {
    const client = await connectStdio();

    try {
      const server = client.getServerVersion();
      assert.equal(server?.name, "codex-subagent-extension");
      assert.equal(server?.icons?.length, 2);

      assert.ok(
        (await client.listTools()).tools.some(
          (tool) => tool.name === "start_agent_task",
        ),
      );

      const projects = await callJson(client, "list_agent_projects");
      assert.ok(JSON.stringify(projects).includes(repository));

      // The service itself persists this one, for the restart check below.
      await callJson(client, "register_user_agent_project", {
        repository: serviceRepository,
      });

      const { resources } = await client.listResources();

      const panel = resources.find((resource) =>
        resource.uri.startsWith("ui://"),
      );

      const html = (await client.readResource({ uri: panel!.uri })).contents[0];
      assert.match(String((html as { text?: string }).text), /<html/i);

      await client.callTool({
        name: "search_mentions",
        arguments: { query: "review" },
      });

      await access(join(data, "mention-search.jsonl"));
    } finally {
      await client.close();
    }

    assert.equal((await health()).service, "codex-subagent-extension");

    // The launcher started the extracted dist/main.js, not the checkout's.
    if (process.platform !== "win32") {
      const pid = (await readFile(join(data, "service.pid"), "utf8")).trim();
      const { stdout } = await exec("ps", ["-ww", "-p", pid, "-o", "args="]);
      assert.ok(stdout.includes(join(pkg, "dist/main.js")), stdout);
    }
  });

  test("the packaged service keeps the projects it registered across a restart", async () => {
    await stopService();
    await assert.rejects(health());

    const client = await connectStdio();

    try {
      const projects = JSON.stringify(
        await callJson(client, "list_agent_projects"),
      );

      assert.ok(projects.includes(repository));
      assert.ok(projects.includes(serviceRepository));
    } finally {
      await client.close();
    }
  });
});
