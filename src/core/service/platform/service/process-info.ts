import { execFileSync } from "node:child_process";
import { readFileSync, readlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export type ProcessInfo = {
  pid: number;
  name: string;
  executablePath?: string;
  commandLine?: string;
  startedAt: string;
};

export type ProcessIdentity = { commandLine: string; startedAt: string };

/** Returns enough stable process identity to display and recheck a lock owner. */
export function inspectProcess(pid: number): ProcessInfo | undefined {
  try {
    if (process.platform === "linux") return inspectLinuxProcess(pid);
    if (process.platform === "darwin") return inspectDarwinProcess(pid);
    if (process.platform === "win32") return inspectWindowsProcess(pid);
  } catch {
    // Process inspection is best-effort; never prevent startup from reporting the lock.
  }

  return undefined;
}

/** Captures only the identity fields needed by the service lock metadata. */
export function inspectProcessIdentity(
  pid: number,
): ProcessIdentity | undefined {
  try {
    if (process.platform === "linux") {
      const fields = readLinuxFields(pid);
      if (fields[0] === "Z" || fields[0] === "X") return;
      const startedAt = linuxStartedAt(fields);
      const commandLine = readLinuxCommandLine(pid);
      if (startedAt && commandLine) return { startedAt, commandLine };
    }

    if (process.platform === "darwin") {
      const processId = String(pid);
      const commandLine = run("ps", ["-ww", "-p", processId, "-o", "args="]);
      const startedAt = run("ps", ["-ww", "-p", processId, "-o", "lstart="]);
      if (commandLine && startedAt) return { commandLine, startedAt };
    }
  } catch {
    // A missing process identity disables termination rather than guessing.
  }

  return undefined;
}

export function isProcessRunning(pid: number) {
  let permissionDenied = false;

  try {
    process.kill(pid, 0);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") permissionDenied = true;
    else return true;
  }

  if (process.platform === "linux") {
    try {
      const state = readLinuxFields(pid)[0];

      return state !== "Z" && state !== "X";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return permissionDenied;
      }
    }
  }

  return true;
}

export function isSameProcess(first: ProcessInfo, second: ProcessInfo) {
  return (
    first.pid === second.pid &&
    first.startedAt === second.startedAt &&
    first.commandLine === second.commandLine &&
    (!first.executablePath ||
      !second.executablePath ||
      first.executablePath === second.executablePath)
  );
}

export function isExtensionService(owner: ProcessInfo, lockFile: string) {
  if (!owner.commandLine) return false;
  const runtime = basename(owner.executablePath ?? owner.name).toLowerCase();
  if (runtime !== "node" && runtime !== "node.exe") return false;

  let metadata: {
    pid?: number;
    startedAt?: string;
    commandLine?: string;
  };

  try {
    metadata = JSON.parse(
      readFileSync(join(dirname(lockFile), "service.json"), "utf8"),
    ) as typeof metadata;
  } catch {
    return false;
  }

  if (metadata.pid !== owner.pid) return false;

  if (
    typeof metadata.startedAt !== "string" ||
    metadata.startedAt !== owner.startedAt
  ) {
    return false;
  }

  return (
    typeof metadata.commandLine === "string" &&
    metadata.commandLine === owner.commandLine
  );
}

function inspectLinuxProcess(pid: number): ProcessInfo | undefined {
  const fields = readLinuxFields(pid);
  if (fields[0] === "Z" || fields[0] === "X") return;
  const startedAt = linuxStartedAt(fields);
  if (!startedAt) return;

  const root = `/proc/${pid}`;

  const commandLine = readLinuxCommandLine(pid);

  const executablePath = readlinkSync(`${root}/exe`).replace(
    / \(deleted\)$/,
    "",
  );

  return {
    pid,
    name: basename(executablePath),
    executablePath,
    commandLine,
    startedAt,
  };
}

function readLinuxCommandLine(pid: number) {
  return readFileSync(`/proc/${pid}/cmdline`, "utf8")
    .split("\0")
    .filter(Boolean)
    .join(" ");
}

function readLinuxFields(pid: number) {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");

  return stat
    .slice(stat.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/);
}

function linuxStartedAt(fields: string[]) {
  const ticks = fields[19];
  if (!ticks) return;

  try {
    const bootId = readFileSync(
      "/proc/sys/kernel/random/boot_id",
      "utf8",
    ).trim();

    return `${bootId}:${ticks}`;
  } catch {
    // Without a boot ID, tick counts can repeat after reboot and PID reuse.
  }

  return undefined;
}

function inspectDarwinProcess(pid: number): ProcessInfo | undefined {
  const processId = String(pid);
  const name = run("ps", ["-ww", "-p", processId, "-o", "comm="]);
  const commandLine = run("ps", ["-ww", "-p", processId, "-o", "args="]);
  const startedAt = run("ps", ["-ww", "-p", processId, "-o", "lstart="]);
  if (!name || !commandLine || !startedAt) return;

  let executablePath: string | undefined;

  try {
    const files = run("lsof", ["-a", "-p", processId, "-d", "txt", "-Fn"]);

    let descriptor = "";

    for (const line of files.split(/\r?\n/)) {
      if (line.startsWith("f")) descriptor = line.slice(1);
      if (!line.startsWith("n/")) continue;

      if (descriptor === "txt" && !executablePath) {
        executablePath = line.slice(1);
      }
    }
  } catch {
    // lsof may be unavailable or restricted; ps still provides useful details.
  }

  return {
    pid,
    name: executablePath ? basename(executablePath) : basename(name),
    executablePath,
    commandLine,
    startedAt,
  };
}

function inspectWindowsProcess(pid: number): ProcessInfo | undefined {
  const script =
    `$ErrorActionPreference = 'Stop'; ` +
    `Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | ` +
    "Select-Object Name,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress";

  const output = run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ]);

  if (!output) return;

  const info = JSON.parse(output) as {
    Name?: string;
    ExecutablePath?: string;
    CommandLine?: string;
    CreationDate?: string;
  };

  if (!info.CreationDate) return;

  return {
    pid,
    name: info.Name ?? "unknown",
    executablePath: info.ExecutablePath,
    commandLine: info.CommandLine,
    startedAt: info.CreationDate,
  };
}

function run(command: string, args: string[]) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 2000,
  }).trim();
}
