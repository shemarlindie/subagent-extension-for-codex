import { applyPatch, structuredPatch } from "diff";
import { afterEach, expect, test, vi } from "vitest";

import * as logging from "../../../../platform/logging/logger.js";
import type { RunContext } from "../../types.js";
import { claudeFileEdits, recordClaudeFileEdits } from "./file-edits.js";
import captured from "./file-edits-fixtures/cli-2.1.300.json";
import capturedHooks from "./file-edits-fixtures/cli-2.1.300-hooks.json";

// Synthetic responses follow the SDK output declarations and the probe shapes
// documented in the edit-log plan. They are not captured live-run evidence.
const editedHunks = [
  {
    oldStart: 1,
    oldLines: 3,
    newStart: 1,
    newLines: 3,
    lines: [" one", "-two", "+2", " three"],
  },
];

const writeUpdate = {
  type: "update",
  filePath: "/repo/b.txt",
  originalFile: "one\ntwo\nthree\n",
  content: "one\n2\nthree\n",
  structuredPatch: editedHunks,
};

const edit = {
  filePath: "/repo/b.txt",
  originalFile: "one\ntwo\nthree\n",
  oldString: "two",
  newString: "2",
  structuredPatch: editedHunks,
};

const bashResponse = {
  stdout: "",
  stderr: "",
  interrupted: false,
  bashEditDiff: {
    files: [
      { filePath: "/repo/b.txt", hunks: editedHunks },
      {
        filePath: "/repo/new.txt",
        created: true,
        hunks: [
          {
            oldStart: 1,
            oldLines: 0,
            newStart: 1,
            newLines: 1,
            lines: ["+made"],
          },
        ],
      },
      {
        filePath: "/repo/deleted.txt",
        deleted: true,
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 0,
            lines: ["-gone"],
          },
        ],
      },
    ],
    moreFiles: 0,
    changedFiles: ["/repo/b.txt", "/repo/new.txt", "/repo/deleted.txt"],
  },
};

afterEach(() => vi.restoreAllMocks());

test("M1/M3 captured subagent Write and skipped Git diff preserve their recording outcomes", () => {
  const [subagent, skipped] = capturedHooks.cases;
  expect(subagent?.agentId).toBe("fixture-subagent");

  expect(claudeFileEdits(subagent!.tool, subagent!.response)).toMatchObject({
    edits: [
      { path: "/demo/project/subagent.txt", created: true, source: "tool" },
    ],
    unrecorded: [],
  });

  expect(claudeFileEdits(skipped!.tool, skipped!.response)).toEqual({
    edits: [],
    unrecorded: [undefined],
  });
});

test("M1/M3 captured CLI 2.1.300 responses map text edits and binary omissions", () => {
  const mapped = captured.cases.map(({ tool, response }) =>
    claudeFileEdits(tool, response),
  );

  expect(
    mapped.map((result) =>
      result.edits.map((item) => ({
        path: item.path,
        source: item.source,
        created: !!item.created,
        deleted: !!item.deleted,
      })),
    ),
  ).toEqual([
    [
      {
        path: "/demo/project/created.txt",
        source: "tool",
        created: true,
        deleted: false,
      },
    ],
    [
      {
        path: "/demo/project/created.txt",
        source: "tool",
        created: false,
        deleted: false,
      },
    ],
    [
      {
        path: "/demo/project/write-update.txt",
        source: "tool",
        created: false,
        deleted: false,
      },
    ],
    [
      {
        path: "/demo/project/edit-created.txt",
        source: "tool",
        created: true,
        deleted: false,
      },
    ],
    [
      {
        path: "/demo/project/large.txt",
        source: "tool",
        created: false,
        deleted: false,
      },
    ],
    [
      {
        path: "/demo/project/nb.ipynb",
        source: "tool",
        created: false,
        deleted: false,
      },
    ],
    [
      {
        path: "/demo/project/command-created.txt",
        source: "command",
        created: true,
        deleted: false,
      },
      {
        path: "/demo/project/command-delete.txt",
        source: "command",
        created: false,
        deleted: true,
      },
      {
        path: "/demo/project/command.txt",
        source: "command",
        created: false,
        deleted: false,
      },
    ],
    [],
  ]);

  expect(mapped.map((result) => result.unrecorded)).toEqual([
    [],
    [],
    [],
    [],
    [],
    [],
    ["/demo/project/binary.bin"],
    [],
  ]);

  // Read-only git status returned no bashEditDiff, so it adds no warning.
  expect(mapped[7]).toEqual({ edits: [], unrecorded: [] });

  expect(
    applyPatch("one\ntwo\nthree\n", {
      ...structuredPatch("", "", "one\ntwo\nthree\n", "one\n2\nthree\n"),
      hunks: mapped[2]!.edits[0]!.hunks,
    }),
  ).toBe("one\n2\nthree\n");
});

test("M1 Write creation computes its added lines including final-newline markers", () => {
  const result = claudeFileEdits("Write", {
    type: "create",
    filePath: "/repo/a.txt",
    content: "hello",
    originalFile: null,
    structuredPatch: [],
  });

  expect(result.unrecorded).toEqual([]);

  expect(result.edits).toEqual([
    {
      path: "/repo/a.txt",
      created: true,
      source: "tool",
      hunks: [
        {
          oldStart: 1,
          oldLines: 0,
          newStart: 1,
          newLines: 1,
          lines: ["+hello", "\\ No newline at end of file"],
        },
      ],
    },
  ]);
});

test.each(["Write", "Edit"])(
  "M1 %s preserves structured hunks and ignores Git-relative added status",
  (tool) => {
    const result = claudeFileEdits(tool, {
      ...(tool === "Write" ? writeUpdate : edit),
      gitDiff: { status: "added" },
    });

    expect(result).toEqual({
      edits: [{ path: "/repo/b.txt", hunks: editedHunks, source: "tool" }],
      unrecorded: [],
    });
  },
);

test("M1 Edit creation uses the empty original string and does not need all file content", () => {
  const result = claudeFileEdits("Edit", {
    ...edit,
    originalFile: "",
    oldString: "",
    structuredPatch: bashResponse.bashEditDiff.files[1]!.hunks,
    contentNotInModelContext: true,
  });

  expect(result.edits[0]).toMatchObject({
    created: true,
    source: "tool",
  });

  expect(
    claudeFileEdits("Edit", { ...edit, oldString: "" }).edits[0],
  ).not.toHaveProperty("created");
});

test("M1 NotebookEdit computes a three-context diff of the entire notebook JSON", () => {
  const original = JSON.stringify(
    { cells: [{ source: ["print(1)\n"], outputs: [] }], metadata: {} },
    null,
    2,
  );

  const updated = original.replace("print(1)", "print(2)");

  const result = claudeFileEdits("NotebookEdit", {
    notebook_path: "/repo/nb.ipynb",
    original_file: original,
    updated_file: updated,
    old_source: "print(1)",
    new_source: "print(2)",
  });

  expect(result.unrecorded).toEqual([]);

  expect(result.edits).toEqual([
    {
      path: "/repo/nb.ipynb",
      source: "tool",
      hunks: structuredPatch("", "", original, updated, "", "", {
        context: 3,
      }).hunks,
    },
  ]);

  expect(
    applyPatch(original, {
      ...structuredPatch("", "", original, updated),
      hunks: result.edits[0]!.hunks,
    }),
  ).toBe(updated);
});

test("M1 Bash keeps tool flags and command source for modified, added, and deleted files", () => {
  expect(claudeFileEdits("Bash", bashResponse)).toEqual({
    edits: bashResponse.bashEditDiff.files.map((file) => ({
      path: file.filePath,
      hunks: file.hunks,
      source: "command",
      ...("created" in file ? { created: file.created } : {}),
      ...("deleted" in file ? { deleted: file.deleted } : {}),
    })),
    unrecorded: [],
  });
});

test("M2 Write update computes missing hunks and drops identical content", () => {
  expect(
    claudeFileEdits("Write", { ...writeUpdate, structuredPatch: [] }),
  ).toEqual(claudeFileEdits("Write", writeUpdate));

  expect(
    claudeFileEdits("Write", {
      ...writeUpdate,
      content: writeUpdate.originalFile,
      structuredPatch: [],
    }),
  ).toEqual({ edits: [], unrecorded: [] });

  expect(
    claudeFileEdits("Write", {
      type: "create",
      filePath: "/repo/empty.txt",
      content: "",
      structuredPatch: [],
    }),
  ).toEqual({ edits: [], unrecorded: [] });
});

test("M1 edit tools mark an unreadable edit incomplete", () => {
  for (const [tool, response] of [
    ["Write", { ...writeUpdate, originalFile: null, structuredPatch: [] }],
    ["Write", { ...writeUpdate, structuredPatch: "invalid" }],
    ["Edit", { ...edit, structuredPatch: [{ lines: ["-two", "+2"] }] }],
    ["NotebookEdit", { notebook_path: "/repo/b.txt", updated_file: "next" }],
  ] as const) {
    expect(claudeFileEdits(tool, response), tool).toEqual({
      edits: [],
      unrecorded: ["/repo/b.txt"],
    });
  }
});

test("M3 Bash names uncaptured files once and reports only additional unknown paths", () => {
  const response = {
    ...bashResponse,
    bashEditDiff: {
      ...bashResponse.bashEditDiff,
      changedFiles: [
        ...bashResponse.bashEditDiff.changedFiles,
        "/repo/binary.bin",
        "/repo/binary.bin",
      ],
      moreFiles: 1,
    },
  };

  expect(claudeFileEdits("Bash", response).unrecorded).toEqual([
    "/repo/binary.bin",
  ]);

  response.bashEditDiff.moreFiles = 2;

  expect(claudeFileEdits("Bash", response).unrecorded).toEqual([
    "/repo/binary.bin",
    undefined,
  ]);

  expect(
    claudeFileEdits("Bash", { bashEditDiff: { unavailable: true } }),
  ).toEqual({ edits: [], unrecorded: [undefined] });
});

test("M3 malformed Bash hunks keep their path and do not lose other file edits", () => {
  const result = claudeFileEdits("Bash", {
    bashEditDiff: {
      ...bashResponse.bashEditDiff,
      files: [
        bashResponse.bashEditDiff.files[0],
        { filePath: "/repo/new.txt", hunks: null },
      ],
    },
  });

  expect(result.edits).toHaveLength(1);
  expect(result.unrecorded).toEqual(["/repo/new.txt", "/repo/deleted.txt"]);
});

test("M4 staged and errored responses record nothing", () => {
  for (const [tool, response] of [
    ["Write", { ...writeUpdate, staged: true }],
    ["Edit", { ...edit, staged: true }],
    ["Write", { ...writeUpdate, error: "failed" }],
    ["Write", { ...writeUpdate, is_error: true }],
    ["Write", { ...writeUpdate, isError: true }],
    ["Write", "Error: file does not exist"],
    ["Write", undefined],
  ] as const) {
    expect(claudeFileEdits(tool, response), JSON.stringify(response)).toEqual({
      edits: [],
      unrecorded: [],
    });
  }
});

test("unrelated tools, commands without diffs, and no-op Edit hunks record nothing", () => {
  for (const [tool, response] of [
    ["Read", writeUpdate],
    ["Bash", { stdout: "ok" }],
    ["Edit", { ...edit, structuredPatch: [] }],
  ] as const) {
    expect(claudeFileEdits(tool, response)).toEqual({
      edits: [],
      unrecorded: [],
    });
  }
});

function recordingContext() {
  return {
    fileChanged: vi.fn<RunContext["fileChanged"]>(),
    editUnrecorded: vi.fn<RunContext["editUnrecorded"]>(),
  } satisfies Pick<RunContext, "fileChanged" | "editUnrecorded">;
}

test("the hook records mapped edits and missing files", () => {
  const context = recordingContext();

  recordClaudeFileEdits(context, "Bash", {
    bashEditDiff: {
      ...bashResponse.bashEditDiff,
      changedFiles: ["/repo/b.txt", "/repo/binary.bin"],
      moreFiles: 2,
    },
  });

  expect(context.fileChanged).toHaveBeenCalledTimes(3);

  expect(context.editUnrecorded).toHaveBeenCalledWith(
    "/repo/binary.bin",
    "command",
  );

  expect(context.editUnrecorded).toHaveBeenCalledWith(undefined, "command");
});

test("uncaptured edit-tool patches retain tool provenance", () => {
  const context = recordingContext();
  recordClaudeFileEdits(context, "Edit", { ...edit, structuredPatch: null });

  expect(context.editUnrecorded).toHaveBeenCalledWith("/repo/b.txt", "tool");
});

test("M6 mapping and recording failures log an error and never escape the hook", () => {
  const log = vi.spyOn(logging, "logError").mockImplementation(() => {});
  const context = recordingContext();
  const error = new Error("database unavailable");

  const failure = {
    get filePath(): never {
      throw error;
    },
  };

  expect(() => recordClaudeFileEdits(context, "Write", failure)).not.toThrow();

  expect(log).toHaveBeenLastCalledWith("provider.edit_capture_failed", error, {
    tool: "Write",
  });

  vi.mocked(context.fileChanged).mockImplementation(() => {
    throw error;
  });

  expect(() => recordClaudeFileEdits(context, "Edit", edit)).not.toThrow();

  expect(log).toHaveBeenLastCalledWith("provider.edit_capture_failed", error, {
    tool: "Edit",
  });

  vi.mocked(context.editUnrecorded).mockImplementation(() => {
    throw error;
  });

  expect(() =>
    recordClaudeFileEdits(context, "Bash", {
      bashEditDiff: { unavailable: true },
    }),
  ).not.toThrow();

  expect(log).toHaveBeenCalledTimes(3);
});
