import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { describe, test, type TestContext } from "vitest";

import {
  challengeHeader,
  healthProof,
} from "../../../src/service/platform/service/health-proof.js";
import { waitForListening } from "../../support/helpers.js";

const exec = promisify(execFile);
let codex = process.env.CODEX_BIN;

if (!codex && process.platform !== "win32") {
  try {
    codex = execFileSync("which", ["codex"]).toString().trim();
  } catch {}
}

// Exercise the real packaging and CLI with a tiny build and isolated state.
async function fixture(t: TestContext) {
  const cli = codex;
  assert.ok(cli, "The suite runs only with the Codex CLI");
  const root = await realpath(await mkdtemp(join(tmpdir(), "dev-plugin-")));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const checkout = join(root, "checkout");
  const data = join(root, "data");
  const codexHome = join(root, "codex-home");
  for (const directory of [data, codexHome]) await mkdir(directory);

  for (const file of [
    "scripts/dev-plugin.mjs",
    "scripts/dev-plugin-service.mjs",
    "scripts/assemble-release.mjs",
    ".agents/plugins/marketplace.json",
    "plugin.json",
    "src/service/platform/service/health-proof.ts",
  ]) {
    const target = join(checkout, file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(file, target);
  }

  const { name, version } = JSON.parse(await readFile("package.json", "utf8"));

  await writeFile(
    join(checkout, "package.json"),
    JSON.stringify({
      name,
      version,
      type: "module",
      files: ["dist", "plugin.json"],
      scripts: { build: "node build.mjs" },
    }),
  );

  await writeFile(
    join(checkout, "build.mjs"),
    `import { mkdirSync, rmSync, writeFileSync } from "node:fs";
if (process.env.BUILD_FAIL) process.exit(1);
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
for (const file of ["main.js", "stdio.js", "app.html", process.env.BUILD_ID]) {
  writeFileSync("dist/" + file, "");
}
`,
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CODEX_HOME: codexHome,
    CODEX_BIN: codex,
    SUBAGENT_EXTENSION_FOR_CODEX_DATA: data,
  };

  delete env.SUBAGENT_EXTENSION_FOR_CODEX_TOKEN;

  return {
    data,
    run: (args: string, extra: Record<string, string> = {}) =>
      exec(process.execPath, ["scripts/dev-plugin.mjs", ...args.split(" ")], {
        cwd: checkout,
        env: { ...env, ...extra },
      }),
    codex: (...args: string[]) => exec(cli, args, { env }),
    installed: () =>
      readdir(
        join(codexHome, "plugins/cache/shemarlindie", name, version, "dist"),
      ),
  };
}

describe.skipIf(!codex || process.platform === "win32")(
  "dev plugin script",
  () => {
    test("updates a same-version build and uninstalls repeatedly", async (t) => {
      const { run, installed, codex } = await fixture(t);
      await run("install", { BUILD_ID: "old" });
      await run("update", { BUILD_ID: "new" });
      const files = await installed();
      assert.ok(files.includes("new"));
      assert.ok(!files.includes("old"));

      await run("uninstall");
      await run("uninstall");
      await assert.rejects(installed());
      const { stdout } = await codex("plugin", "marketplace", "list", "--json");
      assert.deepEqual(JSON.parse(stdout).marketplaces, []);
    });

    test("a failed build preserves the installation", async (t) => {
      const { run, installed } = await fixture(t);
      await run("install", { BUILD_ID: "old" });
      await assert.rejects(run("update", { BUILD_FAIL: "1" }));
      assert.ok((await installed()).includes("old"));
    });

    test("requires consent to stop a plugin service and leaves development services alone", async (t) => {
      const { data, run } = await fixture(t);
      const token = "dev-plugin-test-token-not-a-real-credential";
      let launcher = "stdio";
      let drains = 0;

      const server = createServer((req, res) => {
        res.setHeader("Content-Type", "application/json");

        if (req.url === "/health") {
          res.end(
            JSON.stringify({
              service: "subagent-extension-for-codex",
              status: "ok",
              launcher,
              proof: healthProof(token, String(req.headers[challengeHeader])),
            }),
          );
        } else if (req.method === "POST" && req.url === "/api/service/drain") {
          assert.equal(req.headers.authorization, "Bearer " + token);
          drains++;

          res
            .writeHead(202)
            .end(JSON.stringify({ status: "draining", running: 0 }));
        } else {
          res.writeHead(404).end();
        }
      });

      await waitForListening(server.listen(0, "127.0.0.1"));

      t.onTestFinished(
        () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      );

      const origin =
        "http://127.0.0.1:" + (server.address() as AddressInfo).port;

      await writeFile(
        join(data, "service.json"),
        JSON.stringify({
          origin,
          pid: process.pid,
          startedAt: "fixture",
        }),
      );

      await writeFile(join(data, "admin-token"), token);

      await run("uninstall");
      assert.equal(drains, 0);
      await run("uninstall --stop-service");
      assert.equal(drains, 1);

      launcher = "foreground";

      await assert.rejects(
        run("uninstall --stop-service"),
        /wasn't started by the plugin/,
      );

      assert.equal(drains, 1);
    });
  },
);
