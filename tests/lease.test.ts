import assert from "node:assert/strict";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { lease } from "../src/service/lease.js";

test("service lock validates a live PID and prevents concurrent recovery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ac-lease-"));
  const release = lease(dir);
  assert.throws(() => lease(dir), /live service/);
  release();
  await assert.rejects(access(join(dir, "service.pid")));
  const release2 = lease(dir);
  release2();
});

test("stale lock recovery requires an absent process and malformed lock fails closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ac-lease-"));
  await writeFile(join(dir, "service.pid"), "99999999");
  const release = lease(dir);
  release();
  await writeFile(join(dir, "service.pid"), "not-a-pid");
  assert.throws(() => lease(dir), /Invalid service lock/);
});
