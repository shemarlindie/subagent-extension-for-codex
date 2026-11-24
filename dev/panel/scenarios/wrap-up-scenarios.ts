// Tasks whose worker wraps up its turn: a recap alone, a question the user
// answered with a reply button and a new one, and a question that blocks the
// worker.
import type { Task } from "../../../src/shared/tasks/model";
import type { WrapUp } from "../../../src/shared/tasks/wrap-up-contract";
import { at, taskBase, timestamps, worktree } from "./scenario-context";
import { begin, Timeline } from "./timeline";

type WrapUpFixture = {
  id: string;
  title: string;
  description: string;
  reply: string;
  wrapUp: WrapUp;
  /** An earlier turn's reply, wrap-up and the user's answer to it. */
  earlier?: { reply: string; wrapUp: WrapUp; answer: string };
};

const fixtures: WrapUpFixture[] = [
  {
    id: "preview-wrap-up-recap",
    title: "Wrap-up: recap",
    description: "Rename the retry helper to withRetry and update its callers.",
    reply:
      "`retry` is now `withRetry` in `src/net/retry.ts`, and its 6 callers use the new name.",
    wrapUp: {
      recap:
        "retry is renamed to withRetry, with all 6 callers updated. The net suite passes. Nothing is committed.",
    },
  },
  {
    id: "preview-wrap-up-ask",
    title: "Wrap-up: question",
    description: "Find why the nightly export times out.",
    earlier: {
      reply:
        "The export loads every order into memory before writing. Streaming the rows would keep memory flat.",
      wrapUp: {
        recap:
          "The timeout comes from loading every order into memory. Nothing is changed yet.",
        ask: "Switch the export to streaming?",
        actions: [{ label: "Yes, stream it" }, { label: "Not now" }],
      },
      answer: "Yes, stream it",
    },
    reply:
      "The export now streams rows to the file in batches of 500. A 2 million row run finished in 4 minutes with memory under 200 MB.",
    wrapUp: {
      recap:
        "The export streams rows in batches of 500 and finished a 2 million row run in 4 minutes. The old timeout setting is still 10 minutes.",
      ask: "Lower the export timeout to 6 minutes?",
      actions: [{ label: "Yes, lower it" }, { label: "Keep 10 minutes" }],
    },
  },
  {
    id: "preview-wrap-up-blocked",
    title: "Wrap-up: blocked",
    description: "Add a cache in front of the pricing lookups.",
    reply:
      "The pricing lookups are wrapped behind a `PriceCache` interface, ready for a store.",
    wrapUp: {
      recap:
        "PriceCache wraps the pricing lookups, with no store behind it yet. Nothing else can go on until the store is chosen.",
      ask: "Which store should back the cache?",
      actions: [{ label: "SQLite" }, { label: "Redis" }],
      blocked: true,
    },
  },
];

const timeline = (fixture: WrapUpFixture, index: number) => {
  const t = new Timeline(fixture.id, at(250 + index * 4), 3000 + index * 400);
  begin(t, ["Read", "Edit", "Bash"]);
  t.tool("Read", { file_path: "src/index.ts" }, "export ...");
  let turn = 1;

  if (fixture.earlier) {
    const { reply, wrapUp, answer } = fixture.earlier;
    t.say(reply).finish(reply, turn, {}, wrapUp);
    turn += 1;

    t.add("task.instruction", {
      message_id: `${fixture.id}-answer`,
      message: answer,
      from: "user",
      delivery: "steer",
    })
      .add("task.queued", {}, 100)
      .add("task.started", { turn }, 300)
      .user(answer);
  }

  return t.say(fixture.reply).finish(fixture.reply, turn, {}, fixture.wrapUp);
};

export const wrapUpTimelines = fixtures.map(timeline);

export const wrapUpTasks: Task[] = fixtures.map((fixture, index) => ({
  ...taskBase,
  ...worktree(fixture.id),
  id: fixture.id,
  title: fixture.title,
  description: fixture.description,
  status: "completed",
  turn: fixture.earlier ? 2 : 1,
  completed_at: at(252 + index * 4),
  ...timestamps(250 + index * 4, 2),
}));
