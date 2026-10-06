// What preview tasks changed, as files in a Git repository. The fixture
// service (ui/dev/fixture-service.ts) builds a real repository per task from
// these, so the Changes tab reads real Git diffs in fixtures mode. Contents are
// built on first use, since some are large.
import parseDiff from "parse-diff";

import { largeFiles } from "./large-files";

/** File contents by path (bytes for binary files); null deletes a file. */
export type Edits = Record<string, string | Uint8Array | null>;

/** One turn: edits, or a unified diff to apply with `git apply`. */
export type Turn = Edits | { patch: string };

export type ChangeFixture = {
  /** Files in the base commit. */
  base: Record<string, string | Uint8Array>;
  /** current_repo only: uncommitted edits from before the task started. */
  before?: Edits;
  /** Each turn's edits, in order. */
  turns: Turn[];
  /** Worktree only: commit each turn on the task's branch. */
  commit?: boolean;
  /** Worktree only: the worktree was removed after the last turn. */
  removed?: boolean;
  /** Worktree only: its branch was deleted too, after removal. */
  branchDeleted?: boolean;
};

/**
 * The files a diff starts from, for diffs whose hunks each cover a whole
 * file, as the large fixture diff's do.
 */
export function preimage(diff: string) {
  const files: Record<string, string> = {};

  for (const file of parseDiff(diff)) {
    if (file.new || !file.from) continue;

    const lines = file.chunks.flatMap((chunk) =>
      chunk.changes
        .filter((change) => change.type !== "add")
        .map((change) => change.content.slice(1)),
    );

    files[file.from] = lines.length ? `${lines.join("\n")}\n` : "";
  }

  return files;
}

const lines = (...text: string[]) => `${text.join("\n")}\n`;

const inspectorCss = lines(
  ".task-inspector {",
  "  display: grid;",
  "  gap: 12px;",
  "  padding: 16px;",
  "}",
  "",
  ".task-inspector header {",
  "  display: flex;",
  "  align-items: center;",
  "}",
);

const inspectorTsx = lines(
  'import { TaskHeader } from "./task-header";',
  "",
  "export function TaskInspector({ task }: { task: Task }) {",
  "  return (",
  '    <section className="task-inspector">',
  "      <TaskHeader task={task} />",
  "    </section>",
  "  );",
  "}",
);

const billingIndex = lines(
  'export { charge, refund } from "./legacy";',
  'export { taxFor } from "./tax";',
  "",
  "export function renderInvoice(total: number) {",
  "  return `Total: ${total.toFixed(2)}`;",
  "}",
);

const legacyBilling = lines(
  "export function charge(cents: number) {",
  "  return { status: 'charged', cents };",
  "}",
  "",
  "export function refund(cents: number) {",
  "  return { status: 'refunded', cents };",
  "}",
);

const tax = lines(
  "export function taxFor(total: number) {",
  "  return Math.round(total * 0.2 * 100) / 100;",
  "}",
);

// A 1×1 PNG, to show a binary change.
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/** Change fixtures by preview task id. */
export const previewChanges: Record<string, () => ChangeFixture> = {
  // A worktree task with two turns, committed on its branch.
  "preview-interrupted": (): ChangeFixture => ({
    base: {
      "ui/inspector.css": inspectorCss,
      "ui/inspector.tsx": inspectorTsx,
    },
    commit: true,
    turns: [
      {
        "ui/inspector.css": inspectorCss
          .replace("gap: 12px", "gap: 8px")
          .replace("padding: 16px", "padding: 12px 16px"),
      },
      {
        "ui/inspector.tsx": inspectorTsx.replace(
          "      <TaskHeader task={task} />\n",
          "      <TaskHeader task={task} />\n      <TaskFacts task={task} />\n",
        ),
        "ui/task-facts.tsx": lines(
          "export function TaskFacts({ task }: { task: Task }) {",
          '  return <dl className="facts">{task.id}</dl>;',
          "}",
        ),
      },
    ],
  }),

  // A current_repo task: the user's earlier edit to README.md is left out.
  "preview-refactor": (): ChangeFixture => ({
    base: {
      "README.md": "# Billing\n",
      "billing/index.ts": billingIndex,
      "billing/legacy.ts": legacyBilling,
      "billing/tax.ts": tax,
      "assets/logo.png": "placeholder\n",
    },
    before: { "README.md": "# Billing\n\nWork in progress.\n" },
    turns: [
      {
        "billing/index.ts": lines(
          'export { charge, refund } from "./payments";',
          'export { renderInvoice, taxFor } from "./invoices";',
        ),
        "billing/legacy.ts": null,
        "billing/tax.ts": null,
        "billing/invoices/tax.ts": tax,
        "billing/invoices.ts": lines(
          'export { taxFor } from "./invoices/tax";',
          "",
          "export function renderInvoice(total: number) {",
          "  return `Total: ${total.toFixed(2)}`;",
          "}",
        ),
        "billing/payments.ts": legacyBilling,
        "assets/logo.png": pixel,
      },
    ],
  }),

  // A worktree that was removed; its changes are read from the branch.
  "preview-failed": (): ChangeFixture => ({
    base: { "test/retry.test.ts": "test.skip('retries');\n" },
    commit: true,
    removed: true,
    turns: [{ "test/retry.test.ts": "test('retries', { retry: 2 });\n" }],
  }),

  // Every large file, added, for the file previews: megabytes of diff, so
  // the changes come in several pages.
  "preview-profile": (): ChangeFixture => ({
    base: { "README.md": "# Build profile\n" },
    turns: [
      Object.fromEntries(largeFiles().map((file) => [file.path, file.content])),
    ],
  }),

  // A worktree and branch the user deleted.
  "preview-cancelled": (): ChangeFixture => ({
    base: { "RELEASE.md": "# Release notes\n" },
    removed: true,
    branchDeleted: true,
    turns: [{ "RELEASE.md": "# Release notes\n\n- Draft\n" }],
  }),

  // 60 files and about 7,000 changed lines, with a rename and a deletion.
  "preview-build": (): ChangeFixture => {
    const diff = largeFiles().find((file) => file.path === "changes.diff")!;

    return { base: preimage(diff.content), turns: [{ patch: diff.content }] };
  },
};
