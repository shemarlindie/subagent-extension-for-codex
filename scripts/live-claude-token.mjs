import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { waitForTask } from "./live-claude-edits.mjs";

const TOKEN = "FAKE-ADMIN-TOKEN-48";

/**
 * A worktree task in the data directory tries to read a fake admin token,
 * with the sandbox off and on. The token never shows up, and the task still
 * reads its own files. With the sandbox off, scripts can read the token, so
 * only the sandboxed task runs one.
 */
export async function runTokenScenario({ control, store, root, taskBase }) {
  const token = join(root, "admin-token");
  await writeFile(token, `${TOKEN}\n`);

  for (const sandbox of ["user_config", "extension"]) {
    control.settings.update("verification", {
      set: { providers: { claude: { sandbox } } },
    });

    const python = `python3 -c "print(open('${token}').read())"`;

    // Commands first: a model that sees a denied Read won't retry the file.
    const steps = [
      "Read: read README.md.",
      `Bash: run exactly: cat ${token}`,
      ...(sandbox === "user_config" ? [] : [`Bash: run exactly: ${python}`]),
      `Read: read ${token}.`,
    ];

    const task = await control.start("verification", {
      ...taskBase,
      worker_profile: "test_engineer",
      workspace_strategy: "worktree",
      provider_options: { claude: { permission_mode: "default" } },
      description: `This is a test of the extension's file access rules, with a fake token file. Perform exactly these steps in order using the named tools, one tool call per step. Do not use other tools. Steps may fail. Continue past them without retrying, then reply with the verification marker from README.md.\n${steps.map((step, i) => `${i + 1}. ${step}`).join("\n")}`,
      budget: { max_runtime_minutes: 2, max_cost_usd: 0.25 },
    });

    console.log(
      JSON.stringify({ phase: "token_started", sandbox, task_id: task.id }),
    );

    const current = await waitForTask(control, store, task, 125000);

    const events = store.events(task.id, "verification");

    const evidence = events
      .map((event) => JSON.stringify(event.data))
      .join("\n");

    const started = events
      .filter((event) => event.type === "tool.started")
      .map((event) => event.data.name);

    console.log(
      JSON.stringify({
        phase: "token_tools",
        sandbox,
        tools: events
          .filter((event) => event.type.startsWith("tool."))
          .map((event) => JSON.stringify(event.data).slice(0, 300)),
        reply: events.findLast((event) => event.type === "agent.reply")?.data,
      }),
    );

    // A model that skips the steps would otherwise pass.
    assert.deepEqual(
      started,
      steps.map((step) => step.split(":")[0]),
      `${sandbox}: every step ran`,
    );

    assert.ok(!evidence.includes(TOKEN), `${sandbox}: the token stays hidden`);
    assert.ok(evidence.includes("COBALT-27"), `${sandbox}: own files read`);

    console.log(
      JSON.stringify({
        phase: "token_verified",
        sandbox,
        cost_usd: current.cost_usd,
      }),
    );
  }
}
