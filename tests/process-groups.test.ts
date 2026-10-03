import { test } from "vitest";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  identifyLaunch,
  stopRecordedGroup,
  type ProcessGroups,
  type ProcessIdentity,
} from "../src/providers/process-groups.js";
import type { ExecutorRecord } from "../src/providers/executor-journal.js";
const launch = randomUUID();
const leader: ProcessIdentity = {
  pid: 12345,
  pgid: 12345,
  uid: process.getuid!(),
  started: "Wed Sep 30 12:00:00 2026",
  command: `codex exec-server -c log_dir=/runtime/${launch}/logs`,
};
const record: ExecutorRecord = {
  launch_id: launch,
  identity: "a".repeat(64),
  session_id: "sess_one",
  environment_id: "env_one",
  phase: "running",
  pid: leader.pid,
  process: { pgid: leader.pgid, uid: leader.uid, started: leader.started },
};
function setup() {
  let processes = [structuredClone(leader)];
  let alive = true;
  const signals: NodeJS.Signals[] = [];
  const groups: ProcessGroups = {
    list: async () => processes,
    exists: () => alive,
    signal: (_pid, value) => {
      signals.push(value);
      alive = false;
    },
  };
  return {
    groups,
    signals,
    replace: (next: ProcessIdentity[]) => {
      processes = next;
    },
    absent: () => {
      alive = false;
    },
  };
}
test("recovery recognizes a unique owned launch without persisting command arguments", async () => {
  const f = setup();
  assert.deepEqual(await identifyLaunch(launch, f.groups), {
    pid: leader.pid,
    pgid: leader.pgid,
    uid: leader.uid,
    started: leader.started,
  });
  f.replace([leader, { ...leader, pid: 12346, pgid: 12346 }]);
  await assert.rejects(identifyLaunch(launch, f.groups), /unique owned/);
  f.replace([{ ...leader, uid: leader.uid + 1 }]);
  await assert.rejects(identifyLaunch(launch, f.groups), /unique owned/);
});
test("recovery refuses to signal changed birth, owner, group, nonce, or missing leader", async () => {
  for (const change of [
    { started: "another birth" },
    { uid: leader.uid + 1 },
    { pgid: leader.pid + 1 },
    { command: "unrelated process" },
  ]) {
    const f = setup();
    f.replace([{ ...leader, ...change }]);
    await assert.rejects(
      stopRecordedGroup(record, f.groups, 0),
      /identity changed/,
    );
    assert.deepEqual(f.signals, []);
  }
  const f = setup();
  f.replace([]);
  await assert.rejects(
    stopRecordedGroup(record, f.groups, 0),
    /identity changed/,
  );
  assert.deepEqual(f.signals, []);
});
test("verified group shutdown sends TERM and confirms absence; absent groups need no signal", async () => {
  const f = setup();
  await stopRecordedGroup(record, f.groups, 0);
  assert.deepEqual(f.signals, ["SIGTERM"]);
  const absent = setup();
  absent.absent();
  await stopRecordedGroup(record, absent.groups, 0);
  assert.deepEqual(absent.signals, []);
});
test("recovery rechecks identity before escalation and cannot kill a reused leader", async () => {
  const f = setup();
  f.groups.signal = (_pid, signal) => {
    f.signals.push(signal);
    f.replace([{ ...leader, started: "reused PID" }]);
  };
  await assert.rejects(
    stopRecordedGroup(record, f.groups, 0),
    /identity changed/,
  );
  assert.deepEqual(f.signals, ["SIGTERM"]);
});
test("persistent owned groups escalate to KILL and a remaining group stays unconfirmed", async () => {
  const f = setup();
  f.groups.signal = (_pid, signal) => {
    f.signals.push(signal);
    if (signal === "SIGKILL") f.absent();
  };
  await stopRecordedGroup(record, f.groups, 0);
  assert.deepEqual(f.signals, ["SIGTERM", "SIGKILL"]);
  const stuck = setup();
  stuck.groups.signal = (_pid, signal) => {
    stuck.signals.push(signal);
  };
  await assert.rejects(
    stopRecordedGroup(record, stuck.groups, 0),
    /still exists/,
  );
});
test("legacy records without verified process identity cannot authorize a signal", async () => {
  const f = setup();
  await assert.rejects(
    stopRecordedGroup({ ...record, process: undefined }, f.groups),
    /no verified process/,
  );
  assert.deepEqual(f.signals, []);
});
