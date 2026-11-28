import assert from "node:assert/strict";

import { test } from "vitest";

import { codexHost } from "./host.js";

test("Codex hints read only well-formed Codex metadata", () => {
  for (const meta of [
    undefined,
    {},
    { "codex/sandbox-state-meta": {} },
    { "codex/sandbox-state-meta": { sandboxCwd: 3 } },
    { "openai/session": 7 },
    { "openai/session": null, threadId: 7 },
    { host_directory: "file:///project", conversation_id: "chat" },
  ]) {
    assert.deepEqual(codexHost.hints(meta), {}, JSON.stringify(meta));
  }

  assert.deepEqual(
    codexHost.hints({
      "openai/session": "session",
      threadId: "thread",
      "codex/sandbox-state-meta": { sandboxCwd: "file:///project" },
    }),
    { conversation: "session", directory: "file:///project" },
  );

  assert.deepEqual(codexHost.hints({ threadId: "thread" }), {
    conversation: "thread",
  });
});
