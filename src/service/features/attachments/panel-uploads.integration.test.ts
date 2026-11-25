import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { test } from "vitest";

import { callTool } from "../../platform/server/tools.js";
import {
  input,
  PromptRecorder,
  setup,
  until,
} from "../tasks/runtime/control-test-harness.js";

// A complete 1x1 PNG, including its image data and end marker.
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==";

const upload = (name: string, data: string) => ({
  source: "upload",
  name,
  summary: `User attached ${name}.`,
  data,
});

test("only panel tools can supply local file bytes for worker snapshots", async () => {
  const recorder = new PromptRecorder();
  const { c, store, repo } = await setup(recorder);
  await writeFile(join(repo, "notes.txt"), "Different project content");
  const text = "Notes from outside the project.\n";

  const start = {
    ...input(repo),
    attachments: [upload("notes.txt", Buffer.from(text).toString("base64"))],
  };

  await assert.rejects(callTool(c, "alice", "start_task", start), /source/);

  const { id } = (await callTool(
    c,
    "alice",
    "app_start_task",
    start,
    "user",
  )) as { id: string };

  await until(() => store.get(id, "alice").status === "completed");

  const [note] = c.attachments.list(id, "request");
  assert.ok(note);
  const folder = c.attachments.folder(id);
  assert.equal(await readFile(join(folder, note.file), "utf8"), text);

  const pdf = Buffer.from("%PDF-1.4\n%%EOF\n").toString("base64");

  const followUp = {
    message: "Open the screenshot and the spec",
    task_id: id,
    attachments: [upload("screen.png", png), upload("Spec.PDF", pdf)],
  };

  await assert.rejects(
    callTool(c, "alice", "send_message", followUp),
    /source/,
  );

  const { message_id } = (await callTool(
    c,
    "alice",
    "app_send_message",
    followUp,
    "user",
  )) as { message_id: string };

  const [image, document] = c.attachments.list(id, message_id);
  assert.ok(image && document);
  await until(() => recorder.prompts.length === 2);
  assert.match(image.file, /\.png$/);
  assert.match(document.file, /\.pdf$/);
  assert.ok(recorder.prompts[1]?.includes(join(folder, image.file)));
  assert.ok(recorder.prompts[1]?.includes("document, 15 bytes"));

  assert.deepEqual(
    await readFile(join(folder, image.file)),
    Buffer.from(png, "base64"),
  );
});

test("a rejected upload batch leaves no follow-up or partial snapshot", async () => {
  const { c, repo, store } = await setup();
  const { id } = await c.start("alice", input(repo));
  await until(() => store.get(id, "alice").status === "completed");
  const count = store.messages.count(id);
  const valid = upload("notes.txt", "YWJj");

  await assert.rejects(
    callTool(
      c,
      "alice",
      "app_send_message",
      {
        task_id: id,
        message: "Review",
        attachments: [valid, upload("look.png", "YWJj")],
      },
      "user",
    ),
    /image/i,
  );

  assert.equal(store.messages.count(id), count);
  assert.deepEqual(c.attachments.list(id), []);
  assert.deepEqual(await readdir(c.attachments.folder(id)), []);
});
