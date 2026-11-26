import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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
  assert.ok(recorder.prompts[1]?.includes("application/pdf, 15 bytes"));

  assert.deepEqual(
    await readFile(join(folder, image.file)),
    Buffer.from(png, "base64"),
  );
});

test("a send reuses a staged file, and the host opens stored files by path", async () => {
  const { c, repo, store } = await setup();
  const { id } = await c.start("alice", input(repo));
  await until(() => store.get(id, "alice").status === "completed");
  const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");

  const staged = (await callTool(
    c,
    "alice",
    "app_stage_file",
    { name: "Spec.pdf", data: pdf.toString("base64") },
    "user",
  )) as { id: string; path: string };

  assert.match(staged.path, /\/Spec\.pdf$/);
  assert.deepEqual(await readFile(staged.path), pdf);

  const send = () =>
    callTool(
      c,
      "alice",
      "app_send_message",
      {
        task_id: id,
        message: "Review the spec",
        attachments: [
          {
            source: "upload",
            name: "Spec.pdf",
            summary: "User attached Spec.pdf.",
            staged: staged.id,
          },
        ],
      },
      "user",
    ) as Promise<{ message_id: string }>;

  const { message_id } = await send();
  const [document] = c.attachments.list(id, message_id);
  assert.ok(document);
  const stored = join(c.attachments.folder(id), document.file);
  assert.deepEqual(await readFile(stored), pdf);

  const located = { task_id: id, message_id, position: 1 };

  assert.deepEqual(
    await callTool(c, "alice", "app_get_attachment_path", located, "user"),
    { path: stored },
  );

  await assert.rejects(
    callTool(c, "bob", "app_get_attachment_path", located, "user"),
  );

  // An edited or expired copy can't stand in for what the user attached.
  await writeFile(staged.path, "edited");
  await assert.rejects(send(), /expired or changed/);
  await c.attachments.staged.sweep(Date.now() + 2 * 24 * 60 * 60 * 1000);
  assert.equal(existsSync(staged.path), false);
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
        attachments: [valid, upload("bad.bin", "YWJ=")],
      },
      "user",
    ),
    /Invalid base64/,
  );

  assert.equal(store.messages.count(id), count);
  assert.deepEqual(c.attachments.list(id), []);
  assert.deepEqual(await readdir(c.attachments.folder(id)), []);
});
