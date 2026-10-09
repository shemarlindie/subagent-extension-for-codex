import type { Task } from "../../../src/shared/tasks/model";
import { at, taskBase, timestamps, WEBSITE } from "./scenario-context";
import { begin, IMAGE, MODEL, rateLimit, text, Timeline } from "./timeline";

const auditReply = `Two dependencies use licences that need review before release; the rest are permissive.

- \`legacy-charts\` is GPL-3.0 and is imported by the reporting bundle.
- \`fast-parse\` has no licence field, and its repository has no LICENSE file.

I read \`package.json\` and \`package-lock.json\`, and checked the licence field of each installed package. No tests were run, since this was a read-only audit.

**Left to do:** replace \`legacy-charts\` or isolate it behind a separate process, and ask the \`fast-parse\` maintainers to add a licence before adopting it.`;

const blocksReply = `Catalogued the design assets and flagged one mismatched icon size: \`logo-small.png\` is 64×64 px, but the manifest expects 128×128.

I added \`assets/README.md\` with the expected sizes, and \`npm run lint\` passes. The small logo should be regenerated from the vector source.`;

// --- Completed research run with most row kinds ------------------------------
const audit = new Timeline("preview-audit", at(0), 100);
begin(audit, ["Glob", "Grep", "Read", "Bash"]);
rateLimit(audit);
audit.ticks(40, 120, 310);
audit.think("", "msg_audit_plan");

audit.say(
  "I'll start with the manifest, then check each dependency's licence field.",
  "msg_audit_plan",
);

const glob = audit.toolStart("Glob", { pattern: "**/package.json" });
audit.toolProgress(glob, "Glob", 1);

audit.toolDone(
  glob,
  "package.json\nnode_modules/legacy-charts/package.json\nnode_modules/fast-parse/package.json",
);

audit.sdk({
  type: "system",
  subtype: "hook_started",
  hook_id: "preview-audit-hook",
  hook_name: "Validate workspace",
  hook_event: "PreToolUse",
});

audit.sdk({
  type: "system",
  subtype: "hook_progress",
  hook_id: "preview-audit-hook",
  hook_name: "Validate workspace",
  hook_event: "PreToolUse",
  stdout: "checking boundary",
  stderr: "",
  output: "checking boundary",
});

audit.sdk({
  type: "system",
  subtype: "hook_response",
  hook_id: "preview-audit-hook",
  hook_name: "Validate workspace",
  hook_event: "PreToolUse",
  output: "Workspace boundary verified",
  stdout: "Workspace boundary verified",
  stderr: "",
  exit_code: 0,
  outcome: "success",
});

audit.tool(
  "Read",
  { file_path: "package.json" },
  '1\t{\n2\t  "name": "demo-project",\n3\t  "dependencies": {\n4\t    "legacy-charts": "^2.1.0",\n5\t    "fast-parse": "^0.4.2"\n6\t  }\n7\t}',
  { progress: [1] },
);

audit.sdk({
  type: "system",
  subtype: "api_retry",
  attempt: 1,
  max_retries: 3,
  retry_delay_ms: 2000,
  error_status: 529,
  error: "overloaded",
});

audit.ticks(80, 260);

audit.assistant(
  [
    {
      type: "thinking",
      thinking:
        "The two unusual dependencies are the ones to inspect. Grep the licence field next.",
      signature: "synthetic-signature",
    },
    text(
      "Checking licences with a search, then summarising:\n\n```sh\ngrep -h '\"license\"' node_modules/*/package.json | sort | uniq -c\n```",
    ),
  ],
  "msg_audit_grep",
);

audit.tool(
  "Grep",
  { pattern: '"license"', path: "node_modules" },
  'node_modules/legacy-charts/package.json:  "license": "GPL-3.0"\nnode_modules/chart-utils/package.json:  "license": "MIT"',
  { progress: [2, 4] },
);

audit.sdk({
  type: "system",
  subtype: "compact_boundary",
  compact_metadata: { trigger: "auto", pre_tokens: 41000, post_tokens: 7800 },
});

audit.sdk({
  type: "system",
  subtype: "files_persisted",
  files: [{ filename: "licence-report.md", file_id: "file_demo_1" }],
  failed: [],
  processed_at: at(2),
});

audit.sdk({
  type: "system",
  subtype: "notification",
  key: "scan-complete",
  text: "Licence scan complete.",
  priority: "low",
});

audit.sdk({
  type: "tool_use_summary",
  summary: "Read the manifest and scanned dependency licences.",
  preceding_tool_use_ids: [],
});

audit.finish(auditReply);

// --- Content blocks and rarer messages ----------------------------------------
const blocks = new Timeline("preview-blocks", at(90), 600);
begin(blocks, ["Read", "WebSearch", "mcp__assets__list"]);

blocks.add("task.control_requested", { status: "interrupted" }, 200);
blocks.turnEnded(1, "interrupted", 21000, 0.18);
blocks.add("task.interrupted", {}, 200);

blocks.add(
  "task.instruction",
  {
    message_id: "msg_preview_blocks_1",
    message: "Also check the vendored icons.",
    from: "user",
    delivery: "steer",
  },
  200,
);

blocks.add("task.queued", {}, 100);
blocks.add("task.started", { turn: 2 }, 300);
blocks.user("Also check the vendored icons.");

blocks.assistant(
  [
    {
      type: "thinking",
      thinking: "The user wants the icon sizes too.",
      signature: "synthetic-signature",
    },
  ],
  "msg_blocks_a",
);

blocks.assistant([{ type: "redacted_thinking", data: "redacted" }]);
blocks.say("Looking at the asset folder first.", "msg_blocks_a");

blocks.tool("Read", { file_path: "assets/logo-small.png" }, [
  { type: "text", text: "Image preview of assets/logo-small.png" },
  {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: IMAGE },
  },
]);

blocks.assistant([
  {
    type: "text",
    text: "The style guide lists the expected sizes.",
    citations: [
      {
        type: "page_location",
        cited_text: "Small logo: 128×128 px",
        document_index: 0,
        document_title: "Style guide",
        end_page_number: 5,
        file_id: null,
        start_page_number: 4,
      },
    ],
  },
]);

blocks.userMessage([
  {
    type: "document",
    title: "Style guide (excerpt)",
    source: {
      type: "text",
      media_type: "text/plain",
      data: "Small logo: 128×128 px\nLarge logo: 512×512 px",
    },
  },
]);

blocks.assistant([
  {
    type: "server_tool_use",
    id: "srvtoolu_preview_search",
    name: "web_search",
    input: { query: "png icon sizes" },
  },
  {
    type: "web_search_tool_result",
    tool_use_id: "srvtoolu_preview_search",
    content: [
      {
        type: "web_search_result",
        encrypted_content: "synthetic",
        page_age: null,
        title: "PNG sizing guide",
        url: "https://example.com/png",
      },
    ],
  },
]);

blocks.sdk({
  type: "prompt_suggestion",
  suggestion: "Regenerate the small logo from the SVG source.",
});

blocks.sdk({
  type: "system",
  subtype: "elicitation_complete",
  mcp_server_name: "assets",
  elicitation_id: "preview-elicitation",
});

blocks.sdk({
  type: "system",
  subtype: "plugin_install",
  status: "installed",
  name: "asset-tools",
});

blocks.sdk({
  type: "system",
  subtype: "memory_recall",
  mode: "select",
  memories: [{ path: "style-guide.md", scope: "personal" }],
});

blocks.say(
  'Done. Summary of sizes:\n\n```json\n{ "logo-small.png": "64x64", "logo.png": "512x512" }\n```',
);

blocks.finish(blocksReply, 2);

// --- Rare SDK signals and session housekeeping --------------------------------
const signals = new Timeline("preview-signals", at(100), 700);
begin(signals, ["Read"]);

signals.sdk({
  type: "auth_status",
  isAuthenticating: true,
  output: ["Refreshing credentials…"],
});

signals.sdk({
  type: "auth_status",
  isAuthenticating: false,
  output: [],
});

signals.sdk({
  type: "system",
  subtype: "informational",
  content: "Plan mode is active; edits are disabled.",
  level: "notice",
});

signals.sdk({
  type: "system",
  subtype: "commands_changed",
  commands: [
    { name: "review", description: "Review changes", argumentHint: "" },
  ],
});

signals.sdk({
  type: "system",
  subtype: "control_request_progress",
  request_id: "preview-request",
  status: "api_retry",
  attempt: 1,
  max_retries: 3,
  retry_delay_ms: 1500,
  error_status: 429,
});

signals.sdk({
  type: "system",
  subtype: "model_refusal_fallback",
  trigger: "refusal",
  direction: "retry",
  original_model: "claude-opus-5-5",
  fallback_model: MODEL,
  request_id: null,
  content: "The request was retried with a different model.",
});

signals.sdk({
  type: "system",
  subtype: "model_refusal_no_fallback",
  original_model: "claude-opus-5-5",
  request_id: null,
  content: "The model declined to continue and no fallback was available.",
});

signals.sdk({
  type: "system",
  subtype: "worker_shutting_down",
  reason: "host_draining",
});

signals.sdk({
  type: "conversation_reset",
  new_conversation_id: "00000000-0000-4000-8000-0000000fffff",
  trigger: "clear",
});

signals.sdk({
  type: "system",
  subtype: "session_state_changed",
  state: "idle",
});

// --- Long run: more events than the activity view keeps (EVENT_TAIL_SIZE) ----
const longReply = `Converted 36 test files to the new runner; one needed a manual fix.

\`suite-17.test.ts\` relied on global state and failed once, so I isolated its setup. \`npm test\` now passes for all 36 files.

The legacy runner can be removed once CI has run twice.`;

const long = new Timeline("preview-long", at(110), 900);
begin(long, ["Read", "Edit", "Bash"]);

for (let i = 0; i < 36; i++) {
  const file = `tests/suite-${i}.test.ts`;
  if (i % 12 === 0) rateLimit(long);
  if (i === 18)
    long.sdk({
      type: "system",
      subtype: "compact_boundary",
      compact_metadata: {
        trigger: "auto",
        pre_tokens: 88000,
        post_tokens: 9000,
      },
    });
  long.ticks(40 + i, 120 + i);
  long.think(`Next up: ${file}. Check the imports before converting.`);
  long.say(`Converting ${file} to the new runner.`);

  long.tool(
    "Read",
    { file_path: file },
    `1\timport { test } from "legacy-runner";\n2\ttest("suite ${i}", () => {});`,
    { progress: [1] },
  );

  if (i % 3 === 0)
    long.tool(
      "Edit",
      {
        file_path: file,
        old_string: 'from "legacy-runner"',
        new_string: 'from "new-runner"',
      },
      `The file ${file} has been updated.`,
      { progress: [1] },
    );
  if (i % 5 === 0 || i === 17)
    long.tool(
      "Bash",
      { command: `npm test -- ${file}` },
      i === 17
        ? `FAIL ${file}\n  shared state leaked from another test`
        : `PASS ${file}`,
      { progress: [2, 4], error: i === 17 },
    );
}

long.finish(longReply);

export const activityTasks: Task[] = [
  {
    ...taskBase,
    id: "preview-audit",
    title: "Audit dependency licences",
    description:
      "Check every direct dependency's licence and flag anything incompatible with a permissive release.",
    status: "completed",
    model: "sonnet",
    runtime_ms: 64000,
    cost_usd: 0.42,
    ...timestamps(0, 2),
  },
  {
    ...taskBase,
    id: "preview-blocks",
    title: "Catalogue the design assets",
    description:
      "List the assets in assets/ and compare them with the style guide.",
    repository: WEBSITE,
    status: "completed",
    turn: 2,
    instructions: [
      {
        id: "msg_preview_blocks_1",
        message: "Also check the vendored icons.",
        from: "user" as const,
      },
    ],
    instructions_sent: 1,
    model: "opus",
    reasoning_effort: "high",
    runtime_ms: 128000,
    cost_usd: 0.91,
    ...timestamps(90, 3),
  },
  {
    ...taskBase,
    id: "preview-signals",
    title: "Monitor session health",
    description: "Watch the worker session and report unusual conditions.",
    worker_profile: "reviewer",
    status: "interrupted",
    ...timestamps(100, 1),
  },
  {
    ...taskBase,
    id: "preview-long",
    title: "Convert the test suite to the new runner",
    description:
      "Convert every test file to the new runner API and run each one after editing it.",
    worker_profile: "implementer",
    provider_options: {
      claude: {
        permission_mode: "inherit",
        permission_source: "user_config",
        approval_decider: "user",
      },
    },
    status: "completed",
    runtime_ms: 540000,
    cost_usd: 2.37,
    ...timestamps(110, 9),
  },
];

export const activityTimelines = [audit, blocks, signals, long];
