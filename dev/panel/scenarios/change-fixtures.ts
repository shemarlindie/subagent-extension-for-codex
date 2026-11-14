// Fixture file edits become incremental recorded hunks in the real changes service.
// Contents are built on first use, since some are large.
import parseDiff from "parse-diff";

import { largeFiles } from "./large-files";

/** File contents by path (bytes for binary files); null deletes a file. */
export type Edits = Record<string, string | Uint8Array | null>;

/** One turn: edits, or a unified diff to apply with `git apply`. */
export type Turn = Edits | { patch: string };

export type ChangeFixture = {
  /** Files in the base commit. */
  base: Record<string, string | Uint8Array>;
  source?: "tool" | "command";
  incomplete?: string[];
  unrecordedCommands?: boolean;
  /** current_repo only: uncommitted edits from before the task started. */
  before?: Edits;
  /** Each turn's edits, in order. */
  turns: Turn[];
  /**
   * current_repo only: the task's changes end after its last turn, then the
   * user commits these edits. Recorded diffs retain the task edits.
   */
  committedAfter?: Edits;
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
function preimage(diff: string) {
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
export const previewChanges: Partial<Record<string, () => ChangeFixture>> = {
  // A worktree task with two turns, committed on its branch.
  "preview-interrupted": (): ChangeFixture => ({
    base: {
      "src/panel/inspector.css": inspectorCss,
      "src/panel/inspector.tsx": inspectorTsx,
    },
    commit: true,
    turns: [
      {
        "src/panel/inspector.css": inspectorCss
          .replace("gap: 12px", "gap: 8px")
          .replace("padding: 16px", "padding: 12px 16px"),
      },
      {
        "src/panel/inspector.tsx": inspectorTsx.replace(
          "      <TaskHeader task={task} />\n",
          "      <TaskHeader task={task} />\n      <TaskFacts task={task} />\n",
        ),
        "src/panel/task-facts.tsx": lines(
          "export function TaskFacts({ task }: { task: Task }) {",
          '  return <dl className="facts">{task.id}</dl>;',
          "}",
        ),
      },
    ],
  }),

  // A current_repo task: the user's earlier edit to README.md is left out.
  // Legacy and tax code moves (renames); the currency helper is deleted.
  "preview-refactor": (): ChangeFixture => ({
    source: "command",
    incomplete: ["assets/logo.png"],
    unrecordedCommands: true,
    base: {
      "README.md": "# Billing\n",
      "billing/index.ts": billingIndex,
      "billing/legacy.ts": legacyBilling,
      "billing/tax.ts": tax,
      "billing/currency.ts": lines(
        'const symbols: Record<string, string> = { USD: "$", EUR: "€" };',
        "",
        'export function formatCurrency(amount: number, code = "USD") {',
        "  return `${symbols[code] ?? code}${amount.toLocaleString()}`;",
        "}",
      ),
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
        "billing/currency.ts": null,
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

  // A current_repo task that stopped; the user then committed their own
  // limits over the task's. The recorded task diff stays unchanged.
  "preview-conversation": (): ChangeFixture => ({
    base: {
      "src/upload.ts": lines(
        'import { store } from "./storage";',
        "",
        "export async function upload(request: Request) {",
        "  return store(await request.arrayBuffer());",
        "}",
      ),
      "src/limits.ts": lines("export const limits = {};"),
    },
    turns: [
      {
        "src/limits.ts": lines(
          "export const limits = {",
          "  maxUploadBytes: 10 * 1024 * 1024,",
          "};",
        ),
        "src/upload.ts": lines(
          'import { limits } from "./limits";',
          'import { store } from "./storage";',
          "",
          "export async function upload(request: Request) {",
          '  const size = Number(request.headers.get("content-length"));',
          "",
          "  if (size > limits.maxUploadBytes) {",
          '    return new Response("Upload too large", { status: 413 });',
          "  }",
          "",
          "  return store(await request.arrayBuffer());",
          "}",
        ),
      },
      {
        "test/upload.test.ts": lines(
          'test("rejects uploads over the limit", async () => {',
          "  const response = await upload(oversizedRequest());",
          "  expect(response.status).toBe(413);",
          "});",
        ),
      },
    ],
    committedAfter: {
      "src/limits.ts": lines(
        "export const limits = {",
        "  maxUploadBytes: 25 * 1024 * 1024,",
        "  maxFiles: 5,",
        "};",
      ),
    },
  }),

  // A worktree that was removed; its changes are read from the branch.
  "preview-failed": (): ChangeFixture => ({
    base: { "test/retry.test.ts": "test.skip('retries');\n" },
    commit: true,
    removed: true,
    turns: [{ "test/retry.test.ts": "test('retries', { retry: 2 });\n" }],
  }),

  // A worktree recreated from its branch for a second turn.
  "preview-resumed": (): ChangeFixture => ({
    base: {
      "test/retry.test.ts": "test('retries', async () => await sleep(1000));\n",
    },
    commit: true,
    turns: [
      {
        "test/retry.test.ts":
          "test('retries', async () => await clock.tickAsync(1000));\n",
      },
      {
        "test/retry-timeout.test.ts":
          "test('gives up after three retries', async () => await clock.tickAsync(3000));\n",
      },
    ],
  }),

  // A folder without Git: a recorded edit, and commands that may have edited.
  "preview-notes-plain": (): ChangeFixture => ({
    unrecordedCommands: true,
    base: { "notes.md": "# Field notes\n" },
    turns: [{ "notes.md": "# Field notes\n\n- Tidied\n" }],
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
  "preview-release": (): ChangeFixture => ({
    base: { "RELEASE.md": "# Release notes\n" },
    removed: true,
    branchDeleted: true,
    turns: [{ "RELEASE.md": "# Release notes\n\n- Draft\n" }],
  }),

  // 60 files and about 7,000 changed lines, with a rename and a deletion.
  "preview-build": (): ChangeFixture => {
    const diff = largeFiles().find((file) => file.path === "changes.diff");
    if (!diff) throw new Error("The large file fixtures have no changes.diff.");

    return { base: preimage(diff.content), turns: [{ patch: diff.content }] };
  },
};
