import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { test } from "vitest";

import {
  mentionSearchLogFilename,
  mentionTestModeEnv,
  readClaudeMention,
  resolveMentionSearchEnv,
  searchAgentMentions,
} from "./mentions.js";

const claudeReviewer = [{ provider: "claude", profiles: ["reviewer"] }];

test("stdio mention settings use package-relative .env paths and keep MCP overrides", () => {
  const packageRoot = "/checkout";

  const localEnvironment = {
    CODEX_SUBAGENT_EXTENSION_DATA: ".codex-subagent-extension/live",
    [mentionTestModeEnv]: "1",
  };

  assert.deepEqual(resolveMentionSearchEnv({}, localEnvironment, packageRoot), {
    CODEX_SUBAGENT_EXTENSION_DATA: resolve(
      packageRoot,
      localEnvironment.CODEX_SUBAGENT_EXTENSION_DATA,
    ),
    [mentionTestModeEnv]: "1",
  });

  assert.deepEqual(
    resolveMentionSearchEnv(
      {
        CODEX_SUBAGENT_EXTENSION_DATA: "relative-from-cwd",
        [mentionTestModeEnv]: "0",
      },
      localEnvironment,
      packageRoot,
    ),
    {
      CODEX_SUBAGENT_EXTENSION_DATA: "relative-from-cwd",
      [mentionTestModeEnv]: "0",
    },
  );
});

test("composer mention search returns Claude for the server name and provider queries", async () => {
  for (const query of [
    "",
    "Claude",
    "review",
    "Delegate to Claude",
    "worker",
    "codex-subagent-extension",
    "codex-subagent-extension Claude",
  ]) {
    assert.equal(
      (
        await searchAgentMentions(query, claudeReviewer, {
          [mentionTestModeEnv]: "0",
        })
      ).items[0]?.name,
      "Claude",
    );
  }

  assert.deepEqual(
    (
      await searchAgentMentions("unrelated", claudeReviewer, {
        [mentionTestModeEnv]: "0",
      })
    ).items,
    [],
  );

  assert.deepEqual(
    (
      await searchAgentMentions(
        "Claude",
        [{ provider: "fixture", profiles: ["reviewer"] }],
        { [mentionTestModeEnv]: "0" },
      )
    ).items,
    [],
  );
});

test("mention test mode always returns a sample and logs the query as JSONL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-mention-test-"));

  const env = {
    CODEX_SUBAGENT_EXTENSION_DATA: directory,
    [mentionTestModeEnv]: "1",
  };

  try {
    const result = await searchAgentMentions("unmatched query", [], env);
    const [item] = result.items;
    assert.ok(item);
    assert.equal(item.name, "Claude");
    assert.match(item.title ?? "", /sample/i);
    const { icons } = item;
    assert.ok(icons);

    assert.deepEqual(
      icons.map((icon) => icon.theme),
      ["light", "dark"],
    );

    assert.match(
      (await readClaudeMention(env)).contents[0]?.text ?? "",
      /test-only/i,
    );

    const logPath = join(directory, mentionSearchLogFilename);
    const [line] = (await readFile(logPath, "utf8")).trim().split("\n");
    assert.ok(line);

    assert.deepEqual(JSON.parse(line), {
      timestamp: JSON.parse(line).timestamp,
      query: "unmatched query",
      providerCheckSkipped: true,
      resultNames: ["Claude"],
      testMode: true,
    });

    assert.equal((await stat(logPath)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
