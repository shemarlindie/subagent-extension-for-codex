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
  isProcessRunning,
  isSameProcess,
  type ProcessIdentity,
  type ProcessInfo,
} from "./process-info.js";

async function data(t: import("vitest").TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "service-owner-"));
  t.onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return directory;
}

test("process identity includes the command line and executable path", () => {
  const owner = {
    pid: 42,
    name: "node",
    executablePath: "/usr/local/bin/node",
    commandLine: "node src/service/main.ts",
    startedAt: "Wed Oct 7 12:00:00 2026",
  };

  assert.equal(
    isSameProcess(owner, { ...owner, executablePath: undefined }),
    true,
  );

  assert.equal(
    isSameProcess(owner, { ...owner, commandLine: "node other.js" }),
    false,
  );

  assert.equal(
    isSameProcess(owner, { ...owner, executablePath: "/other/node" }),
    false,
  );

  assert.equal(
    isSameProcess(owner, { ...owner, startedAt: "Wed Oct 7 12:01:00 2026" }),
    false,
  );
});

test("reads the current process identity and recognizes it as live", () => {
  assert.equal(isProcessRunning(process.pid), true);
});

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
}, 15000);

test("requires an exact recorded start time and command line", async (t) => {
  const directory = await data(t);

  const owner: ProcessInfo = {
    pid: 42,
    name: "node",
    commandLine: "node --import tsx src/service/main.ts",
    startedAt: "boot-id:1234",
  };

  await writeFile(
    join(directory, "service.json"),
    JSON.stringify({
      pid: owner.pid,
      startedAt: owner.startedAt,
      commandLine: owner.commandLine,
    }),
  );

  assert.equal(isExtensionService(owner, join(directory, "service.pid")), true);

  assert.equal(
    isExtensionService(
      { ...owner, commandLine: "node another-process.js" },
      join(directory, "service.pid"),
    ),
    false,
  );

  assert.equal(
    isExtensionService(
      { ...owner, startedAt: "boot-id:5678" },
      join(directory, "service.pid"),
    ),
    false,
  );

  assert.equal(
    isExtensionService(
      { ...owner, name: "vim" },
      join(directory, "service.pid"),
    ),
    false,
  );

  await writeFile(
    join(directory, "service.json"),
    JSON.stringify({ pid: owner.pid, commandLine: owner.commandLine }),
  );

  assert.equal(
    isExtensionService(owner, join(directory, "service.pid")),
    false,
  );
});
