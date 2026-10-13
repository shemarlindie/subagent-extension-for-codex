import { readFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

import { ExistingServiceError } from "./lease.js";
import {
  inspectProcess,
  isExtensionService,
  isProcessRunning,
  isSameProcess,
  type ProcessInfo,
} from "./process-info.js";
import { serve, type ServeOptions } from "./serve.js";
import {
  formatStartupOutput,
  formatStartupPrompt,
  type StartupOutputBlock,
} from "./startup-output.js";

export async function startService(options: ServeOptions = {}) {
  try {
    await serve(options);
  } catch (error) {
    if (!(error instanceof ExistingServiceError)) throw error;
    if (await handleExistingService(error)) await retryService(options);
  }
}

async function handleExistingService(error: ExistingServiceError) {
  const owner = inspectProcess(error.pid);

  if (!owner && !isProcessRunning(error.pid)) {
    writeStartupOutput([
      {
        type: "message",
        text: "The service exited before it could be inspected; retrying.",
      },
    ]);

    return true;
  }

  const verified = owner ? isExtensionService(owner, error.lockFile) : false;
  printOwner(error, owner);

  if (!owner) {
    writeStartupOutput(
      [
        {
          type: "message",
          text: "Could not safely inspect this process; no signal was sent.",
        },
      ],
      true,
    );

    process.exitCode = 1;

    return false;
  }

  if (owner.pid === process.pid) {
    writeStartupOutput(
      [
        {
          type: "message",
          text: "The lock refers to this process ID, but this startup did not acquire it. Inspect the lock file for a stale lock before removing it.",
        },
        {
          type: "fields",
          fields: [{ label: "Lock file", value: error.lockFile }],
        },
      ],
      true,
    );

    process.exitCode = 1;

    return false;
  }

  if (process.platform === "win32") {
    writeStartupOutput(
      [
        {
          type: "message",
          text: "Windows process info is shown above, but this command cannot safely verify or stop the service.",
        },
        {
          type: "message",
          text: "After verifying the executable, stop it in PowerShell with:",
        },
        { type: "command", text: `Stop-Process -Id ${owner.pid}` },
        { type: "message", text: "You can also stop it in Task Manager." },
      ],
      true,
    );

    process.exitCode = 1;

    return false;
  }

  if (!verified) {
    writeStartupOutput(
      [
        {
          type: "message",
          text: "Could not verify that this process owns the service lock. It may be a stale lock or an unrelated process. Verify the executable before stopping it manually. No signal was sent.",
        },
        {
          type: "message",
          text: "After verifying this is the right process, stop it with:",
        },
        { type: "command", text: `kill -TERM ${owner.pid}` },
      ],
      true,
    );

    process.exitCode = 1;

    return false;
  }

  if (!stdin.isTTY || !stdout.isTTY) {
    writeStartupOutput(
      [
        {
          type: "message",
          text: "Run this command in a terminal to stop the process here.",
        },
      ],
      true,
    );

    process.exitCode = 1;

    return false;
  }

  const readline = createInterface({ input: stdin, output: stdout });

  const ask = async (prompt: string) => {
    const controller = new AbortController();
    const onClose = () => controller.abort();
    const onInterrupt = () => readline.close();
    readline.once("close", onClose);
    readline.once("SIGINT", onInterrupt);

    try {
      return await readline.question(
        // Only a terminal reports its width.
        formatStartupPrompt(prompt, stdout.isTTY ? stdout.columns : 100),
        {
          signal: controller.signal,
        },
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      throw error;
    } finally {
      readline.off("close", onClose);
      readline.off("SIGINT", onInterrupt);
    }
  };

  try {
    const answer = await ask("Send SIGTERM to this process and retry startup?");

    if (answer === undefined) {
      process.exitCode = 130;

      return false;
    }

    if (!isYes(answer)) {
      process.exitCode = 1;

      return false;
    }

    if (!lockStillBelongsTo(error)) {
      writeStartupOutput(
        [
          {
            type: "message",
            text: "The service lock changed; no process was stopped.",
          },
        ],
        true,
      );

      process.exitCode = 1;

      return false;
    }

    const state = processIdentityState(owner);
    const changedOutcome = processIdentityOutcome(state, error.lockFile);

    if (changedOutcome !== undefined) return changedOutcome;

    if (state === "unknown") {
      writeStartupOutput(
        [
          {
            type: "message",
            text: "Could not recheck process identity; no signal was sent.",
          },
        ],
        true,
      );

      process.exitCode = 1;

      return false;
    }

    const signalResult = sendSignal(owner.pid, "SIGTERM");

    if (signalResult === "denied") {
      writeStartupOutput(
        [
          {
            type: "message",
            text: "Permission was denied; the process was not stopped.",
          },
        ],
        true,
      );

      process.exitCode = 1;

      return false;
    }

    if (signalResult === "gone") {
      writeStartupOutput(
        [
          {
            type: "message",
            text: "The original process has already exited; retrying startup.",
          },
        ],
        true,
      );

      return true;
    }

    if (await waitForProcessToStop(error, 5000)) {
      if (!isProcessRunning(owner.pid)) reportProcessStopped(owner.pid);

      return true;
    }

    const stateBeforeForce = processIdentityState(owner);

    const forceOutcome = processIdentityOutcome(
      stateBeforeForce,
      error.lockFile,
    );

    if (forceOutcome !== undefined) return forceOutcome;

    if (stateBeforeForce === "unknown") {
      writeStartupOutput(
        [
          {
            type: "message",
            text: "Could not recheck process identity; no force kill was sent.",
          },
        ],
        true,
      );

      process.exitCode = 1;

      return false;
    }

    const force = await ask(
      "It is still running. Force terminate it with SIGKILL?",
    );

    if (force === undefined) {
      process.exitCode = 130;

      return false;
    }

    if (!isYes(force)) {
      process.exitCode = 1;

      return false;
    }

    if (!lockStillBelongsTo(error)) {
      writeStartupOutput(
        [
          {
            type: "message",
            text: "The service lock changed; no force kill was sent.",
          },
        ],
        true,
      );

      process.exitCode = 1;

      return false;
    }

    const stateBeforeSignal = processIdentityState(owner);

    const signalOutcome = processIdentityOutcome(
      stateBeforeSignal,
      error.lockFile,
    );

    if (signalOutcome !== undefined) return signalOutcome;

    if (stateBeforeSignal === "unknown") {
      writeStartupOutput(
        [
          {
            type: "message",
            text: "Could not recheck process identity; no force kill was sent.",
          },
        ],
        true,
      );

      process.exitCode = 1;

      return false;
    }

    const forceResult = sendSignal(owner.pid, "SIGKILL");

    if (forceResult === "denied") {
      writeStartupOutput(
        [
          {
            type: "message",
            text: "Permission was denied; the process was not stopped.",
          },
        ],
        true,
      );

      process.exitCode = 1;

      return false;
    }

    if (forceResult === "gone") {
      writeStartupOutput(
        [
          {
            type: "message",
            text: "The original process has already exited; retrying startup.",
          },
        ],
        true,
      );

      return true;
    }

    if (await waitForProcessToStop(error, 5000)) {
      if (!isProcessRunning(owner.pid)) reportProcessStopped(owner.pid);

      return true;
    }

    writeStartupOutput(
      [
        {
          type: "message",
          text: "The process is still running; no new service was started.",
        },
      ],
      true,
    );

    process.exitCode = 1;

    return false;
  } finally {
    readline.close();
  }
}

async function retryService(options: ServeOptions) {
  // Separate the retried service banner from the process-conflict output above.
  process.stderr.write("\n");

  try {
    await serve(options);
  } catch (error) {
    if (!(error instanceof ExistingServiceError)) throw error;

    writeStartupOutput([
      {
        type: "message",
        text: "Another live service now owns the data directory.",
      },
      {
        type: "fields",
        fields: [
          { label: "PID", value: String(error.pid) },
          { label: "Lock file", value: error.lockFile },
        ],
      },
    ]);

    process.exitCode = 1;
  }
}

function printOwner(
  error: ExistingServiceError,
  owner: ProcessInfo | undefined,
) {
  const fields = [
    ["PID", String(error.pid)],
    ["Process", owner?.name ?? "unavailable"],
    ["Executable", owner?.executablePath ?? "unavailable"],
    ["Lock file", error.lockFile],
  ];

  if (owner?.commandLine && stdin.isTTY && stdout.isTTY) {
    fields.push(["Command", owner.commandLine]);
  }

  writeStartupOutput([
    { type: "message", text: `${error.message}.` },
    {
      type: "fields",
      fields: fields.map(([label, value]) => ({ label, value })),
    },
  ]);
}

function writeStartupOutput(
  blocks: readonly StartupOutputBlock[],
  leadingBlank = false,
) {
  process.stderr.write(
    formatStartupOutput(blocks, {
      leadingBlank,
      width: Math.max(40, process.stderr.isTTY ? process.stderr.columns : 100),
    }),
  );
}

function reportProcessStopped(pid: number) {
  writeStartupOutput(
    [{ type: "message", text: `Process ${pid} stopped; retrying startup.` }],
    true,
  );
}

function lockStillBelongsTo(error: ExistingServiceError) {
  try {
    return readFileSync(error.lockFile, "utf8") === String(error.pid);
  } catch {
    return false;
  }
}

function isYes(answer: string) {
  const normalized = answer.trim().toLowerCase();

  return normalized === "y" || normalized === "yes";
}

function processIdentityState(original: ProcessInfo) {
  const current = inspectProcess(original.pid);
  if (!current) return isProcessRunning(original.pid) ? "unknown" : "gone";

  return isSameProcess(original, current) ? "same" : "changed";
}

function processIdentityOutcome(
  state: ReturnType<typeof processIdentityState>,
  lockFile: string,
) {
  if (state === "gone") {
    writeStartupOutput(
      [
        {
          type: "message",
          text: "The original process has already exited; retrying startup.",
        },
      ],
      true,
    );

    return true;
  }

  if (state === "changed") {
    writeStartupOutput(
      [
        {
          type: "message",
          text: "The process identity changed; no signal was sent. Inspect the current lock owner and lock file before retrying.",
        },
        { type: "fields", fields: [{ label: "Lock file", value: lockFile }] },
      ],
      true,
    );

    process.exitCode = 1;

    return false;
  }
}

function sendSignal(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(pid, signal);

    return "sent";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return "gone";
    if (code === "EPERM") return "denied";
    throw error;
  }
}

async function waitForProcessToStop(
  error: ExistingServiceError,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!lockStillBelongsTo(error) || !isProcessRunning(error.pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return !lockStillBelongsTo(error) || !isProcessRunning(error.pid);
}
