// A parent-started review whose request carries attachments of every kind,
// including one whose stored file is missing, a parent follow-up with two more,
// and a user follow-up with an uploaded image and PDF.
import type { TaskAttachment } from "../../../src/shared/attachments/model";
import { REQUEST_ID } from "../../../src/shared/tasks/conversation/messages";
import type { Task } from "../../../src/shared/tasks/model";
import { at, taskBase, timestamps, worktree } from "./scenario-context";
import { begin, Timeline } from "./timeline";

const ID = "preview-attachments";

const diff = `diff --git a/src/service/features/tasks/conversation/session-prompts.ts b/src/service/features/tasks/conversation/session-prompts.ts
--- a/src/service/features/tasks/conversation/session-prompts.ts
+++ b/src/service/features/tasks/conversation/session-prompts.ts
@@ -46,8 +46,10 @@ export class SessionPrompts {
     const workspaceContext = this.workspaceContext(t);
+    const attachments = this.attachmentList(t);
     const transcript = t.turn > 1 ? this.transcript(t) : "";

     return [
       t.description,
       ...(workspaceContext ? [workspaceContext] : []),
-      ...t.context,
+      ...(t.context ?? []),
+      ...(attachments ? [attachments] : []),
       ...(transcript ? [transcript] : []),
diff --git a/src/service/features/tasks/storage/stored.ts b/src/service/features/tasks/storage/stored.ts
--- a/src/service/features/tasks/storage/stored.ts
+++ b/src/service/features/tasks/storage/stored.ts
@@ -51,5 +51,5 @@ const storedTaskSchema = z.looseObject({
   workspace_strategy: z.enum(["worktree", "current_repo"]),
   no_git: z.literal(true).optional(),
   workspace_fallback: z.enum(["no_git", "no_commits"]).optional(),
-  context: z.array(z.string()),
+  context: z.array(z.string()).optional(),
   budget: z.looseObject({
`;

const code = `  sessionPrompt(t: Task) {
    const workspaceContext = this.workspaceContext(t);
    const transcript = t.turn > 1 ? this.transcript(t) : "";

    return [
      t.description,
      ...(workspaceContext ? [workspaceContext] : []),
      ...t.context,
      ...(transcript ? [transcript] : []),
      ...this.unsent(t),
    ].join("\\n\\n");
  }
`;

const contract = `# Built-in provider contract

## A turn

The task conversation layer builds the prompt. A new session receives the
original request, workspace context, the task's attachment list and bounded
conversation history. A resumed session receives unsent messages and any
workspace reminder.

## Worker access

- The provider lets the worker read the attachment folder without prompts.
- It keeps the worker from changing the files.
`;

const decisions = `- Old tasks keep their \`context\` strings and show no attachments.
- Resumed sessions don't get the attachment list again.
- Summaries stay at one sentence.
`;

// Text attached as text, though its label names a Markdown file.
const literal = `# Not a heading

This note is plain text, so the dialog shows it as source.
`;

const snippet = `export const MAX_ATTACHMENTS = 20;
`;

const FOLLOW_UP = "msg_preview_attachments_1";

const testOutput = ` FAIL  session-prompts.test.ts > a legacy task keeps its prompt
AssertionError: expected 'Investigate\\n\\nfirst excerpt\\n' to equal 'Investigate\\n\\nfirst excerpt'
`;

const legacyTest = `test("a legacy task keeps its prompt", () => {
  const task = legacyTask({ context: ["first excerpt"] });

  assert.equal(
    prompts.sessionPrompt(task),
    "Investigate\\n\\nfirst excerpt",
  );
});
`;

const USER_FOLLOW_UP = "msg_preview_attachments_2";

type PreviewAttachment = TaskAttachment & {
  /** The stored file's content; absent for a file removed from the data folder. */
  content?: string;
  /** A file in `attachment-files` to store instead, for uploaded images and documents. */
  asset?: string;
};

const lines = (text: string) => text.split("\n").length - 1;

/** The fixture tasks' attachments, served by the fixture service and listed in Chat. */
export const previewAttachments: Record<string, PreviewAttachment[]> = {
  [ID]: [
    {
      message_id: REQUEST_ID,
      position: 1,
      title: "Uncommitted changes",
      summary:
        "The change under review: the prompt builder and the stored task schema.",
      format: "diff",
      source: "diff",
      file: "request-1-uncommitted-changes.diff",
      chars: diff.length,
      lines: lines(diff),
      files: 2,
      additions: 4,
      deletions: 2,
      content: diff,
    },
    {
      message_id: REQUEST_ID,
      position: 2,
      title: "session-prompts.ts:44-55",
      summary: "The prompt builder as committed, for comparing section order.",
      format: "code",
      source: "file",
      path: "src/service/features/tasks/conversation/session-prompts.ts",
      file: "request-2-session-prompts-ts-44-55.ts",
      chars: code.length,
      lines: lines(code),
      start_line: 44,
      end_line: 55,
      content: code,
    },
    {
      message_id: REQUEST_ID,
      position: 3,
      title: "provider-contract.md",
      summary:
        "What providers must give workers, including read access outside the workspace.",
      format: "markdown",
      source: "file",
      path: "docs/provider-contract.md",
      file: "request-3-provider-contract-md.md",
      chars: contract.length,
      lines: lines(contract),
      content: contract,
    },
    {
      message_id: REQUEST_ID,
      position: 4,
      title: "Decisions",
      summary:
        "Choices made in the chat that aren't written down in the project.",
      format: "markdown",
      source: "inline",
      file: "request-4-decisions.md",
      chars: decisions.length,
      lines: lines(decisions),
      content: decisions,
    },
    {
      message_id: REQUEST_ID,
      position: 5,
      title: "notes.md",
      summary: "A plain-text note whose label names a Markdown file.",
      format: "text",
      source: "inline",
      path: "notes.md",
      file: "request-5-notes-md.md",
      chars: literal.length,
      lines: lines(literal),
      content: literal,
    },
    {
      message_id: REQUEST_ID,
      position: 6,
      title: "attachment-count-limits-proposed-in-the-chat.ts",
      summary: "The attachment count limit, as proposed in the chat.",
      format: "code",
      source: "inline",
      path: "src/shared/attachments/attachment-count-limits-proposed-in-the-chat.ts",
      file: "request-6-attachment-count-limits-proposed-in-the-chat.ts",
      chars: snippet.length,
      lines: lines(snippet),
      content: snippet,
    },
    {
      message_id: REQUEST_ID,
      position: 7,
      title: "old-plan.md",
      summary: "The earlier plan, for comparison.",
      format: "markdown",
      source: "file",
      path: "docs/old-plan.md",
      file: "request-7-old-plan-md.md",
      chars: 1200,
      lines: 42,
    },
    // The parent agent's follow-up brings two more.
    {
      message_id: FOLLOW_UP,
      position: 1,
      title: "Test output",
      summary: "The failing prompt test's output after the change.",
      format: "text",
      source: "inline",
      file: `${FOLLOW_UP}-1-test-output.txt`,
      chars: testOutput.length,
      lines: lines(testOutput),
      content: testOutput,
    },
    {
      message_id: FOLLOW_UP,
      position: 2,
      title: "session-prompts.test.ts:12-20",
      summary: "The legacy prompt test that now fails.",
      format: "code",
      source: "file",
      path: "src/service/features/tasks/conversation/session-prompts.test.ts",
      file: `${FOLLOW_UP}-2-session-prompts-test-ts-12-20.ts`,
      chars: legacyTest.length,
      lines: lines(legacyTest),
      start_line: 12,
      end_line: 20,
      content: legacyTest,
    },
    // The user's follow-up uploads an image and a PDF.
    {
      message_id: USER_FOLLOW_UP,
      position: 1,
      title: "rollout-plan.png",
      summary: "User attached rollout-plan.png.",
      format: "image",
      source: "upload",
      path: "rollout-plan.png",
      file: `${USER_FOLLOW_UP}-1-rollout-plan-png.png`,
      mime_type: "image/png",
      bytes: 119434,
      chars: 0,
      lines: 0,
      asset: "rollout-plan.png",
    },
    {
      message_id: USER_FOLLOW_UP,
      position: 2,
      title: "launch-brief.pdf",
      summary: "User attached launch-brief.pdf.",
      format: "document",
      source: "upload",
      path: "launch-brief.pdf",
      file: `${USER_FOLLOW_UP}-2-launch-brief-pdf.pdf`,
      mime_type: "application/pdf",
      bytes: 587,
      chars: 0,
      lines: 0,
      asset: "launch-brief.pdf",
    },
  ],
};

/** The attachments Chat lists under a fixture task's message `messageId`. */
export const chatAttachments = (taskId: string, messageId: string) =>
  previewAttachments[taskId]
    ?.filter((attachment) => attachment.message_id === messageId)
    .map(
      ({ file: _, content: _content, asset: _asset, ...attachment }) =>
        attachment,
    );

const reply =
  "The prompt lists attachments after the workspace note, and a task without them keeps its old prompt. Resumed sessions don't get the list again.";

const followUpReply =
  "The legacy test still expects `context` before the workspace note. The change keeps that order, so the test fails only on the trailing newline it added. Update the expected string.";

const userFollowUpReply =
  "The chart's error rate and p95 targets match the brief. Each stage holds for at least two weeks, which the brief requires.";

const timeline = new Timeline(ID, at(132), 2700);
begin(timeline, ["Read", "Bash"]);
timeline.say("Reading the diff first, then the provider contract.");
timeline.finish(reply, 1, { duration_ms: 84000, total_cost_usd: 0.31 });

timeline
  .add("task.instruction", {
    message_id: FOLLOW_UP,
    message:
      "The legacy prompt test fails now. Check whether the change or the test is wrong.",
    from: "parent",
    delivery: "steer",
  })
  .add("task.queued", {}, 100)
  .add("task.started", { turn: 2 }, 300)
  .say("Comparing the failing output with the test's expected prompt.")
  .finish(followUpReply, 2, { duration_ms: 51000, total_cost_usd: 0.18 });

timeline
  .add("task.instruction", {
    message_id: USER_FOLLOW_UP,
    message: "Check the rollout chart against the launch brief.",
    from: "user",
    delivery: "steer",
  })
  .add("task.queued", {}, 100)
  .add("task.started", { turn: 3 }, 300)
  .say("Reading the chart, then the brief.")
  .finish(userFollowUpReply, 3, { duration_ms: 38000, total_cost_usd: 0.12 });

export const attachmentTimeline = timeline;

export const attachmentTask: Task = {
  ...taskBase,
  ...worktree(ID),
  id: ID,
  title: "Review the session prompt change",
  description:
    "**Review the uncommitted session prompt change.**\n\nCheck that attachments are listed after the workspace note and that legacy tasks keep a byte-identical prompt. Flag anything that would break resumed sessions.",
  worker_profile: "reviewer",
  created_by: "parent",
  status: "completed",
  turn: 3,
  instructions_sent: 2,
  runtime_ms: 173000,
  cost_usd: 0.61,
  completed_at: at(134),
  ...timestamps(132, 2),
};
