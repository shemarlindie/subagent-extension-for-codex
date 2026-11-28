import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { listSessions } from "@anthropic-ai/claude-agent-sdk";
import { test, vi } from "vitest";

import { readyClaudeCli } from "../../../../../tests/support/claude-cli.js";
import {
  input,
  setup,
  TestProvider,
  until,
} from "../../../../core/service/features/tasks/runtime/control-test-harness.js";
import { setTasksArchived } from "../../../../core/service/features/tasks/runtime/task-archive.js";
import { ClaudeAgentProvider } from "./provider.js";

test("archiving tasks archives their Claude sessions, skipping missing and duplicated ones", async () => {
  const claude = new ClaudeAgentProvider(undefined, readyClaudeCli);

  const fixture = Object.assign(new TestProvider(), {
    setSessionArchived: claude.setSessionArchived.bind(claude),
  });

  const { c, store, repo, dir } = await setup(fixture);
  const projects = join(await realpath(dir), "claude", "projects");
  const [project, other] = [join(projects, "project"), join(projects, "other")];
  const found = "12345678-1234-1234-1234-123456789abc";
  const missing = "12345678-1234-1234-1234-123456789def";
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(projects, ".."));

  const writeTranscript = async (folder: string) => {
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
  };

  const archived = async () =>
    (await listSessions()).find((s) => s.sessionId === found)?.archived;

  try {
    const first = (await c.start("alice", input(repo))).id;
    const last = (await c.start("alice", input(repo))).id;
    const ids = [first, last];

    await until(() =>
      ids.every((id) => store.get(id, "alice").status === "completed"),
    );

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

    await writeTranscript(project);
    const archiving = setTasksArchived(c, "alice", ids, true);
    assert.deepEqual(archiving.result, { task_ids: ids, skipped: [] });
    await archiving.cleanup;
    assert.equal(await archived(), true);

    for (const id of ids) {
      assert.equal(store.get(id, "alice").workspace_removed, true);
    }

    await setTasksArchived(c, "alice", ids, false).cleanup;
    assert.equal(await archived(), false);

    // A copy in another project folder would be marked too, so neither is.
    await writeTranscript(other);
    await setTasksArchived(c, "alice", ids, true).cleanup;
    assert.equal(existsSync(join(other, found)), false);

    const mark = JSON.parse(
      await readFile(join(project, found, "archived.json"), "utf8"),
    ) as { archived: boolean };

    assert.equal(mark.archived, false);
  } finally {
    await c.close();
  }
});
