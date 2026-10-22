import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { test } from "vitest";

import {
  inspectProcess,
  isExtensionService,
  type ProcessIdentity,
} from "../../../src/service/platform/service/process-info.js";

async function data(t: import("vitest").TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "service-owner-"));
  t.onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return directory;
}

test("matches service-recorded identity to a later process inspection", async (t) => {
  if (process.platform !== "linux" && process.platform !== "darwin") {
    t.skip("The service identity reader is not supported on this platform");

    return;
  }

  if (!inspectProcess(process.pid)) {
    t.skip("This environment does not permit process inspection");

    return;
  }

  const directory = await data(t);
  const resultFile = join(directory, "identity.json");

  const moduleUrl = pathToFileURL(
    resolve("src/service/platform/service/process-info.ts"),
  ).href;

  const childScript = [
    'import { writeFileSync } from "node:fs";',
    `const { inspectProcessIdentity } = await import(${JSON.stringify(moduleUrl)});`,
    "const identity = inspectProcessIdentity(process.pid);",
    "if (!identity) process.exit(2);",
    `writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify(identity));`,
    "setInterval(() => {}, 1000);",
  ].join("\n");

  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", childScript],
    { cwd: process.cwd(), stdio: "ignore" },
  );

  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });

  assert.ok(child.pid, "child did not start");

  t.onTestFinished(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;

    child.kill("SIGKILL");
    await once(child, "exit");
  });

  const deadline = Date.now() + 5000;
  let captured: ProcessIdentity | undefined;

  while (Date.now() < deadline) {
    try {
      captured = JSON.parse(
        await readFile(resultFile, "utf8"),
      ) as ProcessIdentity;

      break;
    } catch {
      if (child.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  assert.ok(captured, "child could not capture its process identity");

  const owner = inspectProcess(child.pid);
  assert.ok(owner, "parent could not inspect the child process");

  assert.equal(child.pid, owner.pid);
  assert.equal(captured.startedAt, owner.startedAt);
  assert.equal(captured.commandLine, owner.commandLine);

  await writeFile(
    join(directory, "service.json"),
    JSON.stringify({
      pid: child.pid,
      startedAt: captured.startedAt,
      commandLine: captured.commandLine,
    }),
  );

  assert.equal(isExtensionService(owner, join(directory, "service.pid")), true);
});
