import assert from "node:assert/strict";

import { test } from "vitest";

import type { ChatItem } from "../../../../src/features/tasks/chat.js";
import { mergeChat } from "./chat-state";

const note = (id: string, event_id: number, text = id): ChatItem => ({
  kind: "note",
  id,
  event_id,
  timestamp: "",
  note: "compaction",
  text,
});

test("a later read replaces items it repeats in place and adds the rest", () => {
  const first = mergeChat(undefined, "task", {
    items: [note("a", 1), note("b", 2)],
    next_cursor: 2,
  });

  const next = mergeChat(first, "task", {
    items: [note("a", 3, "updated"), note("c", 4)],
    next_cursor: 4,
  });

  assert.deepEqual(
    next.items.map((item) => [item.id, item.kind === "note" && item.text]),
    [
      ["a", "updated"],
      ["b", "b"],
      ["c", "c"],
    ],
  );

  assert.equal(next.cursor, 4);

  // Another task's Chat starts over.
  assert.deepEqual(
    mergeChat(next, "other", { items: [], next_cursor: 0 }).items,
    [],
  );
});
