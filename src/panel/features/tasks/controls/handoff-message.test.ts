import { describe, expect, test } from "vitest";

import type { Task } from "../types";
import { handoffMessage } from "./handoff-message";

const task = {
  id: "task-one",
  title: "Review authentication",
  provider: "claude",
  status: "completed",
  repository: "/repo/auth",
  revision: "feature/auth",
  branch: "agent/task-one",
  description: "Review authentication handlers.",
  reply: { text: "Latest reply." },
} as Task;

describe("handoffMessage", () => {
  test("a selected reply includes its exact identity and text instead of the latest reply", () => {
    const message = handoffMessage(
      task,
      { kind: "reply", id: 'older-"reply' },
      "Earlier response about session cookies.",
    );

    expect(message).toContain('Reply ID: "older-\\"reply"');

    expect(message).toContain(
      "Selected reply excerpt: Earlier response about session cookies.",
    );

    expect(message).not.toContain("Latest reply.");
    expect(message).toContain('task_id="task-one"');
    expect(message).toContain("list_messages");
    expect(message).toContain("following next_cursor");
    expect(message).toContain("Repository: /repo/auth");
    expect(message).toContain("Branch: agent/task-one");
  });

  test("a selected file includes its path, preview evidence and precise retrieval instructions", () => {
    const message = handoffMessage(
      task,
      { kind: "file", path: "src/session.ts" },
      "- old cookie handling\n+ secure cookie handling",
    );

    expect(message).toContain('File path: "src/session.ts"');
    expect(message).toContain('path="src/session.ts"');
    expect(message).toContain("get_changes");
    expect(message).toContain("get_changed_file");

    expect(message).toContain(
      "pass next_cursor back as cursor until all contents are read",
    );

    expect(message).toContain("+ secure cookie handling");
    expect(message).not.toContain("Latest reply.");
  });

  test("missing selected context directs retrieval without substituting the latest reply", () => {
    const message = handoffMessage(task, { kind: "reply", id: "old-reply" });

    expect(message).toContain(
      "Retrieve the selected context with the tools above.",
    );

    expect(message).not.toContain("Latest reply.");
  });

  test("bounded selected context retains target identity and flags the excerpt", () => {
    const message = handoffMessage(
      task,
      { kind: "file", path: "huge.ts" },
      "x".repeat(6000),
    );

    expect(message).toContain('File path: "huge.ts"');
    expect(message).toContain("x".repeat(5000) + "… (truncated)");
    expect(message).not.toContain("x".repeat(5001));
    expect(message).toContain("get_changed_file");
  });

  test("whole-task handoff retains the latest reply and task description", () => {
    const message = handoffMessage(task);

    expect(message).toContain(
      "Description excerpt: Review authentication handlers.",
    );

    expect(message).toContain("Latest reply excerpt: Latest reply.");
    expect(message).toContain("send_message");
  });
});
