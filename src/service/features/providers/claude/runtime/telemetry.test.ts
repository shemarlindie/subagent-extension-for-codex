import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, vi } from "vitest";

import { readyClaudeCli } from "../../../../../../tests/support/claude-cli.js";
import {
  configureLogging,
  flushLogs,
} from "../../../../platform/logging/logger.js";
import { context } from "./claude-test-harness.js";
import { ClaudeAgentProvider } from "./provider.js";

test("records first event and text once, preserves usage and refreshes session references without logging content", async (t) => {
  const { c, sessions, workspace } = await context();
  const path = join(workspace, "provider.jsonl");
  configureLogging(path);

  t.onTestFinished(async () => {
    await flushLogs();
    configureLogging(undefined);
  });

  const launch = (() =>
    Object.assign(
      (async function* () {
        yield {
          type: "stream_event",
          session_id: "session-a",
          parent_tool_use_id: null,
          event: { type: "message_start", message: { id: "message-1" } },
        };

        for (const session_id of ["session-a", "session-a", "session-b"]) {
          yield {
            type: "stream_event",
            session_id,
            parent_tool_use_id: null,
            event: {
              type: "content_block_delta",
              delta: { type: "text_delta", text: "private-stream-text" },
            },
          };
        }

        yield {
          type: "result",
          session_id: "session-b",
          subtype: "success",
          is_error: false,
          result: "private-final-reply",
          total_cost_usd: 0.2,
          duration_api_ms: 123,
          num_turns: 2,
          usage: {
            input_tokens: 100,
            output_tokens: 40,
            cache_read_input_tokens: 30,
            cache_creation_input_tokens: 20,
          },
        };
      })(),
      { close() {} },
    )) as unknown as ConstructorParameters<typeof ClaudeAgentProvider>[0];

  const provider = new ClaudeAgentProvider(launch, undefined, readyClaudeCli);

  const sessionPath = vi
    .spyOn(provider, "sessionPath")
    .mockImplementation(async (id) => `private-session-path/${id}`)
    .mockResolvedValueOnce("private-guessed-session-path");

  expect(await provider.run(c, "private-prompt-text")).toEqual({
    reply: "private-final-reply",
  });

  expect(sessionPath).toHaveBeenCalledWith("session-a", workspace);
  expect(sessionPath).toHaveBeenCalledWith("session-b", workspace);

  expect(sessions[0]).toEqual({
    id: "session-a",
    ref: "private-guessed-session-path",
  });

  expect(sessions[1]).toEqual({
    id: "session-a",
    ref: "private-session-path/session-a",
  });

  await flushLogs();
  const text = await readFile(path, "utf8");

  const records: Record<string, unknown>[] = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  for (const event of ["provider.first_event", "provider.first_text"]) {
    const matching = records.filter((record) => record.event === event);
    expect(matching).toHaveLength(1);
    expect(matching[0]?.duration_ms).toEqual(expect.any(Number));
    expect(matching[0]?.duration_ms).toBeGreaterThanOrEqual(0);
  }

  expect(
    records.filter((record) => record.event === "provider.result"),
  ).toEqual([
    expect.objectContaining({
      subtype: "success",
      is_error: false,
      api_duration_ms: 123,
      input_tokens: 100,
      output_tokens: 40,
      cache_read_tokens: 30,
      cache_creation_tokens: 20,
      cost_usd: 0.2,
      turn_count: 2,
    }),
  ]);

  expect(text).not.toContain("private-");
});
