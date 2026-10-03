import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Control } from "../dist/core/control.js";
import { Store } from "../dist/core/store.js";
import { Workspaces } from "../dist/core/workspace.js";
import { ClaudeAgentProvider } from "../dist/providers/claude.js";
if (process.env.CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY !== "1") {
  console.error(
    "Set CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 to opt into authenticated Claude model calls. Each task configures a native cost budget of at most $0.25. A response can exceed the budget before work stops.",
  );
  process.exit(1);
}
const scenario = process.argv[2] ?? "read";
assert.ok(
  ["read", "resume", "sandbox", "mcp", "budget"].includes(scenario),
  "Choose read, resume, sandbox, mcp, or budget",
);
const root = await realpath(
  await mkdtemp(join(tmpdir(), "codex-subagent-extension-native-proof-")),
);
const repo = join(root, "repo");
await mkdir(repo);
execFileSync("git", ["init", "-q", repo]);
await writeFile(
  join(repo, "README.md"),
  "# Native verification\n\nThe verification marker is COBALT-27.\n",
);
execFileSync("git", ["-C", repo, "add", "README.md"]);
execFileSync("git", [
  "-C",
  repo,
  "-c",
  "user.name=Native Verification",
  "-c",
  "user.email=verification@example.invalid",
  "commit",
  "-qm",
  "Verification fixture",
]);
const store = new Store(join(root, "tasks.sqlite"));
const control = new Control(
  store,
  new Workspaces(join(root, "worktrees"), [repo]),
  new Map([["claude", new ClaudeAgentProvider()]]),
  repo,
);

if (scenario === "read") {
  const task = await control.start("verification", {
    provider: "claude",
    worker_profile: "reviewer",
    title: "Read the verification marker",
    description:
      "Read README.md using the native Read tool. Report the exact verification marker in your structured findings and evidence. Do not ask questions, run commands or edit files.",
    budget: { max_runtime_minutes: 1, max_cost_usd: 0.25 },
  });
  console.log(JSON.stringify({ phase: "started", root, task_id: task.id }));
  try {
    const deadline = Date.now() + 70000;
    let previous;
    while (Date.now() < deadline) {
      const current = store.get(task.id, "verification");
      if (current.status !== previous) {
        console.log(JSON.stringify({ phase: "state", status: current.status }));
        previous = current.status;
      }
      if (
        ["completed", "failed", "cancelled", "interrupted"].includes(
          current.status,
        )
      ) {
        assert.equal(current.status, "completed", current.error);
        assert.ok(current.result.findings.join(" ").includes("COBALT-27"));
        assert.ok(current.session_id && current.session_state_ref);
        const evidence = store.events(task.id, "verification");
        assert.ok(
          evidence.some(
            (e) => e.type === "tool.started" && e.data.name === "Read",
          ),
        );
        assert.ok(
          store
            .artifacts(task.id, "verification")
            .some((a) => a.type === "report"),
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
            cost_usd: current.cost_usd,
            session_state_available: !!current.session_state_ref,
            read_tool_observed: true,
            report_persisted: true,
            primary_clean: true,
          }),
        );
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal(
      store.get(task.id, "verification").status,
      "completed",
      "Native verification timed out",
    );
  } finally {
    await control.close();
  }
} else if (scenario === "resume") {
  const task = await control.start("verification", {
    provider: "claude",
    worker_profile: "reviewer",
    title: "Ask before reading README",
    description:
      "Before reading anything, use the native AskUserQuestion tool to ask: May I inspect README now? Offer Proceed and Wait. Wait for the user response before inspecting README. Afterwards report its exact verification marker in structured findings.",
    budget: { max_runtime_minutes: 1, max_cost_usd: 0.25 },
  });
  console.log(JSON.stringify({ phase: "started", root, task_id: task.id }));
  let reopened;
  try {
    const deadline = Date.now() + 65000;
    while (
      Date.now() < deadline &&
      !store.get(task.id, "verification").pending_input
    ) {
      const current = store.get(task.id, "verification");
      assert.ok(
        !["completed", "failed", "cancelled", "interrupted"].includes(
          current.status,
        ),
        current.error ?? "Task ended before asking",
      );
      await new Promise((r) => setTimeout(r, 250));
    }
    const waiting = store.get(task.id, "verification");
    assert.equal(waiting.pending_input?.tool, "AskUserQuestion");
    assert.ok(waiting.session_id && waiting.session_state_ref);
    const session = waiting.session_id;
    await control.stop("verification", task.id, "interrupted");
    assert.equal(store.get(task.id, "verification").status, "interrupted");
    await control.close();
    const nextStore = new Store(join(root, "tasks.sqlite"));
    reopened = new Control(
      nextStore,
      new Workspaces(join(root, "worktrees"), [repo]),
      new Map([["claude", new ClaudeAgentProvider()]]),
      repo,
    );
    await reopened.recover();
    await reopened.continue(
      "verification",
      task.id,
      "Proceed now. Read README.md with the Read tool and report its exact marker in structured findings. Do not ask another question or run commands.",
    );
    console.log(
      JSON.stringify({ phase: "resumed_after_restart", same_task: true }),
    );
    const finalDeadline = Date.now() + 65000;
    while (Date.now() < finalDeadline) {
      const current = nextStore.get(task.id, "verification");
      if (
        ["completed", "failed", "cancelled", "interrupted"].includes(
          current.status,
        )
      ) {
        assert.equal(current.status, "completed", current.error);
        assert.equal(current.session_id, session);
        assert.equal(current.attempt, 2);
        assert.ok(current.result.findings.join(" ").includes("COBALT-27"));
        assert.ok(
          nextStore
            .artifacts(task.id, "verification")
            .some((a) => a.type === "report"),
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
            same_native_session: true,
            attempt: current.attempt,
            cost_reported_usd: current.cost_usd,
            primary_clean: true,
          }),
        );
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal(
      nextStore.get(task.id, "verification").status,
      "completed",
      "Continuation timed out",
    );
  } finally {
    if (reopened) await reopened.close();
    else if (!control.stopped) await control.close();
  }
} else if (scenario === "mcp") {
  const { application } = await import("../dist/server/app.js");
  const { Auth } = await import("../dist/server/auth.js");
  const { randomBytes } = await import("node:crypto");
  const { fileURLToPath } = await import("node:url");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } =
    await import("@modelcontextprotocol/sdk/client/stdio.js");
  const token = randomBytes(32).toString("base64url");
  const app = application(
    control,
    new Auth(token, "verification"),
    "http://127.0.0.1:4317",
    fileURLToPath(new URL("../dist/console.html", import.meta.url)),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const client = new Client({
    name: "native-headless-verification",
    version: "1",
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/stdio.js", import.meta.url))],
    env: {
      CODEX_SUBAGENT_EXTENSION_URL: `http://127.0.0.1:${server.address().port}`,
      CODEX_SUBAGENT_EXTENSION_TOKEN: token,
    },
    stderr: "pipe",
  });
  const call = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    assert.ok(!response.isError, JSON.stringify(response.content));
    return response.structuredContent.result;
  };
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((t) => t.name === "start_agent_task"));
    const workers = await call("list_available_workers");
    assert.ok(workers.some((w) => w.provider === "claude"));
    const task = await call("start_agent_task", {
      provider: "claude",
      worker_profile: "reviewer",
      title: "Read the verification marker",
      description:
        "Read README.md with the native Read tool. Include its exact verification marker in your structured findings. Do not ask questions, edit files or run commands.",
      budget: { max_runtime_minutes: 1, max_cost_usd: 0.25 },
    });
    console.log(
      JSON.stringify({ phase: "mcp_task_created", task_id: task.id, root }),
    );
    const deadline = Date.now() + 65000;
    let completed;
    while (Date.now() < deadline) {
      const current = await call("get_agent_task", { task_id: task.id });
      if (
        ["completed", "failed", "cancelled", "interrupted"].includes(
          current.status,
        )
      ) {
        assert.equal(current.status, "completed", current.error);
        completed = current;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(completed, "Native MCP verification timed out");
    const report = await call("get_agent_result", { task_id: task.id });
    assert.ok(report.result.findings.join(" ").includes("COBALT-27"));
    const artifacts = await call("get_agent_artifacts", { task_id: task.id });
    assert.ok(artifacts.some((a) => a.type === "report"));
    const events = await call("get_agent_events", { task_id: task.id });
    assert.ok(
      events.some((e) => e.type === "tool.started" && e.data.name === "Read"),
    );
    assert.ok(events.some((e) => e.type === "task.completed"));
    assert.equal(
      execFileSync("git", ["-C", repo, "status", "--porcelain"], {
        encoding: "utf8",
      }),
      "",
    );
    console.log(
      JSON.stringify({
        phase: "verified",
        mcp_transport: "stdio",
        authenticated_service: true,
        native_claude: true,
        result_retrieved: true,
        artifacts_retrieved: true,
        events_retrieved: true,
        cost_usd: completed.cost_usd,
        primary_clean: true,
      }),
    );
  } finally {
    await client.close();
    await transport.close();
    await app.locals.closeMcp();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await control.close();
  }
} else if (scenario === "budget") {
  const limit = 0.001;
  const task = await control.start("verification", {
    provider: "claude",
    worker_profile: "reviewer",
    title: "Read the verification marker",
    description:
      "Read README.md using Read and report its exact marker in structured findings. Do not ask questions, edit files or run shell commands.",
    budget: { max_runtime_minutes: 1, max_cost_usd: limit },
  });
  console.log(
    JSON.stringify({
      phase: "budget_task_created",
      task_id: task.id,
      root,
      configured_limit_usd: limit,
    }),
  );
  try {
    const deadline = Date.now() + 65000;
    let ended;
    while (Date.now() < deadline) {
      const current = store.get(task.id, "verification");
      if (
        ["completed", "failed", "cancelled", "interrupted"].includes(
          current.status,
        )
      ) {
        ended = current;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(ended, "Native budget verification timed out");
    assert.equal(ended.status, "failed", ended.error);
    assert.match(ended.error, /error_max_budget_usd/);
    assert.ok(ended.cost_usd >= limit);
    assert.equal(ended.result, undefined);
    assert.ok(
      !store
        .events(task.id, "verification")
        .some((e) => e.type === "task.completed"),
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
        native_budget_failure: true,
        cost_retained: true,
        configured_limit_usd: limit,
        reported_cost_usd: ended.cost_usd,
        no_success_result: true,
        primary_clean: true,
      }),
    );
  } finally {
    await control.close();
  }
} else {
  const { createServer } = await import("node:http");
  const { readFile, symlink, access } = await import("node:fs/promises");
  let hits = 0;
  const listener = createServer((_req, res) => {
    hits++;
    res.end("local fixture");
  });
  await new Promise((r) => listener.listen(0, "127.0.0.1", r));
  const port = listener.address().port;
  const marker = join(repo, ".git", "blocked-native-proof");
  const commands = [
    "printf 'SCOPED-OK\\n' > proof.txt",
    "/usr/bin/touch ../blocked-write.txt",
    `/usr/bin/touch '${marker}'`,
    "/bin/cat escape.txt",
    `/usr/bin/curl --noproxy '*' --connect-timeout 2 --max-time 3 http://127.0.0.1:${port}`,
  ];
  const task = await control.start("verification", {
    provider: "claude",
    worker_profile: "test_engineer",
    title: "Verify scoped command permissions",
    description:
      "Run each of these exact Bash commands once, sequentially. Do not change, combine or retry the commands; do not use other tools. Expected permission failures are evidence, not errors in this verification. Report which commands succeeded or were blocked in your structured tests and evidence. Commands: " +
      JSON.stringify(commands),
    budget: { max_runtime_minutes: 2, max_cost_usd: 0.25 },
  });
  console.log(JSON.stringify({ phase: "started", root, task_id: task.id }));
  let provisioned = false;
  const approved = [];
  try {
    const deadline = Date.now() + 125000;
    while (Date.now() < deadline) {
      const current = store.get(task.id, "verification");
      if (current.workspace && !provisioned) {
        const outside = join(
          current.workspace,
          "..",
          "private-native-marker.txt",
        );
        await writeFile(outside, "SYNTHETIC-PRIVATE-MARKER");
        await symlink(outside, join(current.workspace, "escape.txt"));
        provisioned = true;
      }
      if (current.pending_input) {
        const request = current.pending_input;
        const command = String(request.input.command ?? "").trim();
        const permitted =
          request.tool === "Bash" && command === commands[approved.length];
        if (!permitted) {
          control.input(
            "verification",
            task.id,
            request.id,
            false,
            undefined,
            "Only the next exact fixture verification command is approved",
          );
          console.log(
            JSON.stringify({
              phase: "unexpected_command_denied",
              tool: request.tool,
            }),
          );
        } else {
          approved.push(command);
          control.input("verification", task.id, request.id, true);
          console.log(
            JSON.stringify({
              phase: "fixture_command_approved",
              index: approved.length,
            }),
          );
        }
      }
      if (
        ["completed", "failed", "cancelled", "interrupted"].includes(
          current.status,
        )
      ) {
        assert.equal(current.status, "completed", current.error);
        assert.equal(approved.length, commands.length);
        assert.equal(
          (await readFile(join(current.workspace, "proof.txt"), "utf8")).trim(),
          "SCOPED-OK",
        );
        await assert.rejects(
          access(join(current.workspace, "..", "blocked-write.txt")),
        );
        await assert.rejects(access(marker));
        assert.equal(hits, 0);
        const results = store
          .events(task.id, "verification")
          .filter((e) => e.type === "tool.completed");
        console.log(
          JSON.stringify({
            phase: "tool_results",
            results: results.map((e) => ({
              error: e.data.error,
              content: JSON.stringify(e.data.content).slice(0, 1200),
            })),
          }),
        );
        assert.ok(
          results.some(
            (e) =>
              JSON.stringify(e.data.content).includes(
                "Operation not permitted",
              ) || JSON.stringify(e.data.content).includes("Permission denied"),
          ),
        );
        assert.ok(
          !results.some((e) =>
            JSON.stringify(e.data.content).includes("SYNTHETIC-PRIVATE-MARKER"),
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
            approved_commands: approved.length,
            workspace_write: true,
            outside_write_blocked: true,
            git_metadata_write_blocked: true,
            symlink_marker_not_read: true,
            network_hits: hits,
            cost_usd: current.cost_usd,
            primary_clean: true,
          }),
        );
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(
      store.get(task.id, "verification").status,
      "completed",
      "Native sandbox verification timed out",
    );
  } finally {
    await control.close();
    listener.closeAllConnections();
    await new Promise((r) => listener.close(r));
  }
}
