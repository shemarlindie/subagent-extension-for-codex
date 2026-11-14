import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { test, vi } from "vitest";

import { readyClaudeCli } from "../../../../../../tests/support/claude-cli.js";
import {
  input,
  setup,
  TestProvider,
  until,
} from "../../../tasks/runtime/control-test-harness.js";
import { ClaudeAgentProvider } from "./provider.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();

  return { ...fs, rm: vi.fn(fs.rm) };
});

test("Claude cleanup retries retain the task until leftover session data is removed", async () => {
  const fixture = new TestProvider();
  const { c, store, repo, dir } = await setup(fixture);
  const config = join(await realpath(dir), "claude");
  const sessionId = "12345678-1234-1234-1234-123456789abc";
  const project = join(config, "projects", "project");
  const transcript = join(project, `${sessionId}.jsonl`);
  const sessionDirectory = join(project, sessionId);
  const subagent = join(sessionDirectory, "subagents", "agent-child.jsonl");
  const toolResult = join(sessionDirectory, "tool-results", "result.txt");
  let directoryAttempts = 0;

  vi.stubEnv("CLAUDE_CONFIG_DIR", config);
  await mkdir(join(sessionDirectory, "subagents"), { recursive: true });
  await mkdir(join(sessionDirectory, "tool-results"), { recursive: true });
  await writeFile(transcript, "main transcript");
  await writeFile(subagent, "subagent transcript");
  await writeFile(toolResult, "saved tool result");

  const fs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );

  vi.mocked(rm).mockImplementation(async (path, options) => {
    if (path === sessionDirectory) {
      directoryAttempts++;

      if (directoryAttempts === 1) {
        throw Object.assign(new Error("leftover directory cleanup failed"), {
          code: "EACCES",
        });
      }

      // A filesystem may report success while another writer leaves data behind.
      if (directoryAttempts === 2) return;
    }

    return fs.rm(path, options);
  });

  const claude = new ClaudeAgentProvider(undefined, readyClaudeCli);

  fixture.deleteSession = (task, version) =>
    claude.deleteSession(task, version);

  fixture.sessionDeletionStatus = (task) => claude.sessionDeletionStatus(task);

  try {
    const task = await c.start("alice", input(repo, "[input]"));
    await until(() => !!store.get(task.id, "alice").pending_input);
    await c.interrupt("alice", task.id);
    const stopped = store.get(task.id, "alice");
    const { workspace } = stopped;
    assert.ok(workspace);
    stopped.session_id = sessionId;
    stopped.session_state_ref = transcript;
    store.save(stopped);

    for (const error of [
      /leftover directory cleanup failed/,
      /session data remains after cleanup/,
    ]) {
      await assert.rejects(c.delete("alice", task.id, true), error);
      const kept = store.get(task.id, "alice");
      assert.equal(kept.session_id, sessionId);
      assert.equal(kept.workspace, workspace);
      assert.equal(existsSync(workspace), true);
      assert.ok(store.events(task.id, "alice").length);
      assert.equal(existsSync(transcript), false);
      assert.equal(existsSync(subagent), true);
      assert.equal(existsSync(toolResult), true);

      assert.equal(
        (await c.taskDeletionPreview("alice", [task.id], true)).sessionDeletion
          .available,
        true,
      );
    }

    await c.delete("alice", task.id, true);
    assert.equal(existsSync(sessionDirectory), false);
    assert.equal(existsSync(workspace), false);
    assert.throws(() => store.get(task.id, "alice"), /not found/);
  } finally {
    vi.mocked(rm).mockImplementation(fs.rm);
    await c.close();
  }
});
