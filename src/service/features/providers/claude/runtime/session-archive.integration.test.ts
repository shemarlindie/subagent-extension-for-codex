import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { listSessions } from "@anthropic-ai/claude-agent-sdk";
import { test, vi } from "vitest";

import { readyClaudeCli } from "../../../../../../tests/support/claude-cli.js";
import {
  input,
  setup,
  TestProvider,
  until,
} from "../../../tasks/runtime/control-test-harness.js";
import { setTasksArchived } from "../../../tasks/runtime/task-archive.js";
import { ClaudeAgentProvider } from "./provider.js";

test("archiving tasks archives their Claude sessions, and a missing session doesn't stop the archive", async () => {
  const claude = new ClaudeAgentProvider(undefined, readyClaudeCli);

  const fixture = Object.assign(new TestProvider(), {
    setSessionArchived: claude.setSessionArchived.bind(claude),
  });

  const { c, store, repo, dir } = await setup(fixture);
  const config = join(await realpath(dir), "claude");
  const project = join(config, "projects", "project");
  const found = "12345678-1234-1234-1234-123456789abc";
  const missing = "12345678-1234-1234-1234-123456789def";

  vi.stubEnv("CLAUDE_CONFIG_DIR", config);
  await mkdir(project, { recursive: true });

  await writeFile(
    join(project, `${found}.jsonl`),
    `${JSON.stringify({
      type: "user",
      message: { role: "user", content: "Investigate" },
      uuid: "1",
      sessionId: found,
      timestamp: new Date().toISOString(),
    })}\n`,
  );

  const archived = async () =>
    (await listSessions()).find((s) => s.sessionId === found)?.archived;

  try {
    // The missing session comes first, so its failure must not stop the rest.
    const ids: string[] = [];

    for (const sessionId of [missing, found]) {
      const t = await c.start("alice", input(repo));
      await until(() => store.get(t.id, "alice").status === "completed");
      const stopped = store.get(t.id, "alice");
      stopped.session_id = sessionId;
      stopped.session_state_ref = join(project, `${sessionId}.jsonl`);
      store.save(stopped);
      ids.push(t.id);
    }

    const archiving = setTasksArchived(c, "alice", ids, true);
    assert.deepEqual(archiving.result, { task_ids: ids, skipped: [] });
    await archiving.cleanup;
    assert.equal(await archived(), true);

    for (const id of ids) {
      assert.equal(store.get(id, "alice").workspace_removed, true);
    }

    await setTasksArchived(c, "alice", ids, false).cleanup;
    assert.equal(await archived(), false);
  } finally {
    await c.close();
  }
});
