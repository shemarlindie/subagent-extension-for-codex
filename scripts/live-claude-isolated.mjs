import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, rm } from "node:fs/promises";
import { join } from "node:path";

/** Exercise each settings switch independently against the parity fixture. */
export async function runIsolatedScenario({
  control,
  store,
  repo,
  root,
  taskBase,
}) {
  try {
    for (const settings of [
      { settings_files: false, user_mcp: true },
      { settings_files: true, user_mcp: false },
    ]) {
      await rm(join(root, "hook-fired"), { force: true });

      control.settings.update("verification", {
        set: { providers: { claude: settings } },
      });

      const task = await control.start("verification", {
        ...taskBase,
        worker_profile: "reviewer",
        conversation_id: "isolated-verification",
        description:
          "Read README.md with the native Read tool. Include the exact README verification marker in your final reply. Do not use other tools or ask questions.",
        budget: { max_runtime_minutes: 1, max_cost_usd: 0.25 },
      });

      console.log(
        JSON.stringify({
          phase: "started",
          root,
          task_id: task.id,
          ...settings,
        }),
      );

      const deadline = Date.now() + 70000;
      let ended;

      while (Date.now() < deadline) {
        const current = store.get(task.id, "verification");

        assert.equal(
          current.pending_input,
          undefined,
          "Fixture tools should need no approval",
        );

        if (["completed", "failed", "interrupted"].includes(current.status)) {
          ended = current;
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      assert.ok(ended, "Native isolated verification timed out");
      assert.equal(ended.status, "completed", ended.error);
      const events = store.events(task.id, "verification");
      const init = events.find((event) => event.type === "agent.started");
      assert.ok(init, "Native startup metadata missing");

      // Deferred tools may be absent from tools even when their server loaded.
      const native = store.originalResponse(
        task.id,
        "verification",
        init.data.response_ref,
      );

      assert.deepEqual(native.mcp_servers, [], "External MCP servers loaded");

      assert.equal(
        native.skills.includes("marker-skill"),
        settings.settings_files,
        "Project skill loading differs from settings policy",
      );

      assert.ok(
        !init.data.tools.some((name) => name.startsWith("mcp__")),
        "External MCP tools loaded",
      );

      await assert.rejects(
        access(join(root, "mcp-started")),
        "Fixture MCP server started",
      );

      const hookFired = await access(join(root, "hook-fired")).then(
        () => true,
        () => false,
      );

      assert.equal(
        hookFired,
        settings.settings_files,
        "Project hook loading differs from settings policy",
      );

      assert.ok(
        events.some(
          (event) =>
            event.type === "tool.started" && event.data.name === "Read",
        ),
      );

      assert.ok(
        String(store.latestEvent(task.id, "agent.reply")?.data.text).includes(
          "COBALT-27",
        ),
      );

      assert.equal(
        execFileSync("git", ["-C", repo, "status", "--porcelain"], {
          encoding: "utf8",
        }),
        "",
      );

      console.log(
        JSON.stringify({
          phase: "verified",
          ...settings,
          project_hook_fired: hookFired,
          external_mcp_absent: true,
          parent_reporting: true,
          read_tool_observed: true,
          primary_clean: true,
          cost_usd: ended.cost_usd,
        }),
      );
    }
  } finally {
    await control.close();
  }
}
