import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ClaudeCli } from "../src/service/features/providers/claude/configuration/executable.ts";
import { ClaudeAgentProvider } from "../src/service/features/providers/claude/runtime/provider.ts";
import { Control } from "../src/service/features/tasks/runtime/control.ts";
import { Store } from "../src/service/features/tasks/storage/store.ts";
import { Workspaces } from "../src/service/features/workspaces/workspace.ts";
import {
  observedEditsProvider,
  prepareEditsFixture,
  runEditsScenario,
} from "./live-claude-edits.mjs";

/** A task's latest reply text, or "" before it has replied. */
const latestReply = (store, id) =>
  String(store.latestEvent(id, "agent.reply")?.data.text ?? "");

if (process.env.CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY !== "1") {
  console.error(
    "Set CODEX_SUBAGENT_EXTENSION_LIVE_VERIFY=1 to opt into authenticated Claude model calls. Each task configures a native cost budget of at most $0.25, $0.50 for parity, or $1.50 for edits. The edits scenario runs four tasks. A response can exceed the budget before work stops.",
  );

  process.exit(1);
}

const scenario = process.argv[2] ?? "read";

assert.ok(
  [
    "read",
    "resume",
    "sandbox",
    "mcp",
    "budget",
    "parity",
    "parent",
    "edits",
  ].includes(scenario),
  "Choose read, resume, sandbox, mcp, budget, parity, parent, or edits",
);

// Every task runs on this model and effort; an empty value inherits the CLI default.
const modelChoice = {
  model: process.env.CODEX_SUBAGENT_EXTENSION_LIVE_MODEL ?? "haiku",
  reasoning_effort:
    (process.env.CODEX_SUBAGENT_EXTENSION_LIVE_EFFORT ?? "medium") || "default",
};

// Every scenario runs the installed CLI the service would pick, passed to the SDK as pathToClaudeCodeExecutable.
const cli = new ClaudeCli();
const executable = await cli.status();

if (!executable.ready) {
  console.error(executable.message);
  process.exit(1);
}

console.log(
  `Claude Code ${executable.version} at ${executable.path} (supported ${executable.supported})`,
);

console.log(
  `Model ${modelChoice.model || "default"}, effort ${modelChoice.reasoning_effort}`,
);

const edits = scenario === "edits" ? observedEditsProvider(cli) : undefined;

const provider = () =>
  edits?.provider ?? new ClaudeAgentProvider(undefined, undefined, cli);

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

if (scenario === "edits") {
  await prepareEditsFixture(repo);
  execFileSync("git", ["-C", repo, "add", "."]);
}

if (scenario === "parity") {
  // Project-scoped Claude Code configuration, loaded the same way the CLI does.
  const { fileURLToPath } = await import("node:url");

  const sdk = (path) =>
    fileURLToPath(
      new URL(
        `../node_modules/@modelcontextprotocol/sdk/dist/esm/server/${path}`,
        import.meta.url,
      ),
    );

  await writeFile(
    join(root, "fixture-mcp.mjs"),
    `import { McpServer } from ${JSON.stringify(sdk("mcp.js"))};
import { StdioServerTransport } from ${JSON.stringify(sdk("stdio.js"))};
const server = new McpServer({ name: "fixture", version: "1" });
server.registerTool("fixture_marker", { description: "Return the fixture MCP marker" }, async () => ({
  content: [{ type: "text", text: "SAFFRON-63" }],
}));
await server.connect(new StdioServerTransport());
`,
  );

  await writeFile(
    join(repo, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        fixture: {
          command: process.execPath,
          args: [join(root, "fixture-mcp.mjs")],
        },
      },
    }),
  );

  await mkdir(join(repo, ".claude", "skills", "marker-skill"), {
    recursive: true,
  });

  await writeFile(
    join(repo, ".claude", "skills", "marker-skill", "SKILL.md"),
    "---\nname: marker-skill\ndescription: Reveals the fixture skill marker.\n---\n\nThe skill marker is VERMILION-41.\n",
  );

  await writeFile(
    join(repo, ".claude", "settings.json"),
    JSON.stringify({
      enableAllProjectMcpServers: true,
      hooks: {
        PreToolUse: [
          {
            matcher: "Read",
            hooks: [
              {
                type: "command",
                command: `/usr/bin/touch ${JSON.stringify(join(root, "hook-fired"))}`,
              },
            ],
          },
        ],
      },
    }),
  );

  execFileSync("git", ["-C", repo, "add", ".mcp.json", ".claude"]);
}

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

// Fields every task shares: the fixture repository, provider and model choice.
const taskBase = { provider: "claude", ...modelChoice, repository: repo };

const store = new Store(join(root, "tasks.sqlite"));

const control = new Control(
  store,
  new Workspaces(join(root, "worktrees"), [repo]),
  new Map([["claude", provider()]]),
);

if (scenario === "edits") {
  await runEditsScenario({
    control,
    store,
    repo,
    root,
    taskBase,
    observed: edits.observed,
  });
} else if (scenario === "parent") {
  const task = await control.start("verification", {
    ...taskBase,
    worker_profile: "reviewer",
    conversation_id: "parent-verification",
    description:
      "Use mcp__codex_parent__message_parent exactly once to send PARENT-POC-27. Do not inspect files, run commands, or use any other tools. Then reply with DONE. This is a delivery verification; do not send a second completion update.",
    budget: { max_runtime_minutes: 1, max_cost_usd: 0.25 },
  });

  console.log(JSON.stringify({ phase: "started", root, task_id: task.id }));

  try {
    const deadline = Date.now() + 70000;

    while (Date.now() < deadline) {
      const current = store.get(task.id, "verification");

      if (["completed", "failed", "interrupted"].includes(current.status)) {
        assert.equal(current.status, "completed", current.error);
        const messages = store.eventsOfTypes(task.id, ["parent.message"]);
        assert.equal(messages.length, 1);
        assert.equal(messages[0].data.text, "PARENT-POC-27");
        assert.equal(current.pending_input, undefined);

        console.log(
          JSON.stringify({
            phase: "verified",
            queued: true,
            native_tool_called: true,
            cost_usd: current.cost_usd,
            host_delivery_tested: false,
          }),
        );

        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    assert.equal(
      store.get(task.id, "verification").status,
      "completed",
      "Parent tool verification timed out",
    );
  } finally {
    await control.close();
  }
} else if (scenario === "read") {
  const task = await control.start("verification", {
    ...taskBase,
    worker_profile: "reviewer",
    description:
      "Read README.md using the native Read tool. Report the exact verification marker in your reply. Do not ask questions, run commands or edit files.",
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

      if (["completed", "failed", "interrupted"].includes(current.status)) {
        assert.equal(current.status, "completed", current.error);
        assert.ok(latestReply(store, task.id).includes("COBALT-27"));
        assert.ok(current.session_id && current.session_state_ref);
        const evidence = store.events(task.id, "verification");

        assert.ok(
          evidence.some(
            (e) => e.type === "tool.started" && e.data.name === "Read",
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
            cost_usd: current.cost_usd,
            session_state_available: !!current.session_state_ref,
            read_tool_observed: true,
            reply_persisted: true,
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
    ...taskBase,
    worker_profile: "reviewer",
    description:
      "Before reading anything, use the native AskUserQuestion tool to ask: May I inspect README now? Offer Proceed and Wait. Wait for the user response before inspecting README. Afterwards report its exact verification marker in your reply.",
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
        !["completed", "failed", "interrupted"].includes(current.status),
        current.error ?? "Task ended before asking",
      );

      await new Promise((r) => setTimeout(r, 250));
    }

    const waiting = store.get(task.id, "verification");
    assert.equal(waiting.pending_input?.tool, "AskUserQuestion");
    assert.ok(waiting.session_id && waiting.session_state_ref);
    const session = waiting.session_id;
    await control.interrupt("verification", task.id);
    assert.equal(store.get(task.id, "verification").status, "interrupted");
    await control.close();
    const nextStore = new Store(join(root, "tasks.sqlite"));

    reopened = new Control(
      nextStore,
      new Workspaces(join(root, "worktrees"), [repo]),
      new Map([["claude", provider()]]),
    );

    await reopened.recover();

    await reopened.send(
      "verification",
      task.id,
      "Proceed now. Read README.md with the Read tool and report its exact marker in your reply. Do not ask another question or run commands.",
      "user",
    );

    console.log(
      JSON.stringify({ phase: "resumed_after_restart", same_task: true }),
    );

    const finalDeadline = Date.now() + 65000;

    while (Date.now() < finalDeadline) {
      const current = nextStore.get(task.id, "verification");

      if (["completed", "failed", "interrupted"].includes(current.status)) {
        assert.equal(current.status, "completed", current.error);
        assert.equal(current.session_id, session);
        assert.equal(current.turn, 2);
        assert.ok(latestReply(nextStore, task.id).includes("COBALT-27"));

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
            turn: current.turn,
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
  const { application } = await import("../src/service/platform/server/app.ts");
  const { Auth } = await import("../src/service/platform/server/auth.ts");
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
    fileURLToPath(new URL("../dist/app.html", import.meta.url)),
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
      ...taskBase,
      worker_profile: "reviewer",
      description:
        "Read README.md with the native Read tool. Include its exact verification marker in your reply. Do not ask questions, edit files or run commands.",
      budget: { max_runtime_minutes: 1, max_cost_usd: 0.25 },
    });

    console.log(
      JSON.stringify({ phase: "mcp_task_created", task_id: task.id, root }),
    );

    const deadline = Date.now() + 65000;
    let completed;

    while (Date.now() < deadline) {
      const current = await call("get_agent_task", { task_id: task.id });

      if (["completed", "failed", "interrupted"].includes(current.status)) {
        assert.equal(current.status, "completed", current.error);
        completed = current;
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    assert.ok(completed, "Native MCP verification timed out");
    const report = await call("get_agent_messages", { task_id: task.id });

    assert.ok(
      report.messages
        .find((m) => m.kind === "reply")
        .text.includes("COBALT-27"),
    );

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
        reply_retrieved: true,
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
    ...taskBase,
    worker_profile: "reviewer",
    description:
      "Read README.md using Read and report its exact marker in your reply. Do not ask questions, edit files or run shell commands.",
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

      if (["completed", "failed", "interrupted"].includes(current.status)) {
        ended = current;
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    assert.ok(ended, "Native budget verification timed out");
    assert.equal(ended.status, "failed", ended.error);
    assert.match(ended.error, /error_max_budget_usd/);
    assert.ok(ended.cost_usd >= limit);
    assert.equal(store.latestEvent(task.id, "agent.reply"), undefined);

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
        no_reply: true,
        primary_clean: true,
      }),
    );
  } finally {
    await control.close();
  }
} else if (scenario === "parity") {
  const { access } = await import("node:fs/promises");

  const task = await control.start("verification", {
    ...taskBase,
    worker_profile: "implementer",
    description:
      "Do exactly these steps and nothing else: 1. Invoke the marker-skill skill with the Skill tool and note its marker. 2. Call the fixture_marker tool of the fixture MCP server and note its marker. 3. Use the Agent tool with run_in_background set to false to start one subagent that reads README.md with the Read tool and returns its verification marker, and wait for its result. Report all three markers in your reply. Do not edit files or run shell commands.",
    budget: { max_runtime_minutes: 3, max_cost_usd: 0.5 },
  });

  console.log(
    JSON.stringify({
      phase: "started",
      root,
      task_id: task.id,
      provider_options: task.provider_options?.claude,
    }),
  );

  const expected = (tool) =>
    ["Skill", "Agent", "Task", "Read", "Glob", "Grep"].includes(tool) ||
    tool.startsWith("mcp__fixture__");

  const approvals = [];

  try {
    const deadline = Date.now() + 185000;
    let ended;

    while (Date.now() < deadline) {
      const current = store.get(task.id, "verification");

      if (current.pending_input) {
        const { id, tool } = current.pending_input;
        const allow = expected(tool);
        approvals.push({ tool, approved: allow });

        control.input(
          "verification",
          task.id,
          id,
          allow,
          undefined,
          allow ? undefined : "Only the fixture steps are approved",
        );
      }

      if (["completed", "failed", "interrupted"].includes(current.status)) {
        ended = current;
        break;
      }

      await new Promise((r) => setTimeout(r, 100));
    }

    assert.ok(ended, "Native parity verification timed out");
    assert.equal(ended.status, "completed", ended.error);

    const started = store
      .events(task.id, "verification")
      .filter((e) => e.type === "tool.started")
      .map((e) => e.data.name);

    const findings = latestReply(store, task.id);

    const observed = {
      skill_tool: started.includes("Skill"),
      skill_marker: findings.includes("VERMILION-41"),
      mcp_tool: started.some((name) => name.startsWith("mcp__fixture__")),
      mcp_marker: findings.includes("SAFFRON-63"),
      subagent_tool: started.some((name) => ["Agent", "Task"].includes(name)),
      subagent_marker: findings.includes("COBALT-27"),
      project_hook_fired: await access(join(root, "hook-fired")).then(
        () => true,
        () => false,
      ),
    };

    console.log(
      JSON.stringify({ phase: "observed", ...observed, approvals, started }),
    );

    for (const [check, passed] of Object.entries(observed)) {
      assert.ok(passed, check);
    }

    assert.equal(
      execFileSync("git", ["-C", repo, "status", "--porcelain"], {
        encoding: "utf8",
      }),
      "",
    );

    console.log(
      JSON.stringify({
        phase: "verified",
        ...observed,
        reply_received: true,
        cost_usd: ended.cost_usd,
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

  // The sandbox is opt-in; default parity leaves Bash to the user's settings.
  control.settings.update("verification", {
    set: { claude_sandbox: "extension", claude_path_guard: "on" },
  });

  const task = await control.start("verification", {
    ...taskBase,
    worker_profile: "test_engineer",
    // Fixture writes stay out of the primary checkout.
    workspace_strategy: "worktree",
    // Ask for every command so only the exact fixture commands are approved.
    provider_options: { claude: { permission_mode: "default" } },
    description:
      "Run each of these exact Bash commands once, sequentially. Do not change, combine or retry the commands; do not use other tools. Expected permission failures are evidence, not errors in this verification. Report which commands succeeded or were blocked in your reply. Commands: " +
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

      if (["completed", "failed", "interrupted"].includes(current.status)) {
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
