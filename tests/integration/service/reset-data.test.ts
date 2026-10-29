import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, type TestContext } from "vitest";

import { isProcessRunning } from "../../../src/service/platform/service/process-info.js";
import { freePort, serviceEnv, stopService } from "../../support/service.js";

function state(t: TestContext) {
  const data = mkdtempSync(join(tmpdir(), "reset-service-"));
  t.onTestFinished(() => rmSync(data, { recursive: true, force: true }));
  writeFileSync(join(data, "keep-me"), "old state");

  return data;
}

async function reset(data: string, answer: string, port = 17317) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "dev/service/reset-data.ts"],
    {
      env: serviceEnv({ data, port }),
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15_000,
    },
  );

  let output = "";

  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });

  child.stdout.on("data", (chunk: Buffer) => {
    if (chunk.toString().includes('Type "reset"')) {
      child.stdin.end(`${answer}\n`);
    }
  });

  const [code] = await once(child, "exit");
  expect(code, output).toBe(0);
}

test("declining preserves data", async (t) => {
  const data = state(t);
  await reset(data, "no");
  expect(readFileSync(join(data, "keep-me"), "utf8")).toBe("old state");
});

test("resets a stopped service without starting it", async (t) => {
  const data = state(t);
  await reset(data, "reset");
  expect(readdirSync(data)).toEqual([]);
});

test.skipIf(process.platform === "win32")(
  "resets and restarts a running service",
  async (t) => {
    const data = mkdtempSync(join(tmpdir(), "reset-running-service-"));
    const service = { data, port: await freePort() };

    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/service/main.ts"],
      {
        env: serviceEnv(service),
        stdio: "ignore",
      },
    );

    t.onTestFinished(async () => {
      try {
        if (existsSync(join(data, "service.pid"))) await stopService(service);
      } finally {
        child.kill("SIGKILL");
        rmSync(data, { recursive: true, force: true });
      }
    });

    const ready = () =>
      fetch(`http://127.0.0.1:${service.port}/health`)
        .then((response) => response.ok)
        .catch(() => false);

    await expect.poll(ready, { timeout: 10_000 }).toBe(true);
    const oldPid = Number(readFileSync(join(data, "service.pid"), "utf8"));
    writeFileSync(join(data, "discard-me"), "old state");

    await reset(data, "reset", service.port);
    expect(isProcessRunning(oldPid)).toBe(false);
    expect(existsSync(join(data, "discard-me"))).toBe(false);
    await expect.poll(ready, { timeout: 10_000 }).toBe(true);

    expect(Number(readFileSync(join(data, "service.pid"), "utf8"))).not.toBe(
      oldPid,
    );
  },
);
