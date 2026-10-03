import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { UnconfirmedTerminationError } from "../core/model.js";
import type { ExecutorRecord } from "./executor-journal.js";

export interface ProcessIdentity {
  pid: number;
  pgid: number;
  uid: number;
  started: string;
  command: string;
}
export interface ProcessGroups {
  list(): Promise<ProcessIdentity[]>;
  exists(pgid: number): boolean;
  signal(pgid: number, signal: NodeJS.Signals): void;
}
const exec = promisify(execFile);
export const macProcessGroups: ProcessGroups = {
  async list() {
    const { stdout } = await exec(
      "/bin/ps",
      ["-ww", "-axo", "pid=,pgid=,uid=,lstart=,command="],
      {
        env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
        timeout: 5000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    return stdout.split("\n").flatMap((line) => {
      const match = line.match(
        /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/,
      );
      return match
        ? [
            {
              pid: Number(match[1]),
              pgid: Number(match[2]),
              uid: Number(match[3]),
              started: match[4].replace(/\s+/g, " "),
              command: match[5],
            },
          ]
        : [];
    });
  },
  exists(pgid) {
    if (!Number.isSafeInteger(pgid) || pgid <= 1)
      throw new Error("Invalid executor process group");
    try {
      process.kill(-pgid, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
      throw error;
    }
  },
  signal(pgid, signal) {
    if (!Number.isSafeInteger(pgid) || pgid <= 1)
      throw new Error("Invalid executor process group");
    try {
      process.kill(-pgid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  },
};
const owned = (p: ProcessIdentity, launch: string) =>
  p.pid > 1 &&
  p.pid === p.pgid &&
  p.uid === process.getuid?.() &&
  p.command.includes(launch);

export async function waitForGroupExit(
  pgid: number,
  groups: ProcessGroups = macProcessGroups,
  graceMs = 2000,
) {
  const deadline = Date.now() + graceMs;
  while (groups.exists(pgid) && Date.now() < deadline) await delay(25);
  return !groups.exists(pgid);
}

export async function identifyLaunch(
  launch: string,
  groups: ProcessGroups = macProcessGroups,
  pid?: number,
) {
  const matches = (await groups.list()).filter(
    (p) => owned(p, launch) && (pid === undefined || p.pid === pid),
  );
  if (matches.length !== 1)
    throw new UnconfirmedTerminationError(
      [],
      "Executor launch has no unique owned process-group leader",
    );
  const { command: _command, ...identity } = matches[0];
  return identity;
}

/** Only signal a leader matching the persisted birth, owner, group and launch nonce. */
export async function stopRecordedGroup(
  record: ExecutorRecord,
  groups: ProcessGroups = macProcessGroups,
  graceMs = 2000,
) {
  if (!record.pid || !record.process)
    throw new UnconfirmedTerminationError(
      [],
      "Executor record has no verified process identity",
    );
  const pid = record.pid;
  const verify = async () => {
    const p = (await groups.list()).find((p) => p.pid === pid);
    if (
      !p ||
      !owned(p, record.launch_id) ||
      p.pgid !== record.process!.pgid ||
      p.uid !== record.process!.uid ||
      p.started !== record.process!.started
    )
      throw new UnconfirmedTerminationError(
        [],
        "Executor process identity changed; refusing to signal its PID",
      );
  };
  if (!groups.exists(pid)) return;
  await verify();
  groups.signal(pid, "SIGTERM");
  if (await waitForGroupExit(pid, groups, graceMs)) return;
  await verify();
  groups.signal(pid, "SIGKILL");
  if (!(await waitForGroupExit(pid, groups, graceMs)))
    throw new UnconfirmedTerminationError(
      [],
      "Executor process group still exists after recovery shutdown",
    );
}
