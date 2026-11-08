import { expect, test, vi } from "vitest";

import { readyClaudeCli } from "../../../../../../tests/support/claude-cli.js";
import { context } from "./claude-test-harness.js";
import { ClaudeAgentProvider } from "./provider.js";

test("session references refresh as the session ID changes", async () => {
  const { c, sessions } = await context();

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
              delta: { type: "text_delta", text: "Text" },
            },
          };
        }

        yield {
          type: "result",
          session_id: "session-b",
          subtype: "success",
          is_error: false,
          result: "Reply",
          usage: {},
        };
      })(),
      { close() {} },
    )) as unknown as ConstructorParameters<typeof ClaudeAgentProvider>[0];

  const provider = new ClaudeAgentProvider(launch, readyClaudeCli);

  const sessionPath = vi
    .spyOn(provider, "sessionPath")
    .mockImplementation(async (id) => `session-path/${id}`)
    .mockResolvedValueOnce(undefined);

  expect(await provider.run(c, "Prompt")).toEqual({
    reply: "Reply",
  });

  // Looks up each ID until its transcript is found, then stops.
  expect(sessionPath.mock.calls).toEqual([
    ["session-a"],
    ["session-a"],
    ["session-b"],
  ]);

  expect(sessions).toEqual([
    { id: "session-a", ref: undefined },
    { id: "session-a", ref: "session-path/session-a" },
    { id: "session-b", ref: "session-path/session-b" },
  ]);
});
