import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import {
  isExtensionService,
  isProcessRunning,
  isSameProcess,
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
