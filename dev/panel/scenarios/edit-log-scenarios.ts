import type { Task } from "../../../src/shared/tasks/model";
import { at, taskBase } from "./scenario-context";
import { Timeline } from "./timeline";

const timeline = new Timeline("preview-edit-log", at(165), 5400);
timeline.add("task.started", { turn: 1 });
timeline.init(["Edit", "Write", "Bash"]);

const edit = (name: string, response: Record<string, unknown>) => {
  const id = timeline.toolStart(name, {});
  timeline.toolDone(id, "Recorded edit", false, response);
};

edit("Edit", {
  filePath: "modified.txt",
  originalFile: "before\n",
  oldString: "before",
  structuredPatch: [
    {
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      lines: ["-before", "+after"],
    },
  ],
});

edit("Write", {
  type: "create",
  filePath: "added.txt",
  originalFile: null,
  content: "added\n",
  structuredPatch: [],
});

edit("Bash", {
  bashEditDiff: {
    files: [
      {
        filePath: "deleted.txt",
        deleted: true,
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 0,
            newLines: 0,
            lines: ["-gone"],
          },
        ],
      },
      {
        filePath: "command.txt",
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: ["-old", "+command"],
          },
        ],
      },
    ],
    changedFiles: ["deleted.txt", "command.txt", "incomplete.bin"],
    moreFiles: 2,
  },
});

timeline.finish("Recorded tool and command edits.");

export const editLogTask: Task = {
  ...taskBase,
  id: timeline.taskId,
  title: "Review recorded edits",
  description: "Preview recorded edits and incomplete command changes.",
  workspace_strategy: "current_repo",
  status: "completed",
  created_at: at(165),
  updated_at: timeline.end,
  // A later turn shows This turn. The replay records every edit in the
  // latest turn's rows, so both scopes show them.
  turn: 2,
};

export const editLogTimeline = timeline;
