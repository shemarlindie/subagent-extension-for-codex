import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, test, type TestContext } from "vitest";

import type { ProviderReadiness } from "../../../src/shared/providers/types.js";
import { waitForListening } from "../../support/helpers.js";

const exec = promisify(execFile);

// Everything runs from the extracted tarball in a temporary directory outside
// the checkout, so no import can resolve from the checkout's node_modules.
let root: string;
let pkg: string;
let repository: string;
let serviceRepository: string;

/** A packaged service's data directory and loopback port. */
type Service = { data: string; port: number };

/** The service most tests share; it runs whatever Claude Code the host has. */
let main: Service;
/** Every service a test started, so each one is stopped even when a test fails. */
const services: Service[] = [];

/** A further packaged service with its own data directory and port. */
async function extraService(name: string): Promise<Service> {
  const service = { data: join(root, name), port: await freePort() };
  services.push(service);

  return service;
}

/** The environment without this service's overrides, so tests never reach the user's live service. */
function cleanEnv(service = main, overrides: Record<string, string> = {}) {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      !key.startsWith("CODEX_SUBAGENT_EXTENSION_") &&
      key !== "PORT"
    ) {
      env[key] = value;
    }
  }

  return {
    ...env,
    CODEX_SUBAGENT_EXTENSION_DATA: service.data,
    PORT: String(service.port),
    ...overrides,
  };
}

/** Whether a file starts like an ELF, Mach-O or Windows PE binary. */
function nativeExecutable(bytes: Buffer) {
  const magic = bytes.subarray(0, 4).toString("hex");

  return (
    magic === "7f454c46" ||
    ["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe"].includes(
      magic,
    ) ||
    bytes.subarray(0, 2).toString("latin1") === "MZ"
  );
}

/** A fake `claude` that prints the given `--version` output. */
async function fakeClaude(path: string, version: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `#!/bin/sh\necho '${version} (Claude Code)'\n`);
  await chmod(path, 0o755);

  return path;
}

async function claudeWorker(client: Client) {
  const { result: workers } = await callJson(client, "list_available_workers");

  return workers.find(
    (worker: { provider: string }) => worker.provider === "claude",
  ) as {
    readiness: ProviderReadiness;
    models?: { value: string }[];
    model_discovery_error?: string;
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
async function connectStdio(
  service = main,
  overrides: Record<string, string> = {},
) {
  const client = new Client({ name: "packed-artifact-test", version: "1" });

  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--enable-source-maps", join(pkg, "dist/stdio.js")],
      cwd: root,
      env: cleanEnv(service, overrides),
      stderr: "pipe",
    }),
  );

  return client;
}

async function callJson(client: Client, name: string, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, JSON.stringify(result.content));
  const [content] = result.content as { text: string }[];
  assert.ok(content, `${name} returned no content`);

  return JSON.parse(content.text);
}

async function callError(client: Client, name: string, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(result.isError, JSON.stringify(result.content));
  const [content] = result.content as { text: string }[];
  assert.ok(content, `${name} returned no content`);

  return content.text;
}

const health = () =>
  fetch(`http://127.0.0.1:${main.port}/health`).then((response) =>
    response.json(),
  );

async function stopService(service = main) {
  const pid = Number(await readFile(join(service.data, "service.pid"), "utf8"));

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
  main = { data: join(root, "data"), port: await freePort() };
  repository = join(root, "repository");
  serviceRepository = join(root, "service-repository");

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
  for (const service of [main, ...services]) {
    await stopService(service).catch(() => {});
  }

  await rm(root, { recursive: true, force: true });
});

describe("packed artifact", () => {
  test("contains the bundled entries and no node_modules or native executables", async () => {
    const top = await readdir(pkg);

    assert.ok(
      !top.includes("node_modules"),
      `unexpected node_modules in ${top.join(", ")}`,
    );

    for (const file of [
      "dist/main.js",
      "dist/stdio.js",
      "dist/projects-cli.js",
      "dist/app.html",
      "dist/THIRD_PARTY_LICENSES.txt",
      "assets/brand/brand-glyph-dark.svg",
      "mcp.json",
    ]) {
      await access(join(pkg, file));
    }

    // The service and projects CLI migrate the database from these at startup.
    const migrations = await readdir(join(process.cwd(), "migrations"));
    assert.ok(migrations.length);

    for (const migration of migrations) {
      await access(join(pkg, "migrations", migration, "migration.sql"));
    }

    const files = (await readdir(pkg, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name));

    const native = [];

    for (const file of files) {
      if (nativeExecutable(await readFile(file))) {
        native.push(relative(pkg, file));
      }
    }

    assert.deepEqual(native, []);
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

      await access(join(main.data, "mention-search.jsonl"));
    } finally {
      await client.close();
    }

    assert.equal((await health()).service, "codex-subagent-extension");

    // The launcher started the extracted dist/main.js, not the checkout's.
    if (process.platform !== "win32") {
      const pid = (
        await readFile(join(main.data, "service.pid"), "utf8")
      ).trim();

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

  test("the packaged service runs the host's Claude Code for model discovery", async (context: TestContext) => {
    const client = await connectStdio();

    try {
      const worker = await claudeWorker(client);

      if (!worker.readiness.ready) {
        context.skip(
          `No supported Claude Code on this host: ${worker.readiness.message}`,
        );
      }

      assert.equal(worker.model_discovery_error, undefined);
      assert.ok(worker.models?.some((model) => model.value === "default"));
    } finally {
      await client.close();
    }
  });

  // Fake CLIs are shell scripts.
  test.skipIf(process.platform === "win32")(
    "an unsupported or missing Claude Code blocks Claude tasks and nothing else",
    async () => {
      const bin = join(root, "claude-versions");
      const supported = await fakeClaude(join(bin, "supported"), "2.1.293");
      const old = await fakeClaude(join(bin, "old"), "2.0.0");
      const newer = await fakeClaude(join(bin, "newer"), "9.0.0");
      // The override is a symlink, as installers make, retargeted between checks.
      const link = join(root, "claude-link");
      await symlink(supported, link);
      const overridden = await extraService("data-override");

      const client = await connectStdio(overridden, {
        CODEX_SUBAGENT_EXTENSION_CLAUDE_PATH: link,
      });

      const retarget = async (target: string) => {
        await unlink(link);
        await symlink(target, link);
      };

      try {
        let worker = await claudeWorker(client);
        assert.equal(worker.readiness.ready, true);

        assert.deepEqual(worker.readiness.details, {
          executable: supported,
          version: "2.1.293",
          supported_versions: worker.readiness.details.supported_versions,
        });

        await retarget(old);
        worker = await claudeWorker(client);
        assert.equal(worker.readiness.ready, false);
        assert.match(worker.readiness.message!, /2\.0\.0 .* older than/);
        assert.equal(worker.models, undefined);

        const refused = await callError(client, "start_agent_task", {
          provider: "claude",
          description: "Review the README",
          worker_profile: "reviewer",
          repository,
        });

        assert.match(refused, /older than the supported/);
        // Projects and task history stay available.
        await callJson(client, "list_agent_projects");
        await callJson(client, "list_agent_tasks");

        await retarget(newer);
        worker = await claudeWorker(client);
        assert.equal(worker.readiness.ready, true);
        assert.equal(worker.readiness.details.version, "9.0.0");
        assert.equal(worker.readiness.details.supported_versions, "2.1.285+");

        // A configured path that stops resolving is an error, not a PATH fallback.
        await unlink(link);
        worker = await claudeWorker(client);

        assert.match(
          worker.readiness.message!,
          /CODEX_SUBAGENT_EXTENSION_CLAUDE_PATH points to/,
        );
      } finally {
        await client.close();
      }

      // Without an override or a claude on PATH, the service reports it missing.
      const empty = join(root, "empty-bin");
      await mkdir(empty);
      const missing = await extraService("data-missing");
      const bare = await connectStdio(missing, { PATH: empty });

      try {
        const worker = await claudeWorker(bare);
        assert.equal(worker.readiness.ready, false);

        assert.match(
          worker.readiness.message!,
          /not found on the service's PATH/,
        );
      } finally {
        await bare.close();
      }
    },
  );
});
