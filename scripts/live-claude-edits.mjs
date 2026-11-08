import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { query } from "@anthropic-ai/claude-agent-sdk";

import { ClaudeAgentProvider } from "../src/service/features/providers/claude/runtime/provider.ts";
import { callTool } from "../src/service/platform/server/tools.ts";

const editTools = new Set(["Write", "Edit", "NotebookEdit", "Bash"]);
const largeLine = `line 3 ${"x".repeat(40)}`;

/** Observe the real hook alongside the provider's recording hook. */
export function observedEditsProvider(cli) {
  const observed = { hooks: [], options: [] };

  const provider = new ClaudeAgentProvider(
    (input) => {
      observed.options.push({
        permissionMode: input.options.permissionMode,
        settings: input.options.settings,
      });

      const options = {
        ...input.options,
        hooks: {
          ...input.options.hooks,
          PostToolUse: [
            ...(input.options.hooks?.PostToolUse ?? []),
            {
              hooks: [
                async (hook) => {
                  observed.hooks.push(structuredClone(hook));

                  return {};
                },
              ],
            },
          ],
        },
      };

      return query({ ...input, options });
    },
    cli,
    true,
  );

  return { provider, observed };
}

/** Committed inputs, copied into each scenario's isolated worktree. */
export async function prepareEditsFixture(repo) {
  const notebook = {
    cells: [
      {
        cell_type: "code",
        id: "c1",
        metadata: {},
        source: ["print(1)\n"],
        outputs: [],
        execution_count: null,
      },
    ],
    metadata: {
      kernelspec: {
        name: "python3",
        display_name: "Python 3",
        language: "python",
      },
      language_info: { name: "python" },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };

  await Promise.all([
    writeFile(join(repo, "write-update.txt"), "one\ntwo\nthree\n"),
    writeFile(join(repo, "command.txt"), "alpha\nbeta\n"),
    writeFile(join(repo, "command-delete.txt"), "gone\n"),
    writeFile(join(repo, "git-only.txt"), "git base\n"),
    writeFile(join(repo, "nb.ipynb"), JSON.stringify(notebook, null, 1)),
    writeFile(
      join(repo, "large.txt"),
      Array.from(
        { length: 60000 },
        (_, i) => `line ${i} ${"x".repeat(40)}`,
      ).join("\n") + "\n",
    ),
  ]);
}

export async function waitForTask(control, store, task, timeoutMs = 185000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const current = store.get(task.id, "verification");

    if (current.pending_input) {
      const request = current.pending_input;

      // A command retried outside the sandbox stays denied.
      const allowed =
        [
          "Read",
          "Write",
          "Edit",
          "NotebookEdit",
          "Bash",
          "Agent",
          "Task",
        ].includes(request.tool) && !request.input.dangerouslyDisableSandbox;

      control.input(
        "verification",
        task.id,
        request.id,
        allowed,
        undefined,
        allowed ? undefined : "Only the named fixture tools are approved",
      );
    }

    if (
      !control.active.has(task.id) &&
      ["completed", "failed", "interrupted"].includes(current.status)
    ) {
      assert.equal(current.status, "completed", current.error);

      return current;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Edit verification timed out for ${task.id}`);
}

async function recordedChanges(control, id, scope = "task") {
  const args = { task_id: id, scope };

  const first = await callTool(control, "verification", "get_changes", args);

  let diff = first.diff;
  let cursor = first.next_cursor;

  while (cursor) {
    const page = await callTool(control, "verification", "get_changes", {
      ...args,
      cursor,
    });

    assert.deepEqual(page.files, first.files);
    diff += page.diff;
    cursor = page.next_cursor;
  }

  return { ...first, diff };
}

function requireFile(
  changes,
  name,
  status,
  source = "tool",
  incomplete = false,
) {
  const file = changes.files.find((item) => item.path === name);
  assert.ok(file, `${name} was not recorded`);
  assert.equal(file.status, status, name);
  assert.equal(file.source, source, name);
  assert.equal(file.incomplete, incomplete, name);
}

function assertHookEvidence(hooks, store, id) {
  const editHooks = hooks.filter((hook) => editTools.has(hook.tool_name));
  assert.ok(editHooks.length, "L1: edit hooks fired");
  assert.ok(editHooks.every((hook) => typeof hook.tool_use_id === "string"));

  assert.ok(
    editHooks.some(
      (hook) =>
        hook.agent_id &&
        basename(hook.tool_response.filePath ?? "") === "subagent.txt",
    ),
    "L1: subagent Write hook includes agent_id",
  );

  const byId = new Map(editHooks.map((hook) => [hook.tool_use_id, hook]));
  let mainMatches = 0;
  let subagentWithoutResponse = 0;

  for (const event of store.events(id, "verification")) {
    if (event.type !== "tool.completed") continue;

    const raw = store.originalResponse(
      id,
      "verification",
      event.data.response_ref,
    );

    if (!raw || raw.type !== "user") continue;
    const content = raw.message.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      const hook = byId.get(block.tool_use_id);
      if (!hook) continue;

      if (raw.parent_tool_use_id) {
        assert.equal(
          raw.tool_use_result,
          undefined,
          "L2: subagent stream omits tool response",
        );

        subagentWithoutResponse++;
      } else {
        assert.deepEqual(
          raw.tool_use_result,
          hook.tool_response,
          "L2: main response equals hook",
        );

        mainMatches++;
      }
    }
  }

  assert.ok(mainMatches, "L2: main responses compared");
  assert.ok(subagentWithoutResponse, "L2: subagent response observed");

  const responses = (name) =>
    editHooks
      .filter((hook) => hook.tool_name === name)
      .map((hook) => hook.tool_response);

  assert.ok(
    responses("Write").some(
      (r) =>
        r.type === "create" &&
        r.originalFile === null &&
        r.structuredPatch.length === 0,
    ),
    "L3: Write create shape",
  );

  assert.ok(
    responses("Write").some(
      (r) =>
        r.type === "update" &&
        typeof r.originalFile === "string" &&
        r.structuredPatch.length,
    ),
    "L3: Write update shape",
  );

  assert.ok(
    responses("Edit").some((r) => r.oldString === "" && r.originalFile === ""),
    "L4: Edit creation shape",
  );

  assert.ok(
    responses("Edit").some(
      (r) => r.originalFile.length > 3000000 && r.contentNotInModelContext,
    ),
    "L4: large Edit retains originalFile",
  );

  assert.ok(
    responses("NotebookEdit").some(
      (r) =>
        typeof r.original_file === "string" &&
        typeof r.updated_file === "string",
    ),
    "L5: NotebookEdit retains entire notebook",
  );

  assert.ok(
    responses("Bash").some((r) =>
      r.bashEditDiff?.files?.some((file) => file.created),
    ),
    "L7: command creation flag",
  );

  assert.ok(
    responses("Bash").some((r) =>
      r.bashEditDiff?.files?.some((file) => file.deleted),
    ),
    "L7: command deletion flag",
  );

  assert.ok(
    responses("Bash").some(
      (r) =>
        r.bashEditDiff?.unavailable === true ||
        r.bashEditDiff?.skipped === true,
    ),
    "L9: git command diff skipped or unavailable",
  );

  const untrackedEdit = responses("Edit").find(
    (response) => basename(response.filePath) === "created.txt",
  );

  assert.ok(untrackedEdit, "L10: an untracked file was edited");

  if (untrackedEdit.gitDiff) {
    assert.equal(
      untrackedEdit.gitDiff.status,
      "added",
      "L10: gitDiff is Git-relative",
    );
  }

  assert.ok(
    !editHooks.some((hook) => hook.tool_response.staged),
    "L11: fixture edits were applied immediately",
  );

  return { git_diff_observed: !!untrackedEdit.gitDiff };
}

/** Run through the real control plane and public change-tool dispatcher. */
export async function runEditsScenario({
  control,
  store,
  repo,
  root,
  taskBase,
  observed,
}) {
  const start = (description, mode = "default", budget = 1.5) =>
    control.start("verification", {
      ...taskBase,
      worker_profile: "implementer",
      workspace_strategy: "worktree",
      provider_options: { claude: { permission_mode: mode } },
      description,
      budget: { max_runtime_minutes: 3, max_cost_usd: budget },
    });

  try {
    const task =
      await start(`Perform exactly these fixture steps in order using the named tools. Do not use any other tools or inspect unrelated files.
1. Write: create created.txt with content "hello". Then Edit: replace "hello" with "hello world" in it.
2. Read write-update.txt, then Write: overwrite it with "one\\n2\\nthree\\n".
3. Edit with empty old_string: create edit-created.txt containing "created by edit".
4. Read the first five lines of large.txt, then Edit: replace "${largeLine}" with "LINE 3".
5. Read nb.ipynb, then NotebookEdit: replace cell c1 source with "print(2)".
6. Bash: run exactly: printf 'alpha\\nBETA\\n' > command.txt && printf 'made\\n' > command-created.txt && rm command-delete.txt && printf '\\000\\001' > binary.bin && printf 'git updated\\n' > git-only.txt
7. Agent with run_in_background false: ask a general-purpose subagent to create subagent.txt containing "sub" using Write, and wait for completion.
8. Bash: run exactly: git restore git-only.txt
Then reply DONE.`);

    console.log(
      JSON.stringify({ phase: "edits_started", root, task_id: task.id }),
    );

    const ended = await waitForTask(control, store, task);
    const changes = await recordedChanges(control, task.id);

    assert.deepEqual(await recordedChanges(control, task.id, "turn"), {
      ...changes,
      scope: "turn",
    });

    for (const [file, status, source, incomplete] of [
      ["created.txt", "added"],
      ["write-update.txt", "modified"],
      ["edit-created.txt", "added"],
      ["large.txt", "modified"],
      ["nb.ipynb", "modified"],
      ["subagent.txt", "added"],
      ["command.txt", "modified", "command"],
      ["command-created.txt", "added", "command"],
      ["command-delete.txt", "deleted", "command"],
      ["git-only.txt", "modified", "command"],
      ["binary.bin", "modified", "command", true],
    ]) {
      requireFile(changes, file, status, source, incomplete);
    }

    assert.ok(
      changes.unrecorded_commands,
      "L9: git command adds unknown-files marker",
    );

    assert.match(changes.diff, /hello world/);
    assert.match(changes.diff, /LINE 3/);
    assert.match(changes.diff, /print\(2\)/);
    const hookEvidence = assertHookEvidence(observed.hooks, store, task.id);

    console.log(
      JSON.stringify({
        phase: "edits_primary_verified",
        task_id: task.id,
        ...hookEvidence,
      }),
    );

    // The other native modes must also expose Bash hunks under flag settings.
    for (const mode of ["auto", "bypassPermissions"]) {
      const next = await start(
        "Use exactly one Bash command: printf 'mode proof\\n' > mode.txt. Then reply DONE. Do not use other tools.",
        mode,
        0.25,
      );

      await waitForTask(control, store, next);

      requireFile(
        await recordedChanges(control, next.id),
        "mode.txt",
        "added",
        "command",
      );

      console.log(
        JSON.stringify({
          phase: "edits_mode_verified",
          task_id: next.id,
          mode,
        }),
      );
    }

    for (const mode of ["default", "auto", "bypassPermissions"]) {
      assert.ok(
        observed.options.some(
          (option) =>
            option.permissionMode === mode &&
            option.settings?.bashEditDiffEnabled === true,
        ),
        `L6: Bash flag setting for ${mode}`,
      );
    }

    const background = await start(
      "Use Agent exactly once with run_in_background true. Tell the subagent to use Bash to sleep 5 seconds, then Write after-turn.txt containing late. As soon as Agent returns, reply DONE immediately without waiting, using no other tools.",
      "bypassPermissions",
      0.5,
    );

    const backgroundEnded = await waitForTask(control, store, background);

    assert.ok(
      store
        .events(background.id, "verification")
        .some(
          (event) =>
            event.type === "tool.started" &&
            ["Agent", "Task"].includes(event.data.name) &&
            event.data.input.run_in_background === true,
        ),
      "L12: a background subagent was started",
    );

    const hooksAtEnd = observed.hooks.length;
    await new Promise((resolve) => setTimeout(resolve, 6000));

    assert.equal(
      observed.hooks.length,
      hooksAtEnd,
      "L12: no hooks after query close",
    );

    await assert.rejects(
      access(join(backgroundEnded.workspace, "after-turn.txt")),
      { code: "ENOENT" },
    );

    assert.equal(
      (await recordedChanges(control, background.id)).files.length,
      0,
    );

    assert.equal(
      (await readFile(join(repo, "README.md"), "utf8")).includes("COBALT-27"),
      true,
    );

    console.log(
      JSON.stringify({
        phase: "verified",
        task_id: task.id,
        root,
        recorded_paths: changes.files.map((file) => file.path),
        modes: ["default", "auto", "bypassPermissions"],
        background_stopped: true,
        ...hookEvidence,
        cost_usd: ended.cost_usd,
        evidence: join(root, "edit-hooks.json"),
        limits: [
          "No-setting Bash behavior and query-left-open behavior remain covered by the original probes",
          "Staged response behavior uses synthetic mapping tests",
          ...(!hookEvidence.git_diff_observed
            ? [
                "The CLI omitted optional gitDiff status; synthetic mapper tests verify that it is ignored",
              ]
            : []),
        ],
      }),
    );
  } finally {
    try {
      await control.close();
    } finally {
      // Preserve responses from failed runs too. Review and sanitize local
      // paths before promoting any raw capture to committed fixtures.
      const fixtureHooks = observed.hooks.filter((hook) =>
        editTools.has(hook.tool_name),
      );

      await writeFile(
        join(root, "edit-hooks.json"),
        JSON.stringify(fixtureHooks, null, 2),
      );
    }
  }
}

/**
 * Folders without Git or commits, through the real control plane: tool and
 * command edits in Claude Code's sandbox, a blocked write outside the folder
 * and a resumed session. Locks in the Claude Code behavior the design relies on.
 */
export async function runFoldersScenario({ control, store, root, taskBase }) {
  control.settings.update("verification", {
    set: { providers: { claude: { sandbox: true } } },
  });

  // Claude Code's sandbox lets commands write to the temporary directory,
  // which holds this run's folders, so the outside file is in home.
  const outside = join(homedir(), `.subagent-folders-probe-${randomUUID()}`);
  await writeFile(outside, "OUTSIDE\n");

  try {
    for (const name of ["plain", "no-commits"]) {
      const folder = join(root, name);
      await mkdir(folder);
      if (name === "no-commits") execFileSync("git", ["init", "-q", folder]);
      control.workspaces.allowedRoots.push(folder);
      control.workspaces.exactRoots.push(folder);

      const task = await control.start("verification", {
        ...taskBase,
        repository: folder,
        worker_profile: "implementer",
        workspace_strategy: "current_repo",
        provider_options: { claude: { permission_mode: "default" } },
        description: `Perform exactly these steps in order using the named tools, one tool call per step. Do not use other tools.
1. Write: create note.txt containing alpha.
2. Bash: run exactly: printf 'beta\\n' > bash.txt
3. Bash: run exactly: printf 'changed\\n' > ${outside}
4. Bash: run exactly: printf 'gitdir: evil\\n' > .git
5. Bash: run exactly: mkdir -p evil/hooks
6. Bash: run exactly: mkdir -p .git/hooks
Steps 3, 4 and 6 may fail. Continue past them without retrying. Then remember the code word red-fox and reply DONE.`,
        budget: { max_runtime_minutes: 3, max_cost_usd: 0.5 },
      });

      console.log(
        JSON.stringify({ phase: "folders_started", name, task_id: task.id }),
      );

      const first = await waitForTask(control, store, task);

      assert.equal(!!first.no_git, name === "plain", `${name}: no_git`);
      assert.equal(first.base_commit, undefined, `${name}: base_commit`);
      assert.equal(await readFile(join(folder, "bash.txt"), "utf8"), "beta\n");

      // Denying a path that doesn't exist must block it and leave nothing behind.
      if (name === "plain") {
        await assert.rejects(
          access(join(folder, ".git")),
          "plain: .git blocked",
        );
      }

      assert.equal(
        await readFile(outside, "utf8"),
        "OUTSIDE\n",
        `${name}: the sandbox blocks a write outside the folder`,
      );

      const changes = await recordedChanges(control, task.id);
      requireFile(changes, "note.txt", "added");

      if (name === "plain") {
        assert.ok(changes.unrecorded_commands, "plain: command notice");
        assert.ok(!changes.files.some((file) => file.path === "bash.txt"));
      } else {
        requireFile(changes, "bash.txt", "added", "command");
      }

      await control.send(
        "verification",
        task.id,
        "Bash: run exactly: printf 'gamma\\n' > resume.txt\nThen reply with the code word I asked you to remember.",
        "user",
      );

      while (store.get(task.id, "verification").turn < 2) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const second = await waitForTask(control, store, task);

      assert.equal(second.session_id, first.session_id, `${name}: resumed`);

      assert.equal(
        await readFile(join(folder, "resume.txt"), "utf8"),
        "gamma\n",
      );

      assert.match(
        String(store.latestEvent(task.id, "agent.reply")?.data.text ?? ""),
        /red-fox/i,
        `${name}: the resumed session kept its context`,
      );

      console.log(
        JSON.stringify({
          phase: "folders_verified",
          name,
          task_id: task.id,
          cost_usd: second.cost_usd,
        }),
      );
    }
  } finally {
    await rm(outside, { force: true });
    await control.close();
  }
}
