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

  const result = await searchAgentMentions("claude", claudeReviewer, {
    [mentionTestModeEnv]: "0",
  });

  assert.equal(result.items[0]?.title, "Claude");

  assert.equal(
    result.items[0]?.description,
    "Delegate coding, investigation, or review work to Claude.",
  );

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
        [{ provider: "codex", profiles: ["reviewer"] }],
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
    assert.equal(result.items[0]?.name, "Claude");
    assert.match(result.items[0]?.title ?? "", /sample/i);

    assert.deepEqual(
      result.items[0]?.icons?.map((icon) => icon.theme),
      ["light", "dark"],
    );

    for (const [index, color] of ["#202124", "#f5f5f5"].entries()) {
      const icon = result.items[0]?.icons?.[index];

      assert.ok(icon);

      const svg = Buffer.from(
        icon.src.slice("data:image/svg+xml;base64,".length),
        "base64",
      ).toString("utf8");

      assert.match(svg, /viewBox="0 0 24 24"/);
      assert.match(svg, /fill="none"/);
      assert.match(svg, new RegExp(`stroke="${color}"`));
      assert.doesNotMatch(svg, /<(?:rect|circle|ellipse)\b|transform=/i);
    }

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
