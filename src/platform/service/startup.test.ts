import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { test } from "vitest";

import { inspectProcess, isProcessRunning } from "./process-info.js";

test("unverified service owner output separates details and never stops it", async (t) => {
  if (process.platform !== "linux" && process.platform !== "darwin") {
    t.skip("The process-inspection fallback is supported on macOS and Linux");

    return;
  }

  const directory = await mkdtemp(
    join(tmpdir(), `service-startup-${"x".repeat(120)}-`),
  );

  t.onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const owner = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });

  await once(owner, "spawn");

  t.onTestFinished(async () => {
    if (owner.exitCode !== null || owner.signalCode !== null) return;

    owner.kill("SIGKILL");
    await once(owner, "exit");
  });

  assert.ok(owner.pid);

  if (!inspectProcess(owner.pid)) {
    t.skip("This environment does not permit process inspection");

    return;
  }

  await writeFile(join(directory, "service.pid"), String(owner.pid));

  const startup = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: resolve("."),
    env: {
      ...process.env,
      CODEX_SUBAGENT_EXTENSION_DATA: directory,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  const stderr = startup.stderr;
  assert.ok(stderr);
  stderr.setEncoding("utf8");

  let output = "";

  stderr.on("data", (chunk: string) => {
    output += chunk;
  });

  t.onTestFinished(async () => {
    if (startup.exitCode !== null || startup.signalCode !== null) return;

    startup.kill("SIGKILL");
    await once(startup, "exit");
  });

  const [code] = await once(startup, "close");

  assert.equal(code, 1);

  assert.match(
    output,
    /A live service already owns this data directory\.\n\n {2}PID:/,
  );

  assert.match(output, /\n\nCould not verify/);
  assert.match(output, /No signal was sent\.\n\nAfter verifying/);
  assert.match(output, /stop it with:\n\n {2}kill -TERM \d+\n/);

  const lines = output.split("\n");

  const lockFileLine = lines.findIndex((line) =>
    line.startsWith("  Lock file: "),
  );

  assert.notEqual(lockFileLine, -1);
  assert.match(lines[lockFileLine + 1] ?? "", /^ {13}\S/);
  assert.equal(isProcessRunning(owner.pid), true);
}, 15000);
