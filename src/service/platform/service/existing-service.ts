import { readFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { createInterface, type Interface } from "node:readline/promises";

import type { ExistingServiceError } from "./lease.js";
import {
  inspectProcess,
  isExtensionService,
  isProcessRunning,
  isSameProcess,
  type ProcessInfo,
} from "./process-info.js";
import {
  formatStartupPrompt,
  type StartupOutputBlock,
  writeStartupOutput,
} from "./startup-output.js";

type Signal = "SIGTERM" | "SIGKILL";

/** What each stop attempt asks, and what it reports when it sends nothing. */
const STOP_STEPS = {
  SIGTERM: {
    prompt: "Send SIGTERM to this process and retry startup?",
    lockChanged: "no process was stopped",
    unchecked: "no signal was sent",
  },
  SIGKILL: {
    prompt: "It is still running. Force terminate it with SIGKILL?",
    lockChanged: "no force kill was sent",
    unchecked: "no force kill was sent",
  },
} satisfies Record<Signal, Record<string, string>>;

/**
 * Handles startup finding another process holding the service lock. Shows the
 * owner, and only for a verified service in a terminal offers to stop it:
 * SIGTERM first, then SIGKILL if it is still running. Resolves true when
 * startup should retry; otherwise sets the exit code.
 */
export async function handleExistingService(error: ExistingServiceError) {
  const owner = inspectProcess(error.pid);

  if (!owner && !isProcessRunning(error.pid)) {
    writeStartupOutput([
      message("The service exited before it could be inspected; retrying."),
    ]);

    return true;
  }

  printOwner(error, owner);

  if (!owner) {
    return refuse(
      message("Could not safely inspect this process; no signal was sent."),
    );
  }

  const reason = cannotStop(error, owner);
  if (reason) return refuse(...reason);

  const readline = createInterface({ input: stdin, output: stdout });
  const ask = (prompt: string) => question(readline, prompt);

  try {
    const terminated = await stop(error, owner, "SIGTERM", ask);
    if (terminated !== "running") return terminated;

    // Recheck before asking again, since the process may have changed meanwhile.
    const changed = recheckIdentity(
      owner,
      error.lockFile,
      STOP_STEPS.SIGKILL.unchecked,
    );

    if (changed !== undefined) return changed;
    const killed = await stop(error, owner, "SIGKILL", ask);
    if (killed !== "running") return killed;

    return refuse(
      message("The process is still running; no new service was started."),
    );
  } finally {
    readline.close();
  }
}

/** Why startup must not offer to stop the owner, or undefined when it may. */
function cannotStop(
  error: ExistingServiceError,
  owner: ProcessInfo,
): StartupOutputBlock[] | undefined {
  if (owner.pid === process.pid) {
    return [
      message(
        "The lock refers to this process ID, but this startup did not acquire it. Inspect the lock file for a stale lock before removing it.",
      ),
      { type: "fields", fields: [lockFileField(error.lockFile)] },
    ];
  }

  if (process.platform === "win32") {
    return [
      message(
        "Windows process info is shown above, but this command cannot safely verify or stop the service.",
      ),
      message("After verifying the executable, stop it in PowerShell with:"),
      { type: "command", text: `Stop-Process -Id ${owner.pid}` },
      message("You can also stop it in Task Manager."),
    ];
  }

  if (!isExtensionService(owner, error.lockFile)) {
    return [
      message(
        "Could not verify that this process owns the service lock. It may be a stale lock or an unrelated process. Verify the executable before stopping it manually. No signal was sent.",
      ),
      message("After verifying this is the right process, stop it with:"),
      { type: "command", text: `kill -TERM ${owner.pid}` },
    ];
  }

  if (!stdin.isTTY || !stdout.isTTY) {
    return [
      message("Run this command in a terminal to stop the process here."),
    ];
  }

  return undefined;
}

/**
 * Asks to send `signal`, then sends it if the lock and process are unchanged.
 * Resolves true when startup should retry, false when it should stop, and
 * "running" when the process outlived the signal.
 */
async function stop(
  error: ExistingServiceError,
  owner: ProcessInfo,
  signal: Signal,
  ask: (prompt: string) => Promise<string | undefined>,
): Promise<boolean | "running"> {
  const step = STOP_STEPS[signal];
  const answer = await ask(step.prompt);

  if (answer === undefined || !isYes(answer)) {
    // Ctrl+C or a closed input exits as interrupted; any other answer declines.
    process.exitCode = answer === undefined ? 130 : 1;

    return false;
  }

  if (!lockStillBelongsTo(error)) {
    return refuse(message(`The service lock changed; ${step.lockChanged}.`));
  }

  const changed = recheckIdentity(owner, error.lockFile, step.unchecked);
  if (changed !== undefined) return changed;
  const result = sendSignal(owner.pid, signal);

  if (result === "denied") {
    return refuse(
      message("Permission was denied; the process was not stopped."),
    );
  }

  if (result === "gone") return reportAlreadyExited();

  if (await waitForProcessToStop(error, 5000)) {
    if (!isProcessRunning(owner.pid)) {
      writeStartupOutput(
        [message(`Process ${owner.pid} stopped; retrying startup.`)],
        true,
      );
    }

    return true;
  }

  return "running";
}

/** Prompts in the terminal; resolves undefined when the user interrupts or input closes. */
async function question(readline: Interface, prompt: string) {
  const controller = new AbortController();
  const onClose = () => controller.abort();
  const onInterrupt = () => readline.close();
  readline.once("close", onClose);
  readline.once("SIGINT", onInterrupt);

  try {
    return await readline.question(
      // Only a terminal reports its width.
      formatStartupPrompt(prompt, stdout.isTTY ? stdout.columns : 100),
      { signal: controller.signal },
    );
  } catch (error) {
    if (controller.signal.aborted) return undefined;
    throw error;
  } finally {
    readline.off("close", onClose);
    readline.off("SIGINT", onInterrupt);
  }
}

function printOwner(
  error: ExistingServiceError,
  owner: ProcessInfo | undefined,
) {
  const fields: [label: string, value: string][] = [
    ["PID", String(error.pid)],
    ["Process", owner?.name ?? "unavailable"],
    ["Executable", owner?.executablePath ?? "unavailable"],
    ["Lock file", error.lockFile],
  ];

  if (owner?.commandLine && stdin.isTTY && stdout.isTTY) {
    fields.push(["Command", owner.commandLine]);
  }

  writeStartupOutput([
    message(`${error.message}.`),
    {
      type: "fields",
      fields: fields.map(([label, value]) => ({ label, value })),
    },
  ]);
}

/** Reports why startup stops without starting a service, and fails the command. */
function refuse(...blocks: StartupOutputBlock[]): false {
  writeStartupOutput(blocks, true);
  process.exitCode = 1;

  return false;
}

function message(text: string): StartupOutputBlock {
  return { type: "message", text };
}

function lockFileField(lockFile: string) {
  return { label: "Lock file", value: lockFile };
}

function reportAlreadyExited() {
  writeStartupOutput(
    [message("The original process has already exited; retrying startup.")],
    true,
  );

  return true;
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

/**
 * Checks that the owner is still the process the user was shown. Resolves
 * true when it has exited, so startup retries, and false when it changed or
 * can't be checked; undefined when it is unchanged.
 */
function recheckIdentity(
  original: ProcessInfo,
  lockFile: string,
  unchecked: string,
) {
  const current = inspectProcess(original.pid);

  if (!current) {
    return isProcessRunning(original.pid)
      ? refuse(message(`Could not recheck process identity; ${unchecked}.`))
      : reportAlreadyExited();
  }

  if (isSameProcess(original, current)) return undefined;

  return refuse(
    message(
      "The process identity changed; no signal was sent. Inspect the current lock owner and lock file before retrying.",
    ),
    { type: "fields", fields: [lockFileField(lockFile)] },
  );
}

function sendSignal(pid: number, signal: Signal) {
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
