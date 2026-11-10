// A parent-started review whose request carries attachments of every kind,
// including one whose stored file is missing.
import type { TaskAttachment } from "../../../src/shared/attachments/model";
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

type PreviewAttachment = TaskAttachment & {
  /** The stored file's content; absent for a file removed from the data folder. */
  content?: string;
};

const lines = (text: string) => text.split("\n").length - 1;

/** The fixture tasks' attachments, served by the fixture service and listed in Chat. */
export const previewAttachments: Record<string, PreviewAttachment[]> = {
  [ID]: [
    {
      position: 1,
      title: "Uncommitted changes",
      summary:
        "The change under review: the prompt builder and the stored task schema.",
      format: "diff",
      source: "diff",
      file: "1-uncommitted-changes.diff",
      chars: diff.length,
      lines: lines(diff),
      files: 2,
      additions: 4,
      deletions: 2,
      content: diff,
    },
    {
      position: 2,
      title: "session-prompts.ts:44-55",
      summary: "The prompt builder as committed, for comparing section order.",
      format: "code",
      source: "file",
      path: "src/service/features/tasks/conversation/session-prompts.ts",
      file: "2-session-prompts-ts-44-55.ts",
      chars: code.length,
      lines: lines(code),
      start_line: 44,
      end_line: 55,
      content: code,
    },
    {
      position: 3,
      title: "provider-contract.md",
      summary:
        "What providers must give workers, including read access outside the workspace.",
      format: "markdown",
      source: "file",
      path: "docs/provider-contract.md",
      file: "3-provider-contract-md.md",
      chars: contract.length,
      lines: lines(contract),
      content: contract,
    },
    {
      position: 4,
      title: "Decisions",
      summary:
        "Choices made in the chat that aren't written down in the project.",
      format: "markdown",
      source: "inline",
      file: "4-decisions.md",
      chars: decisions.length,
      lines: lines(decisions),
      content: decisions,
    },
    {
      position: 5,
      title: "notes.md",
      summary: "A plain-text note whose label names a Markdown file.",
      format: "text",
      source: "inline",
      path: "notes.md",
      file: "5-notes-md.md",
      chars: literal.length,
      lines: lines(literal),
      content: literal,
    },
    {
      position: 6,
      title: "attachment-count-limits-proposed-in-the-chat.ts",
      summary: "The attachment count limit, as proposed in the chat.",
      format: "code",
      source: "inline",
      path: "src/shared/attachments/attachment-count-limits-proposed-in-the-chat.ts",
      file: "6-attachment-count-limits-proposed-in-the-chat.ts",
      chars: snippet.length,
      lines: lines(snippet),
      content: snippet,
    },
    {
      position: 7,
      title: "old-plan.md",
      summary: "The earlier plan, for comparison.",
      format: "markdown",
      source: "file",
      path: "docs/old-plan.md",
      file: "7-old-plan-md.md",
      chars: 1200,
      lines: 42,
    },
  ],
};

/** The attachments Chat lists under a fixture task's request. */
export const requestAttachments = (taskId: string) =>
  previewAttachments[taskId]?.map(
    ({ file: _, content: _content, ...attachment }) => attachment,
  );

const reply =
  "The prompt lists attachments after the workspace note, and a task without them keeps its old prompt. Resumed sessions don't get the list again.";

const timeline = new Timeline(ID, at(132), 2700);
begin(timeline, ["Read", "Bash"]);
timeline.say("Reading the diff first, then the provider contract.");
timeline.finish(reply, 1, { duration_ms: 84000, total_cost_usd: 0.31 });

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
  runtime_ms: 84000,
  cost_usd: 0.31,
  completed_at: at(134),
  ...timestamps(132, 2),
};
