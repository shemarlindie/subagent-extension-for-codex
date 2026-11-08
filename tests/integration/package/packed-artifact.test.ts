import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  type TestContext,
} from "vitest";

import type { ProviderReadiness } from "../../../src/shared/providers/types.js";
import { npmCommand } from "../../support/npm.js";
import {
  freePort,
  type Service,
  serviceEnv,
  stopService,
} from "../../support/service.js";

const exec = promisify(execFile);

// Everything runs from the extracted tarball in a temporary directory outside
// the checkout, so no import can resolve from the checkout's node_modules.
let root: string;
let pkg: string;
let repository: string;
/** The paths npm packed, before the tests add their own files to the extracted package. */
let packedFiles: string[];

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
  const { result: workers } = await callJson(client, "list_workers");

  return workers.find(
    (worker: { provider: string }) => worker.provider === "claude",
  ) as {
    readiness: ProviderReadiness;
    models?: { value: string }[];
    model_discovery_error?: string;
  };
}

/** Connects over the packaged stdio entry, which starts the packaged service when none is running. */
async function connectStdio(
  service = main,
  overrides: Record<string, string> = {},
  installation = pkg,
) {
  const client = new Client({ name: "packed-artifact-test", version: "1" });

  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--enable-source-maps", join(installation, "dist/stdio.js")],
      cwd: root,
      env: serviceEnv(service, overrides),
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

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "packed-artifact-")));
  main = { data: join(root, "data"), port: await freePort() };
  repository = join(root, "repository");

  // Pack the existing build (pretest builds it) instead of rebuilding through prepack.
  await access(resolve("dist/main.js"));

  const { stdout } = await exec(
    ...npmCommand([
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      root,
    ]),
    { maxBuffer: 64 * 1024 * 1024 },
  );

  const [{ filename, files }] = JSON.parse(stdout);
  packedFiles = files.map((file: { path: string }) => file.path);
  // A relative archive path, since GNU tar reads "C:" in a path as a remote host.
  await exec("tar", ["-xzf", filename], { cwd: root });
  pkg = join(root, "package");

  // Mention test mode must not re-enable composer mentions in the packaged proxy.
  await writeFile(
    join(pkg, ".env"),
    "SUBAGENT_EXTENSION_FOR_CODEX_MENTION_TEST_MODE=1\n",
  );

  await mkdir(repository);
  await exec("git", ["init", "-q", repository]);
}, 180_000);

afterAll(async () => {
  for (const service of [main, ...services]) {
    await stopService(service).catch(() => {});
  }

  // Windows can release SQLite and directory handles just after process exit.
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
});

describe("packed artifact", () => {
  test("packs only the runtime files, the README and the license", () => {
    const top = [...new Set(packedFiles.map((path) => path.split("/")[0]))];

    expect(top.sort()).toEqual(
      [
        "LICENSE",
        "README.md",
        "assets",
        "dist",
        "mcp.json",
        "migrations",
        "package.json",
        "plugin.json",
        "skills",
      ].sort(),
    );
  });

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
      "dist/app.html.THIRD_PARTY_LICENSES.txt",
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
      const handle = await open(file, "r");

      try {
        const bytes = Buffer.alloc(4);
        await handle.read(bytes, 0, bytes.length, 0);

        if (nativeExecutable(bytes)) native.push(relative(pkg, file));
      } finally {
        await handle.close();
      }
    }

    assert.deepEqual(native, []);
  });

  test("license notices list the packages bundled into each build", async () => {
    const notice = (file: string) => readFile(join(pkg, "dist", file), "utf8");

    expect(await notice("THIRD_PARTY_LICENSES.txt")).toMatch(/^express@\d/m);

    const panel = await notice("app.html.THIRD_PARTY_LICENSES.txt");

    for (const name of ["react", "react-dom", "highlight.js"]) {
      expect(panel).toMatch(
        new RegExp(`^${name.replace(".", "\\.")}@\\d`, "m"),
      );
    }
  });

  test("each public entry refuses an unsupported Node with a clear message", async () => {
    // Stubbing the reported version stands in for an old runtime, whose parser would reject the bundle.
    const oldNode =
      'data:text/javascript,Object.defineProperty(process.versions,"node",{value:"22.11.0"})';

    for (const entry of ["main", "stdio", "projects-cli"]) {
      const failed = await exec(
        process.execPath,
        ["--import", oldNode, join(pkg, `dist/${entry}.js`)],
        { cwd: root, env: serviceEnv(main) },
      ).then(
        () => assert.fail(`${entry} started on an unsupported Node`),
        (error: { code: number; stderr: string }) => error,
      );

      assert.equal(failed.code, 1);

      assert.match(
        failed.stderr,
        /needs Node\.js 24 or later, but .* is Node\.js 22\.11\.0/,
      );
    }
  });

  test("the projects CLI registers and lists a repository from an unrelated directory", async () => {
    const run = (...args: string[]) =>
      exec(process.execPath, [join(pkg, "dist/projects-cli.js"), ...args], {
        cwd: root,
        env: serviceEnv(main),
      });

    await run("register", repository);
    const { stdout } = await run("list");

    expect(JSON.parse(stdout)).toEqual(
      expect.arrayContaining([expect.objectContaining({ repository })]),
    );
  });

  test("stdio starts the packaged service and keeps composer mentions disabled in test mode", async () => {
    const client = await connectStdio();

    const { version } = JSON.parse(
      await readFile(join(pkg, "package.json"), "utf8"),
    );

    try {
      const server = client.getServerVersion();
      assert.equal(server?.name, "subagent-extension-for-codex");
      assert.equal(server?.version, version);
      assert.equal(server?.icons?.length, 2);

      assert.ok(
        (await client.listTools()).tools.some(
          (tool) => tool.name === "start_task",
        ),
      );

      const { result: projects } = await callJson(client, "list_projects");

      expect(projects).toEqual(
        expect.arrayContaining([expect.objectContaining({ repository })]),
      );

      const { resources } = await client.listResources();

      const panel = resources.find((resource) =>
        resource.uri.startsWith("ui://"),
      );

      const html = (await client.readResource({ uri: panel!.uri })).contents[0];
      assert.match(String((html as { text?: string }).text), /<html/i);

      assert.equal(
        (await client.listTools()).tools.some(
          (tool) => tool.name === "app_search_mentions",
        ),
        false,
      );

      assert.equal(
        resources.some(
          (resource) =>
            resource.uri === "subagent-extension-for-codex://providers/claude",
        ),
        false,
      );

      const mentionResult = await client.callTool({
        name: "app_search_mentions",
        arguments: { query: "review" },
      });

      assert.equal(mentionResult.isError, true);
      await assert.rejects(access(join(main.data, "mention-search.jsonl")));
    } finally {
      await client.close();
    }

    const status = await health();
    assert.equal(status.service, "subagent-extension-for-codex");
    assert.equal(status.version, version);

    assert.equal(
      JSON.parse(await readFile(join(main.data, "service.json"), "utf8"))
        .version,
      version,
    );

    // The launcher started the extracted dist/main.js, not the checkout's.
    if (process.platform !== "win32") {
      const pid = (
        await readFile(join(main.data, "service.pid"), "utf8")
      ).trim();

      const { stdout } = await exec("ps", ["-ww", "-p", pid, "-o", "args="]);
      assert.ok(stdout.includes(join(pkg, "dist/main.js")), stdout);
    }
  });

  test("a connected proxy starts a new service when its service stops", async () => {
    const client = await connectStdio();

    try {
      await callJson(client, "list_projects");
      await stopService(main);
      await assert.rejects(health());

      const { result: projects } = await callJson(client, "list_projects");

      expect(projects).toEqual(
        expect.arrayContaining([expect.objectContaining({ repository })]),
      );

      assert.equal((await health()).status, "ok");
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

  // These update and executable scenarios each own their service and data.
  test.concurrent(
    "a newer package hands over from the older package's service",
    async () => {
      // A copy reporting an older version stands in for the previous release.
      const older = join(root, "package-older");
      await cp(pkg, older, { recursive: true });

      const manifest = JSON.parse(
        await readFile(join(older, "package.json"), "utf8"),
      );

      await writeFile(
        join(older, "package.json"),
        JSON.stringify({ ...manifest, version: "0.0.1" }),
      );

      const service = await extraService("data-handoff");

      const status = () =>
        fetch(`http://127.0.0.1:${service.port}/health`).then((response) =>
          response.json(),
        );

      const previous = await connectStdio(service, {}, older);

      try {
        await callJson(previous, "list_projects");
        assert.equal((await status()).version, "0.0.1");
      } finally {
        await previous.close();
      }

      const oldPid = await readFile(join(service.data, "service.pid"), "utf8");
      const client = await connectStdio(service);

      try {
        // The idle older service drains at once. The next call starts this version.
        await callJson(client, "list_projects");
        const current = await status();
        assert.equal(current.version, manifest.version);
        assert.equal(current.launcher, "stdio");

        assert.notEqual(
          await readFile(join(service.data, "service.pid"), "utf8"),
          oldPid,
        );
      } finally {
        await client.close();
      }
    },
  );

  test.concurrent(
    "the panel keeps working after an update removes the running installation",
    async () => {
      const removed = join(root, "package-removed");
      await cp(pkg, removed, { recursive: true });
      const service = await extraService("data-removed");
      const client = await connectStdio(service, {}, removed);

      try {
        await callJson(client, "list_projects");
        await rm(removed, { recursive: true, force: true });

        const page = await fetch(`http://127.0.0.1:${service.port}/`);
        assert.equal(page.status, 200);
        assert.match(await page.text(), /<html/i);

        const { resources } = await client.listResources();

        const panel = resources.find((resource) =>
          resource.uri.startsWith("ui://"),
        );

        const html = (await client.readResource({ uri: panel!.uri }))
          .contents[0];

        assert.match(String((html as { text?: string }).text), /<html/i);
      } finally {
        await client.close();
      }
    },
  );

  // Fake CLIs are shell scripts.
  test
    .skipIf(process.platform === "win32")
    .concurrent(
      "an unsupported or missing Claude Code blocks Claude tasks and nothing else",
      async () => {
        const bin = join(root, "claude-versions");
        const supported = await fakeClaude(join(bin, "supported"), "2.1.300");
        const old = await fakeClaude(join(bin, "old"), "2.0.0");
        const newer = await fakeClaude(join(bin, "newer"), "9.0.0");
        // The override is a symlink, as installers make, retargeted between checks.
        const link = join(root, "claude-link");
        await symlink(supported, link);
        const overridden = await extraService("data-override");

        const client = await connectStdio(overridden, {
          SUBAGENT_EXTENSION_FOR_CODEX_CLAUDE_PATH: link,
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
            version: "2.1.300",
            supported_versions: worker.readiness.details.supported_versions,
          });

          await retarget(old);
          worker = await claudeWorker(client);
          assert.equal(worker.readiness.ready, false);
          assert.match(worker.readiness.message!, /2\.0\.0 .* older than/);
          assert.equal(worker.models, undefined);

          const refused = await callError(client, "start_task", {
            provider: "claude",
            description: "Review the README",
            worker_profile: "reviewer",
            repository,
          });

          assert.match(refused, /older than the supported/);
          // Projects and task history stay available.
          await callJson(client, "list_projects");
          await callJson(client, "list_tasks");

          await retarget(newer);
          worker = await claudeWorker(client);
          assert.equal(worker.readiness.ready, true);
          assert.equal(worker.readiness.details.version, "9.0.0");
          assert.equal(worker.readiness.details.supported_versions, "2.1.300+");

          // A configured path that stops resolving is an error, not a PATH fallback.
          await unlink(link);
          worker = await claudeWorker(client);

          assert.match(
            worker.readiness.message!,
            /SUBAGENT_EXTENSION_FOR_CODEX_CLAUDE_PATH points to/,
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
