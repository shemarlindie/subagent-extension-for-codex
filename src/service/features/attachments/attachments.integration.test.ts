import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { test } from "vitest";

import type { AttachmentPage } from "../../../shared/attachments/model.js";
import { callTool } from "../../platform/server/tools.js";
import { Projects } from "../projects/projects.js";
import { SessionPrompts } from "../tasks/conversation/session-prompts.js";
import {
  input,
  PromptRecorder,
  setup,
  until,
} from "../tasks/runtime/control-test-harness.js";
import { uncommittedDiff } from "./diff.js";

const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });

const commit = (repo: string) =>
  git(
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-qam",
    "change",
  );

/** The task folders under the attachments root. */
async function taskFolders(root: string) {
  try {
    return (await readdir(root)).filter((name) => name.startsWith("task_"));
  } catch {
    return [];
  }
}

test("each attachment kind is snapshotted with its generated title, and invalid ones save nothing", async () => {
  const { c, store, repo, dir } = await setup();
  const root = join(dir, "attachments");
  await writeFile(join(repo, "notes.md"), "one\ntwo\nthree\n");
  await writeFile(join(repo, "README.md"), "changed\n");

  const t = await c.start("alice", {
    ...input(repo),
    attachments: [
      { summary: "A decision.", format: "markdown", text: "Use X." },
      { summary: "A label.", format: "code", text: "x", path: "src/a.ts" },
      { source: "diff", summary: "The changes." },
      { source: "file", path: "notes.md", summary: "Notes." },
      { source: "file", path: "notes.md", start_line: 2, summary: "Tail." },
      { source: "file", path: "notes.md", summary: "Mine.", title: "Custom" },
      { summary: "A label.", format: "text", text: "x", path: "example.png" },
    ],
  });

  const attachments = c.attachments.list(t.id);

  assert.deepEqual(
    attachments.map((a) => [a.title, a.source, a.format]),
    [
      ["Note", "inline", "markdown"],
      ["a.ts", "inline", "code"],
      ["Uncommitted changes", "diff", "diff"],
      ["notes.md", "file", "markdown"],
      ["notes.md:2-3", "file", "markdown"],
      ["Custom", "file", "markdown"],
      ["example.png", "inline", "text"],
    ],
  );

  // Stored files keep a text extension whatever an inline label says.
  assert.deepEqual(
    attachments.map((a) => a.file.slice(a.file.lastIndexOf("."))),
    [".md", ".ts", ".diff", ".md", ".md", ".md", ".txt"],
  );

  assert.deepEqual([attachments[2]!.files, attachments[2]!.additions], [2, 4]);

  const tail = join(c.attachments.folder(t.id), attachments[4]!.file);
  assert.equal(await readFile(tail, "utf8"), "two\nthree\n");
  assert.equal(attachments[4]!.lines, 2);

  // Rejected starts leave no task and no folder.
  await writeFile(join(repo, "big.txt"), "x".repeat(2 * 1024 * 1024 + 1));
  await writeFile(join(repo, "image.bin"), Buffer.from([1, 0, 2]));
  await writeFile(join(dir, "outside.txt"), "outside");
  await symlink(join(dir, "outside.txt"), join(repo, "escape.txt"));
  const note = { summary: "Note.", format: "text", text: "x" };

  const rejected: [object, RegExp][] = [
    [{ attachments: ["text"] }, /Invalid input/],
    [{ context: ["excerpt"] }, /replaced by attachments/],
    [{ attachments: [{ format: "text", text: "x" }] }, /summary/],
    [{ attachments: [{ ...note, summary: "s".repeat(201) }] }, /one sentence/],
    [{ attachments: [{ ...note, title: "t".repeat(61) }] }, /title/],
    [{ attachments: [{ ...note, text: "x".repeat(8001) }] }, /by reference/],
    [
      { attachments: [{ source: "file", path: "big.txt", summary: "S." }] },
      /attachment limit.*line range/,
    ],
    [
      { attachments: [{ source: "file", path: "image.bin", summary: "S." }] },
      /binary/,
    ],
    [
      {
        attachments: [
          { source: "file", path: "../outside.txt", summary: "S." },
        ],
      },
      /outside the project/,
    ],
    [
      {
        attachments: [{ source: "file", path: "escape.txt", summary: "S." }],
      },
      /outside the project/,
    ],
  ];

  for (const [extra, error] of rejected) {
    await assert.rejects(c.start("alice", { ...input(repo), ...extra }), error);
    assert.equal(store.all().length, 1);
    assert.deepEqual(await taskFolders(root), [t.id]);
  }
});

test("a diff snapshot holds untracked files and unusual names, runs no filters and stays fixed", async () => {
  const { c, repo, dir } = await setup();
  const marker = join(dir, "filter-ran");
  await writeFile(join(repo, "with\ttab.txt"), "old\n");
  git(repo, "add", ".");
  commit(repo);
  await writeFile(join(repo, "with\ttab.txt"), "new\n");
  await writeFile(join(repo, "with\nnewline.txt"), "fresh\n");
  await writeFile(join(repo, ".gitattributes"), "*.txt filter=probe\n");
  git(repo, "config", "filter.probe.clean", `touch '${marker}'; cat`);

  const t = await c.start("alice", {
    ...input(repo),
    attachments: [{ source: "diff", summary: "The changes." }],
  });

  const [diff] = c.attachments.list(t.id);
  assert.equal(diff!.files, 3);

  assert.deepEqual(
    (await uncommittedDiff(repo, ["with\ttab.txt"], 1024)).files,
    ["with\ttab.txt"],
  );

  const snapshot = join(c.attachments.folder(t.id), diff!.file);
  const text = await readFile(snapshot, "utf8");
  assert.match(text, /"b\/with\\nnewline.txt"/);

  await assert.rejects(access(marker));
  // Git applies the patch as its own, with the filter out of the way.
  git(repo, "config", "--unset", "filter.probe.clean");
  git(repo, "apply", "--check", "-R", snapshot);

  await writeFile(join(repo, "README.md"), "later\n");
  assert.equal(await readFile(snapshot, "utf8"), text);

  const empty = join(dir, "empty");
  await mkdir(empty);
  git(empty, "init", "-q");

  await assert.rejects(
    uncommittedDiff(empty, undefined, 1024),
    /at least one commit/,
  );
});

test("attachments stay out of the task body, go with the task, and legacy context still loads and prompts", async () => {
  const recorder = new PromptRecorder();
  const { c, store, repo } = await setup(recorder);

  const t = await c.start("alice", {
    ...input(repo),
    attachments: [{ summary: "A decision.", format: "text", text: "Use X." }],
  });

  await until(() => store.get(t.id, "alice").status === "completed");

  const body = (id: string) =>
    String(
      store.database.client
        .prepare("SELECT body FROM tasks WHERE id = ?")
        .get(id)?.body,
    );

  assert.doesNotMatch(body(t.id), /"attachments"|"context"/);
  const folder = c.attachments.folder(t.id);
  const [file] = await readdir(folder);

  assert.equal(
    recorder.prompts[0],
    `Investigate\n\nAttachments, read them as needed:\n- Note (1 line): A decision.\n  ${join(folder, file!)}`,
  );

  await c.delete("alice", t.id);
  assert.deepEqual(await taskFolders(dirname(folder)), []);

  assert.equal(
    store.database.client
      .prepare("SELECT count(*) AS rows FROM task_attachments")
      .get()?.rows,
    0,
  );

  // A task stored before attachments keeps its context and exact prompt.
  const legacy = await c.start("alice", input(repo));
  await until(() => store.get(legacy.id, "alice").status === "completed");

  store.save({
    ...store.get(legacy.id, "alice"),
    context: ["first excerpt", "second excerpt"],
  });

  const stored = store.get(legacy.id, "alice");
  assert.deepEqual(stored.context, ["first excerpt", "second excerpt"]);

  assert.equal(
    new SessionPrompts(store, c.attachments).sessionPrompt(stored),
    "Investigate\n\nfirst excerpt\n\nsecond excerpt",
  );
});

test("failed starts and overlapping project removal leave no folder, and the sweep removes only orphans", async () => {
  const { c, store, repo, dir } = await setup();
  const root = join(dir, "attachments");
  c.workspaces.allowedRoots = [];
  c.projects = new Projects(store.database, c.workspaces);
  // A parent approval stays after the project's removal.
  await c.projects.register(dirname(repo), "parent");
  const { repository } = await c.projects.register(repo);
  const attachments = [{ summary: "Note.", format: "text", text: "x" }];

  store.database.client.exec(
    "CREATE TRIGGER reject_queued BEFORE INSERT ON events WHEN NEW.type='task.queued' BEGIN SELECT RAISE(ABORT, 'event write failed'); END",
  );

  await assert.rejects(
    c.start("alice", { ...input(repo), attachments }),
    /event write failed/,
  );

  assert.deepEqual(store.all(), []);
  assert.deepEqual(await taskFolders(root), []);
  store.database.client.exec("DROP TRIGGER reject_queued");

  // A removal that starts and finishes while the snapshot is written.
  const prepare = c.attachments.prepare.bind(c.attachments);
  let release = () => {};
  let written = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const prepared = new Promise<void>((resolve) => (written = resolve));

  c.attachments.prepare = async (...args) => {
    const rows = await prepare(...args);
    written();
    await held;

    return rows;
  };

  const start = c.start("alice", { ...input(repo), attachments });
  await prepared;
  assert.equal((await taskFolders(root)).length, 1);
  await c.removeProject("alice", repository, true);
  release();
  await assert.rejects(start, /being deleted/);
  assert.deepEqual(store.all(), []);
  assert.deepEqual(await taskFolders(root), []);

  const orphan = `task_${randomUUID()}`;
  await mkdir(join(root, orphan));
  await mkdir(join(root, "keep"));
  await mkdir(join(dir, "elsewhere"));
  await symlink(join(dir, "elsewhere"), join(root, `task_${randomUUID()}`));
  await c.recover();

  assert.deepEqual(
    (await readdir(root)).filter((name) => !name.startsWith("task_")),
    ["keep"],
  );

  assert.ok(!(await readdir(root)).includes(orphan));
  assert.equal((await taskFolders(root)).length, 1);
});

test("attachment pages keep characters whole, stay with one version and report a missing file", async () => {
  const { c, repo } = await setup();
  // Two-byte characters from byte 1, so the page cap splits one.
  const text = `a${"é".repeat(300_000)}\n`;
  await writeFile(join(repo, "long.txt"), text);

  const t = await c.start("alice", {
    ...input(repo),
    attachments: [{ source: "file", path: "long.txt", summary: "Long." }],
  });

  const read = (owner: string, cursor?: string) =>
    callTool(
      c,
      owner,
      "app_get_attachment",
      { task_id: t.id, position: 1, ...(cursor ? { cursor } : {}) },
      "user",
    ) as Promise<AttachmentPage>;

  await assert.rejects(read("bob"), /Task not found/);
  const first = await read("alice");
  assert.equal(first.attachment.title, "long.txt");
  assert.ok(!("file" in first.attachment));
  assert.ok(first.next_cursor);
  const second = await read("alice", first.next_cursor);
  assert.equal(`${first.content}${second.content}`, text);
  assert.equal(second.next_cursor, undefined);

  const [stored] = c.attachments.list(t.id);
  const file = join(c.attachments.folder(t.id), stored!.file);
  await writeFile(file, `b${text.slice(1)}`);
  await assert.rejects(read("alice", first.next_cursor), /changed/);

  await rm(file);
  assert.equal((await read("alice")).state, "unavailable");
});
