import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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
  const found = "12345678-1234-1234-1234-123456789abc";
  const missing = "12345678-1234-1234-1234-123456789def";
  vi.stubEnv("CLAUDE_CONFIG_DIR", config);

  try {
    const first = (await c.start("alice", input(repo))).id;
    const last = (await c.start("alice", input(repo))).id;
    const ids = [first, last];

    await until(() =>
      ids.every((id) => store.get(id, "alice").status === "completed"),
    );

    // Claude Code names a session's project folder after the real path it
    // ran in. The same session ID in another project keeps its mark.
    const { workspace } = store.get(last, "alice");
    assert.ok(workspace);
    const real = await realpath(workspace);

    const projects = join(config, "projects");
    const project = join(projects, real.replace(/[^a-zA-Z0-9]/g, "-"));
    const other = join(projects, "other");

    // The missing session comes first, so its failure must not stop the rest.
    for (const [id, sessionId] of [
      [first, missing],
      [last, found],
    ] as const) {
      const t = store.get(id, "alice");
      t.session_id = sessionId;
      t.session_state_ref = join(project, `${sessionId}.jsonl`);
      store.save(t);
    }

    for (const folder of [project, other]) {
      await mkdir(folder, { recursive: true });

      await writeFile(
        join(folder, `${found}.jsonl`),
        `${JSON.stringify({
          type: "user",
          message: { role: "user", content: "Investigate" },
          uuid: "1",
          sessionId: found,
          timestamp: new Date().toISOString(),
        })}\n`,
      );
    }

    const archived = async () =>
      (await listSessions({ dir: real })).find((s) => s.sessionId === found)
        ?.archived;

    const archiving = setTasksArchived(c, "alice", ids, true);
    assert.deepEqual(archiving.result, { task_ids: ids, skipped: [] });
    await archiving.cleanup;
    assert.equal(await archived(), true);
    assert.equal(existsSync(join(other, found)), false);

    for (const id of ids) {
      assert.equal(store.get(id, "alice").workspace_removed, true);
    }

    // The worktree is gone now, so the session is found through its parent.
    await setTasksArchived(c, "alice", ids, false).cleanup;
    assert.equal(await archived(), false);
  } finally {
    await c.close();
  }
});
