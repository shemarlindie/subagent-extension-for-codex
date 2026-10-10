import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serve: vi.fn(async () => undefined),
  inspectProcess: vi.fn((_pid: number): unknown => undefined),
  isExtensionService: vi.fn((_owner: unknown, _lockFile: string) => false),
  isProcessRunning: vi.fn((_pid: number) => false),
  isSameProcess: vi.fn((_first: unknown, _second: unknown) => false),
  createInterface: vi.fn(),
}));

vi.mock("./serve.js", () => ({ serve: mocks.serve }));

vi.mock("./process-info.js", () => ({
  inspectProcess: mocks.inspectProcess,
  isExtensionService: mocks.isExtensionService,
  isProcessRunning: mocks.isProcessRunning,
  isSameProcess: mocks.isSameProcess,
}));

vi.mock("node:readline/promises", () => ({
  createInterface: mocks.createInterface,
}));

import { ExistingServiceError } from "./lease.js";
import type { ProcessInfo } from "./process-info.js";
import { startService } from "./startup.js";

function setTerminalInput(t: import("vitest").TestContext) {
  const inputTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const outputTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  const exitCode = process.exitCode;

  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  });

  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: true,
  });

  t.onTestFinished(() => {
    if (inputTTY) Object.defineProperty(process.stdin, "isTTY", inputTTY);
    else Reflect.deleteProperty(process.stdin, "isTTY");

    if (outputTTY) Object.defineProperty(process.stdout, "isTTY", outputTTY);
    else Reflect.deleteProperty(process.stdout, "isTTY");

    process.exitCode = exitCode;
  });
}

async function setup(
  t: import("vitest").TestContext,
  answer: string,
  owner: ProcessInfo,
) {
  const directory = await mkdtemp(join(tmpdir(), "service-startup-flow-"));
  t.onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const lockFile = join(directory, "service.pid");
  await writeFile(lockFile, String(owner.pid));

  const readline = {
    close: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    question: vi.fn(async (_prompt: string) => answer),
  };

  mocks.serve
    .mockRejectedValueOnce(new ExistingServiceError(owner.pid, lockFile))
    .mockResolvedValueOnce(undefined);

  mocks.inspectProcess.mockReturnValue(owner);
  mocks.isExtensionService.mockReturnValue(true);
  mocks.isProcessRunning.mockReturnValue(false);
  mocks.isSameProcess.mockReturnValue(true);
  mocks.createInterface.mockReturnValue(readline);

  vi.spyOn(console, "error").mockImplementation(() => {});

  const stderrWrite = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);

  setTerminalInput(t);

  return { lockFile, readline, stderrWrite };
}

beforeEach(() => {
  vi.resetAllMocks();
});

test("does not signal the verified owner unless the user confirms", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows uses manual process handling");

    return;
  }

  const owner: ProcessInfo = {
    pid: process.pid + 1000,
    name: "node",
    executablePath: process.execPath,
    commandLine: "node src/service/main.ts",
    startedAt: "started-at-test-value",
  };

  const { readline } = await setup(t, "n", owner);
  const kill = vi.spyOn(process, "kill");

  await startService();

  assert.equal(
    readline.question.mock.calls[0]?.[0],
    "\nSend SIGTERM to this process and retry startup? [y/N] ",
  );

  assert.equal(kill.mock.calls.length, 0);
  assert.equal(mocks.serve.mock.calls.length, 1);
  assert.equal(process.exitCode, 1);
});

test("sends SIGTERM only after confirmation and retries startup", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows uses manual process handling");

    return;
  }

  const owner: ProcessInfo = {
    pid: process.pid + 1000,
    name: "node",
    executablePath: process.execPath,
    commandLine: "node src/service/main.ts",
    startedAt: "started-at-test-value",
  };

  const { readline, stderrWrite } = await setup(t, "yes", owner);
  const kill = vi.spyOn(process, "kill").mockReturnValue(true);

  await startService({ network: true });
  expect(mocks.serve).toHaveBeenNthCalledWith(1, { network: true });
  expect(mocks.serve).toHaveBeenNthCalledWith(2, { network: true });

  assert.equal(
    readline.question.mock.calls[0]?.[0],
    "\nSend SIGTERM to this process and retry startup? [y/N] ",
  );

  assert.deepEqual(kill.mock.calls, [[owner.pid, "SIGTERM"]]);
  assert.equal(mocks.serve.mock.calls.length, 2);
  assert.equal(readline.close.mock.calls.length, 1);

  assert.match(
    stderrWrite.mock.calls.map(([chunk]) => String(chunk)).join(""),
    new RegExp(`Process ${owner.pid} stopped; retrying startup\\.\\n\\n`),
  );
});

test("does not signal if process identity changes after confirmation", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows uses manual process handling");

    return;
  }

  const owner: ProcessInfo = {
    pid: process.pid + 1000,
    name: "node",
    executablePath: process.execPath,
    commandLine: "node src/service/main.ts",
    startedAt: "started-at-test-value",
  };

  const { readline } = await setup(t, "yes", owner);

  mocks.inspectProcess
    .mockReset()
    .mockReturnValueOnce(owner)
    .mockReturnValueOnce({ ...owner, startedAt: "different-process" });

  mocks.isSameProcess.mockReturnValue(false);
  const kill = vi.spyOn(process, "kill");

  await startService();

  assert.equal(readline.question.mock.calls.length, 1);
  assert.equal(kill.mock.calls.length, 0);
  assert.equal(mocks.serve.mock.calls.length, 1);
  assert.equal(process.exitCode, 1);
});
